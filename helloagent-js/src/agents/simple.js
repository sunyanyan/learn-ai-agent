import { Agent } from '../core/agent.js';
import { Message } from '../core/message.js';
import { ToolRegistry } from '../tools/registry.js';

export class SimpleAgent extends Agent {
  constructor({
    name, llm, systemPrompt = null, config = null,
    toolRegistry = null, enableToolCalling = true,
  }) {
    super({ name, llm, systemPrompt, config });
    this.toolRegistry = toolRegistry || null;
    this.enableToolCalling = enableToolCalling && toolRegistry !== null;
  }

  _getEnhancedSystemPrompt() {
    const base = this.systemPrompt || '你是一个有用的AI助手。';
    if (!this.enableToolCalling || !this.toolRegistry) return base;

    const desc = this.toolRegistry.getToolsDescription();
    if (!desc || desc === '暂无可用工具') return base;

    let section = '\n\n## 可用工具\n你可以使用以下工具来帮助回答问题：\n';
    section += desc + '\n';
    section += '\n## 工具调用格式\n当需要使用工具时，请使用以下格式：\n`[TOOL_CALL:{tool_name}:{parameters}]`\n\n';
    section += '### 参数格式说明\n1. **多个参数**：使用 `key=value` 格式，用逗号分隔\n   示例：`[TOOL_CALL:calculator_multiply:a=12,b=8]`\n';
    section += '2. **单个参数**：直接使用 `key=value`\n   示例：`[TOOL_CALL:search:query=Python编程]`\n';
    section += '3. **简单查询**：可以直接传入文本\n   示例：`[TOOL_CALL:search:Python编程]`\n\n';
    section += '### 重要提示\n- 参数名必须与工具定义的参数名完全匹配\n- 数字参数直接写数字\n- 工具调用结果会自动插入到对话中\n';

    return base + section;
  }

