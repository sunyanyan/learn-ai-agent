import { Agent } from '../core/agent.js';
import { Message } from '../core/message.js';
import { ToolRegistry } from '../tools/registry.js';

function mapParameterType(paramType) {
  const normalized = (paramType || '').toLowerCase();
  if (['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(normalized)) {
    return normalized;
  }
  return 'string';
}

export class FunctionCallAgent extends Agent {
  constructor({
    name, llm, systemPrompt = null, config = null,
    toolRegistry = null, enableToolCalling = true,
    defaultToolChoice = 'auto', maxToolIterations = 3,
  }) {
    super({ name, llm, systemPrompt, config });
    this.toolRegistry = toolRegistry || null;
    this.enableToolCalling = enableToolCalling && toolRegistry !== null;
    this.defaultToolChoice = defaultToolChoice;
    this.maxToolIterations = maxToolIterations;
  }

  _getSystemPrompt() {
    const base = this.systemPrompt || '你是一个可靠的AI助理，能够在需要时调用工具完成任务。';
    if (!this.enableToolCalling || !this.toolRegistry) return base;

    const desc = this.toolRegistry.getToolsDescription();
    if (!desc || desc === '暂无可用工具') return base;

    let prompt = base + '\n\n## 可用工具\n当你判断需要外部信息或执行动作时，可以直接通过函数调用使用以下工具：\n';
    prompt += desc + '\n';
    prompt += '\n请主动决定是否调用工具，合理利用多次调用来获得完备答案。';
    return prompt;
  }

  _buildToolSchemas() {
    if (!this.enableToolCalling || !this.toolRegistry) return [];

    const schemas = [];

    for (const tool of this.toolRegistry.getAllTools()) {
      const properties = {};
      const required = [];

      let parameters = [];
      try { parameters = tool.getParameters(); } catch {}

      for (const param of parameters) {
        properties[param.name] = {
          type: mapParameterType(param.type),
          description: param.description || '',
        };
        if (param.default !== null) {
          properties[param.name].default = param.default;
        }
        if (param.required) required.push(param.name);
      }

      const schema = {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: {
            type: 'object',
            properties,
          },
        },
      };
      if (required.length > 0) {
        schema.function.parameters.required = required;
      }
      schemas.push(schema);
    }

    for (const [name, info] of this.toolRegistry._functions) {
      schemas.push({
        type: 'function',
        function: {
          name,
          description: info.description || '',
          parameters: {
            type: 'object',
            properties: { input: { type: 'string', description: '输入文本' } },
            required: ['input'],
          },
        },
      });
    }

    return schemas;
  }

  static extractMessageContent(rawContent) {
    if (rawContent === null || rawContent === undefined) return '';
    if (typeof rawContent === 'string') return rawContent;
    if (Array.isArray(rawContent)) {
      return rawContent
        .map(item => (typeof item === 'object' && item !== null ? (item.text || '') : ''))
        .join('');
    }
    return String(rawContent);
  }

  static parseFunctionCallArguments(argumentsStr) {
    if (!argumentsStr) return {};
    try {
      const parsed = JSON.parse(argumentsStr);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  _convertParameterTypes(toolName, paramDict) {
    if (!this.toolRegistry) return paramDict;
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) return paramDict;

    let toolParams = [];
    try { toolParams = tool.getParameters(); } catch { return paramDict; }

    const typeMap = {};
    for (const p of toolParams) typeMap[p.name] = p.type;
    const converted = {};

    for (const [key, value] of Object.entries(paramDict)) {
      const pType = typeMap[key];
      if (!pType) { converted[key] = value; continue; }
      try {
        const norm = pType.toLowerCase();
        if (norm === 'number' || norm === 'float') converted[key] = parseFloat(value);
        else if (norm === 'integer' || norm === 'int') converted[key] = parseInt(value, 10);
        else if (norm === 'boolean' || norm === 'bool') {
          if (typeof value === 'boolean') converted[key] = value;
          else if (typeof value === 'number') converted[key] = Boolean(value);
          else if (typeof value === 'string') converted[key] = ['true', '1', 'yes'].includes(value.toLowerCase());
          else converted[key] = Boolean(value);
        } else {
          converted[key] = value;
        }
      } catch { converted[key] = value; }
    }
    return converted;
  }

  async _executeToolCall(toolName, arguments_) {
    if (!this.toolRegistry) return '❌ 错误：未配置工具注册表';

    const tool = this.toolRegistry.getTool(toolName);
    if (tool) {
      try {
        const typed = this._convertParameterTypes(toolName, arguments_);
        return await tool.run(typed);
      } catch (e) {
        return `❌ 工具调用失败：${e.message}`;
      }
    }

    const func = this.toolRegistry.getFunction(toolName);
    if (func) {
      try {
        return await func(arguments_.input || '');
      } catch (e) {
        return `❌ 工具调用失败：${e.message}`;
      }
    }

    return `❌ 错误：未找到工具 '${toolName}'`;
  }

  async _invokeWithTools(messages, tools, toolChoice, kwargs = {}) {
    const client = this.llm.getClient();
    if (!client) throw new Error('HelloAgentsLLM 未正确初始化客户端，无法执行函数调用。');

    const clientKwargs = { ...kwargs };
    if (this.llm.temperature !== undefined && clientKwargs.temperature === undefined) {
      clientKwargs.temperature = this.llm.temperature;
    }
    if (this.llm.maxTokens !== null && clientKwargs.max_tokens === undefined) {
      clientKwargs.max_tokens = this.llm.maxTokens;
    }

    return await client.chat.completions.create({
      model: this.llm.model,
      messages,
      tools,
      toolChoice,
      ...clientKwargs,
    });
  }

  async run(inputText, {
    maxToolIterations = null,
    toolChoice = null,
    ...kwargs
  } = {}) {
    const messages = [{ role: 'system', content: this._getSystemPrompt() }];
    for (const msg of this._history) messages.push({ role: msg.role, content: msg.content });
    messages.push({ role: 'user', content: inputText });

    const toolSchemas = this._buildToolSchemas();
    if (toolSchemas.length === 0) {
      const responseText = await this.llm.invoke(messages, kwargs);
      this.addMessage(new Message(inputText, 'user'));
      this.addMessage(new Message(responseText, 'assistant'));
      return responseText;
    }

    const iterationsLimit = maxToolIterations !== null ? maxToolIterations : this.maxToolIterations;
    const effectiveToolChoice = toolChoice !== null ? toolChoice : this.defaultToolChoice;

    let currentIteration = 0;
    let finalResponse = '';

    while (currentIteration < iterationsLimit) {
      const response = await this._invokeWithTools(messages, toolSchemas, effectiveToolChoice, kwargs);
      const choice = response.choices[0];
      const assistantMessage = choice.message;
      const content = FunctionCallAgent.extractMessageContent(assistantMessage.content);
      const toolCalls = assistantMessage.toolCalls || [];

      if (toolCalls.length > 0) {
        const assistantPayload = { role: 'assistant', content, toolCalls: [] };
        for (const tc of toolCalls) {
          assistantPayload.toolCalls.push({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          });
        }
        messages.push(assistantPayload);

        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          const arguments_ = FunctionCallAgent.parseFunctionCallArguments(tc.function.arguments);
          const result = await this._executeToolCall(toolName, arguments_);
          messages.push({ role: 'tool', toolCallId: tc.id, name: toolName, content: result });
        }

        currentIteration++;
        continue;
      }

      finalResponse = content;
      messages.push({ role: 'assistant', content: finalResponse });
      break;
    }

    if (currentIteration >= iterationsLimit && !finalResponse) {
      const finalChoice = await this._invokeWithTools(messages, toolSchemas, 'none', kwargs);
      finalResponse = FunctionCallAgent.extractMessageContent(finalChoice.choices[0].message.content);
      messages.push({ role: 'assistant', content: finalResponse });
    }

    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(finalResponse, 'assistant'));
    return finalResponse;
  }

  addTool(tool) {
    if (!this.toolRegistry) {
      this.toolRegistry = new ToolRegistry();
      this.enableToolCalling = true;
    }
    if (tool.autoExpand) {
      const expanded = tool.getExpandedTools();
      if (expanded && expanded.length > 0) {
        for (const t of expanded) this.toolRegistry.registerTool(t);
        console.log(`✅ MCP工具 '${tool.name}' 已展开为 ${expanded.length} 个独立工具`);
        return;
      }
    }
    this.toolRegistry.registerTool(tool);
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
    const result = await this.run(inputText, kwargs);
    yield result;
  }
}