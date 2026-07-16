import { SimpleAgent } from './simple.js';
import { Message } from '../core/message.js';
import { ToolRegistry } from '../tools/registry.js';

const MARKER = '[TOOL_CALL:';

export class ToolAwareSimpleAgent extends SimpleAgent {
  constructor({
    toolCallListener = null,
    ...kwargs
  } = {}) {
    super(kwargs);
    this._toolCallListener = toolCallListener;
  }

  async _executeToolCall(toolName, parameters) {
    if (!this.toolRegistry) return '❌ 错误：未配置工具注册表';

    let parsedParameters = {};
    let formattedResult;

    try {
      const tool = this.toolRegistry.getTool(toolName);
      if (!tool) return `❌ 错误：未找到工具 '${toolName}'`;

      parsedParameters = this._parseToolParameters(toolName, parameters);
      parsedParameters = ToolAwareSimpleAgent._sanitizeParameters(parsedParameters);
      const result = await tool.run(parsedParameters);
      formattedResult = `🔧 工具 ${toolName} 执行结果：\n${result}`;
    } catch (e) {
      formattedResult = `❌ 工具调用失败：${e.message}`;
    }

    if (this._toolCallListener) {
      try {
        this._toolCallListener({
          agentName: this.name,
          toolName,
          rawParameters: parameters,
          parsedParameters,
          result: formattedResult,
        });
      } catch (e) {
        console.error('Tool call listener failed:', e);
      }
    }

    return formattedResult;
  }

  _parseToolCalls(text) {
    const calls = [];
    let start = 0;

    while (true) {
      const begin = text.indexOf(MARKER, start);
      if (begin === -1) break;

      const toolStart = begin + MARKER.length;
      const colon = text.indexOf(':', toolStart);
      if (colon === -1) break;

      const toolName = text.slice(toolStart, colon).trim();
      const bodyStart = colon + 1;
      let pos = bodyStart;
      let depth = 0;
      let inString = false;
      let stringQuote = '';

      while (pos < text.length) {
        const char = text[pos];

        if (char === '"' || char === "'") {
          if (!inString) {
            inString = true;
            stringQuote = char;
          } else if (stringQuote === char && text[pos - 1] !== '\\') {
            inString = false;
          }
        }

        if (!inString) {
          if (char === '[') depth++;
          else if (char === ']') {
            if (depth === 0) {
              const body = text.slice(bodyStart, pos).trim();
              const original = text.slice(begin, pos + 1);
              calls.push({ toolName, parameters: body, original });
              start = pos + 1;
              break;
            }
            depth--;
          }
        }
        pos++;
      }

      if (pos >= text.length && calls.length === 0) break;
    }

    return calls;
  }

  static _findToolCallEnd(text, startIndex) {
    const toolStart = startIndex + MARKER.length;
    const colon = text.indexOf(':', toolStart);
    if (colon === -1) return -1;

    const bodyStart = colon + 1;
    let pos = bodyStart;
    let depth = 0;
    let inString = false;
    let stringQuote = '';

    while (pos < text.length) {
      const char = text[pos];

      if (char === '"' || char === "'") {
        if (!inString) {
          inString = true;
          stringQuote = char;
        } else if (stringQuote === char && text[pos - 1] !== '\\') {
          inString = false;
        }
      }

      if (!inString) {
        if (char === '[') depth++;
        else if (char === ']') {
          if (depth === 0) return pos;
          depth--;
        }
      }
      pos++;
    }
    return -1;
  }

  static attachRegistry(agent, registry) {
    if (registry) {
      agent.toolRegistry = registry;
      agent.enableToolCalling = true;
    }
  }