  _parseToolCalls(text) {
    const pattern = /\[TOOL_CALL:([^:]+):([^\]]+)\]/g;
    const calls = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      calls.push({
        toolName: match[1].trim(),
        parameters: match[2].trim(),
        original: match[0],
      });
    }
    return calls;
  }

  async _executeToolCall(toolName, parameters) {
    if (!this.toolRegistry) return '❌ 错误：未配置工具注册表';
    try {
      const tool = this.toolRegistry.getTool(toolName);
      if (!tool) return `❌ 错误：未找到工具 '${toolName}'`;
      const paramDict = this._parseToolParameters(toolName, parameters);
      const result = await tool.run(paramDict);
      return `🔧 工具 ${toolName} 执行结果：\n${result}`;
    } catch (e) {
      return `❌ 工具调用失败：${e.message}`;
    }
  }

  _parseToolParameters(toolName, parameters) {
    const paramDict = {};

    if (parameters.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(parameters);
        return this._convertParameterTypes(toolName, parsed);
      } catch { /* fall through */ }
    }

    if (parameters.includes('=')) {
      if (parameters.includes(',')) {
        for (const pair of parameters.split(',')) {
          if (pair.includes('=')) {
            const [key, value] = pair.split('=', 2);
            paramDict[key.trim()] = value.trim();
          }
        }
      } else {
        const [key, value] = parameters.split('=', 2);
        paramDict[key.trim()] = value.trim();
      }
      let converted = this._convertParameterTypes(toolName, paramDict);
      if (!('action' in converted)) converted = this._inferAction(toolName, converted);
      return converted;
    }

    return this._inferSimpleParameters(toolName, parameters);
  }

  _convertParameterTypes(toolName, paramDict) {
    if (!this.toolRegistry) return paramDict;
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) return paramDict;
    let toolParams;
    try { toolParams = tool.getParameters(); } catch { return paramDict; }
    const typeMap = {};
    for (const p of toolParams) typeMap[p.name] = p.type;

    const converted = {};
    for (const [key, value] of Object.entries(paramDict)) {
      const pType = typeMap[key];
      if (!pType) { converted[key] = value; continue; }
      try {
        if (pType === 'number' || pType === 'integer') {
          converted[key] = typeof value === 'string' ? (pType === 'number' ? parseFloat(value) : parseInt(value, 10)) : value;
        } else if (pType === 'boolean') {
          converted[key] = typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : Boolean(value);
        } else {
          converted[key] = value;
        }
      } catch { converted[key] = value; }
    }
    return converted;
  }

  _inferAction(toolName, paramDict) {
    if (toolName === 'memory') {
      if ('recall' in paramDict) { paramDict.action = 'search'; paramDict.query = paramDict.recall; delete paramDict.recall; }
      else if ('store' in paramDict) { paramDict.action = 'add'; paramDict.content = paramDict.store; delete paramDict.store; }
      else if ('query' in paramDict) paramDict.action = 'search';
      else if ('content' in paramDict) paramDict.action = 'add';
    } else if (toolName === 'rag') {
      if ('search' in paramDict) { paramDict.action = 'search'; paramDict.query = paramDict.search; delete paramDict.search; }
      else if ('query' in paramDict) paramDict.action = 'search';
      else if ('text' in paramDict) paramDict.action = 'add_text';
    }
    return paramDict;
  }

  _inferSimpleParameters(toolName, parameters) {
    if (toolName === 'rag') return { action: 'search', query: parameters };
    if (toolName === 'memory') return { action: 'search', query: parameters };
    return { input: parameters };
  }

  async run(inputText, { maxToolIterations = 3, ...kwargs } = {}) {
    const messages = [];
    messages.push({ role: 'system', content: this._getEnhancedSystemPrompt() });
    for (const msg of this._history) messages.push({ role: msg.role, content: msg.content });
    messages.push({ role: 'user', content: inputText });

    if (!this.enableToolCalling) {
      const response = await this.llm.invoke(messages, kwargs);
      this.addMessage(new Message(inputText, 'user'));
      this.addMessage(new Message(response, 'assistant'));
      return response;
    }

    let currentIteration = 0;
    let finalResponse = '';

    while (currentIteration < maxToolIterations) {
      const response = await this.llm.invoke(messages, kwargs);
      const toolCalls = this._parseToolCalls(response);

      if (toolCalls.length > 0) {
        const toolResults = [];
        let cleanResponse = response;
        messages.push({ role: 'assistant', content: cleanResponse });

        for (const call of toolCalls) {
          const result = await this._executeToolCall(call.toolName, call.parameters);
          toolResults.push(result);
          cleanResponse = cleanResponse.replace(call.original, '');
        }

        messages.push({
          role: 'user',
          content: `工具执行结果：\n${toolResults.join('\n\n')}\n\n请基于这些结果给出完整的回答。`,
        });
        currentIteration++;
        continue;
      }

      finalResponse = response;
      break;
    }

    if (currentIteration >= maxToolIterations && !finalResponse) {
      finalResponse = await this.llm.invoke(messages, kwargs);
    }

    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(finalResponse, 'assistant'));
    return finalResponse;
  }

  addTool(tool, autoExpand = true) {
    if (!this.toolRegistry) {
      this.toolRegistry = new ToolRegistry();
      this.enableToolCalling = true;
    }
    this.toolRegistry.registerTool(tool, autoExpand);
  }

  removeTool(toolName) {
    if (this.toolRegistry) return this.toolRegistry.unregister(toolName);
    return false;
  }

  listTools() {
    return this.toolRegistry ? this.toolRegistry.listTools() : [];
  }

  hasTools() {
    return this.enableToolCalling && this.toolRegistry !== null;
  }

  async *streamRun(inputText, kwargs = {}) {
    const messages = [];
    if (this.systemPrompt) messages.push({ role: 'system', content: this.systemPrompt });
    for (const msg of this._history) messages.push({ role: msg.role, content: msg.content });
    messages.push({ role: 'user', content: inputText });

    let fullResponse = '';
    for await (const chunk of this.llm.streamInvoke(messages, kwargs)) {
      fullResponse += chunk;
      yield chunk;
    }
    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(fullResponse, 'assistant'));
  }
}