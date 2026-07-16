import { Agent } from '../core/agent.js';
import { Message } from '../core/message.js';
import { ToolRegistry } from '../tools/registry.js';
import { Tool, ToolParameter } from '../tools/base.js';

const DEFAULT_REACT_PROMPT = `你是一个具备推理和行动能力的AI助手。你可以通过思考分析问题，然后调用合适的工具来获取信息，最终给出准确的答案。

## 可用工具
{tools}

## 工作流程
请严格按照以下格式进行回应，每次只能执行一个步骤：

Thought: 分析问题，确定需要什么信息，制定研究策略。
Action: 选择合适的工具获取信息，格式为：
- \`{tool_name}[{tool_input}]\`：调用工具获取信息。
- \`Finish[研究结论]\`：当你有足够信息得出结论时。

## 重要提醒
1. 每次回应必须包含Thought和Action两部分
2. 工具调用的格式必须严格遵循：工具名[参数]
3. 只有当你确信有足够信息回答问题时，才使用Finish
4. 如果工具返回的信息不够，继续使用其他工具或相同工具的不同参数

## 当前任务
**Question:** {question}

## 执行历史
{history}

现在开始你的推理和行动：`;

export class ReActAgent extends Agent {
  constructor({
    name, llm, toolRegistry = null, systemPrompt = null,
    config = null, maxSteps = 5, customPrompt = null,
  }) {
    super({ name, llm, systemPrompt, config });
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.maxSteps = maxSteps;
    this.currentHistory = [];
    this.promptTemplate = customPrompt || DEFAULT_REACT_PROMPT;
  }

  addTool(tool) {
    if (tool.autoExpand && tool._availableTools && tool._availableTools.length > 0) {
      for (const mcpTool of tool._availableTools) {
        const wrapped = new Tool({
          name: `${tool.name}_${mcpTool.name}`,
          description: mcpTool.description || '',
          async run(params) {
            return await tool.run({ action: 'call_tool', toolName: mcpTool.name, arguments: { input: params.input || '' } });
          },
          getParameters() {
            return [new ToolParameter({ name: 'input', type: 'string', description: '输入文本', required: true })];
          },
        });
        this.toolRegistry.registerTool(wrapped);
      }
      console.log(`✅ MCP工具 '${tool.name}' 已展开为 ${tool._availableTools.length} 个独立工具`);
    } else {
      this.toolRegistry.registerTool(tool);
    }
  }

  async run(inputText, kwargs = {}) {
    this.currentHistory = [];
    let currentStep = 0;

    console.log(`\n🤖 ${this.name} 开始处理问题: ${inputText}`);

    while (currentStep < this.maxSteps) {
      currentStep++;
      console.log(`\n--- 第 ${currentStep} 步 ---`);

      const toolsDesc = this.toolRegistry.getToolsDescription();
      const historyStr = this.currentHistory.join('\n');
      const prompt = this.promptTemplate
        .replace('{tools}', toolsDesc)
        .replace('{question}', inputText)
        .replace('{history}', historyStr);

      const messages = [{ role: 'user', content: prompt }];
      const responseText = await this.llm.invoke(messages, kwargs);

      if (!responseText) {
        console.log('❌ 错误：LLM未能返回有效响应。');
        break;
      }

      const { thought, action } = this._parseOutput(responseText);
      if (thought) console.log(`🤔 思考: ${thought}`);
      if (!action) {
        console.log('⚠️ 警告：未能解析出有效的Action，流程终止。');
        break;
      }

      if (action.startsWith('Finish')) {
        const finalAnswer = this._parseActionInput(action);
        console.log(`🎉 最终答案: ${finalAnswer}`);
        this.addMessage(new Message(inputText, 'user'));
        this.addMessage(new Message(finalAnswer, 'assistant'));
        return finalAnswer;
      }

      const { toolName, toolInput } = this._parseAction(action);
      if (!toolName || toolInput === null) {
        this.currentHistory.push('Observation: 无效的Action格式，请检查。');
        continue;
      }

      console.log(`🎬 行动: ${toolName}[${toolInput}]`);
      const observation = await this.toolRegistry.executeTool(toolName, toolInput);
      console.log(`👀 观察: ${observation}`);

      this.currentHistory.push(`Action: ${action}`);
      this.currentHistory.push(`Observation: ${observation}`);
    }

    console.log('⏰ 已达到最大步数，流程终止。');
    const finalAnswer = '抱歉，我无法在限定步数内完成这个任务。';
    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(finalAnswer, 'assistant'));
    return finalAnswer;
  }

  _parseOutput(text) {
    const thoughtMatch = text.match(/Thought: (.*)/);
    const actionMatch = text.match(/Action: (.*)/);
    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : null,
      action: actionMatch ? actionMatch[1].trim() : null,
    };
  }

  _parseAction(actionText) {
    const match = actionText.match(/^(\w+)\[(.*)\]$/);
    if (match) return { toolName: match[1], toolInput: match[2] };
    return { toolName: null, toolInput: null };
  }

  _parseActionInput(actionText) {
    const match = actionText.match(/^\w+\[(.*)\]$/);
    return match ? match[1] : '';
  }
}