  static _sanitizeParameters(parameters) {
    const sanitized = {};
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') {
        sanitized[key] = value;
        continue;
      }
      if (typeof value === 'string') {
        const normalized = ToolAwareSimpleAgent._normalizeString(value);

        if (key === 'taskId') {
          const n = parseInt(normalized, 10);
          if (!isNaN(n)) { sanitized[key] = n; continue; }
        }

        if (key === 'tags') {
          const parsed = ToolAwareSimpleAgent._coerceSequence(normalized);
          if (Array.isArray(parsed)) { sanitized[key] = parsed; continue; }
          if (normalized) { sanitized[key] = normalized.split(',').map(s => s.trim()).filter(Boolean); continue; }
        }

        if (['noteType', 'action', 'title', 'content', 'noteId'].includes(key)) {
          sanitized[key] = normalized;
          continue;
        }

        sanitized[key] = normalized;
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  static _normalizeString(value) {
    let trimmed = value.trim();

    if (trimmed && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.split(trimmed[0]).length - 1 === 1) {
      trimmed = trimmed.slice(1);
    }
    if (trimmed && (trimmed[trimmed.length - 1] === '"' || trimmed[trimmed.length - 1] === "'") && trimmed.split(trimmed[trimmed.length - 1]).length - 1 === 1) {
      trimmed = trimmed.slice(0, -1);
    }
    if (trimmed && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[trimmed.length - 1] === trimmed[0]) {
      trimmed = trimmed.slice(1, -1);
    }

    if (trimmed && (trimmed[0] === '[' || trimmed[0] === '(') && !(trimmed[trimmed.length - 1] === ']' || trimmed[trimmed.length - 1] === ')')) {
      const closing = trimmed[0] === '[' ? ']' : ')';
      trimmed = trimmed + closing;
    }

    return trimmed.trim();
  }

  static _coerceSequence(value) {
    if (!value) return null;

    const candidates = [value];
    if (value.startsWith('[') && !value.endsWith(']')) candidates.push(value + ']');
    if (value.startsWith('(') && !value.endsWith(')')) candidates.push(value + ')');

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* try next */ }
    }
    return null;
  }

  async *streamRun(inputText, { maxToolIterations = 3, ...kwargs } = {}) {
    const messages = [{ role: 'system', content: this._getEnhancedSystemPrompt() }];
    for (const msg of this._history) messages.push({ role: msg.role, content: msg.content });
    messages.push({ role: 'user', content: inputText });

    const finalSegments = [];
    let finalResponseText = '';
    let currentIteration = 0;

    while (currentIteration < maxToolIterations) {
      let residual = '';
      const segmentsThisRound = [];
      const toolCallTexts = [];

      const processResidual = function* (finalPass = false) {
        while (true) {
          const start = residual.indexOf(MARKER);
          if (start === -1) {
            const safeLen = finalPass ? residual.length : Math.max(0, residual.length - (MARKER.length - 1));
            if (safeLen > 0) {
              const segment = residual.slice(0, safeLen);
              residual = residual.slice(safeLen);
              yield segment;
            }
            break;
          }
          if (start > 0) {
            const segment = residual.slice(0, start);
            residual = residual.slice(start);
            if (segment) yield segment;
            continue;
          }
          const end = ToolAwareSimpleAgent._findToolCallEnd(residual, 0);
          if (end === -1) break;
          toolCallTexts.push(residual.slice(0, end + 1));
          residual = residual.slice(end + 1);
        }
      };

      for await (const chunk of this.llm.streamInvoke(messages, kwargs)) {
        if (!chunk) continue;
        residual += chunk;
        for (const segment of processResidual()) {
          if (!segment) continue;
          segmentsThisRound.push(segment);
          finalSegments.push(segment);
          yield segment;
        }
      }

      for (const segment of processResidual(true)) {
        if (!segment) continue;
        segmentsThisRound.push(segment);
        finalSegments.push(segment);
        yield segment;
      }

      const cleanResponse = segmentsThisRound.join('');
      let toolCalls = [];
      for (const callText of toolCallTexts) {
        toolCalls = toolCalls.concat(this._parseToolCalls(callText));
      }

      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: cleanResponse });
        const toolResults = [];
        for (const call of toolCalls) {
          const result = await this._executeToolCall(call.toolName, call.parameters);
          toolResults.push(result);
        }
        messages.push({
          role: 'user',
          content: `工具执行结果：\n${toolResults.join('\n\n')}\n\n请基于这些结果给出完整的回答。`,
        });
        currentIteration++;
        continue;
      }

      finalResponseText = cleanResponse;
      break;
    }

    if (currentIteration >= maxToolIterations && !finalResponseText) {
      const fallback = await this.llm.invoke(messages, kwargs);
      finalSegments.push(fallback);
      finalResponseText = fallback;
      yield fallback;
    }

    const storedResponse = finalResponseText || finalSegments.join('');
    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(storedResponse, 'assistant'));
  }
}