import { Agent } from '../core/agent.js';
import { Message } from '../core/message.js';

const DEFAULT_PLANNER_PROMPT = `
你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个JSON数组，其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划:
\`\`\`json
["步骤1", "步骤2", "步骤3", ...]
\`\`\`
`;

const DEFAULT_EXECUTOR_PROMPT = `
你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决"当前步骤"，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{currentStep}

请仅输出针对"当前步骤"的回答:
`;

class Planner {
  constructor(llmClient, promptTemplate = null) {
    this.llmClient = llmClient;
    this.promptTemplate = promptTemplate || DEFAULT_PLANNER_PROMPT;
  }

  async plan(question, kwargs = {}) {
    const prompt = this.promptTemplate.replace('{question}', question);
    const messages = [{ role: 'user', content: prompt }];

    console.log('--- 正在生成计划 ---');
    const responseText = (await this.llmClient.invoke(messages, kwargs)) || '';
    console.log(`✅ 计划已生成:\n${responseText}`);

    try {
      const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonBlockMatch ? jsonBlockMatch[1].trim() : responseText.trim();
      const plan = JSON.parse(jsonStr);
      return Array.isArray(plan) ? plan : [];
    } catch (e) {
      console.error(`❌ 解析计划时出错: ${e.message}`);
      return [];
    }
  }
}

class Executor {
  constructor(llmClient, promptTemplate = null) {
    this.llmClient = llmClient;
    this.promptTemplate = promptTemplate || DEFAULT_EXECUTOR_PROMPT;
  }

  async execute(question, plan, kwargs = {}) {
    let history = '';
    let finalAnswer = '';

    console.log('\n--- 正在执行计划 ---');
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      console.log(`\n-> 正在执行步骤 ${i + 1}/${plan.length}: ${step}`);
      const prompt = this.promptTemplate
        .replace('{question}', question)
        .replace('{plan}', JSON.stringify(plan))
        .replace('{history}', history || '无')
        .replace('{currentStep}', step);

      const messages = [{ role: 'user', content: prompt }];
      const responseText = (await this.llmClient.invoke(messages, kwargs)) || '';

      history += `步骤 ${i + 1}: ${step}\n结果: ${responseText}\n\n`;
      finalAnswer = responseText;
      console.log(`✅ 步骤 ${i + 1} 已完成，结果: ${finalAnswer}`);
    }

    return finalAnswer;
  }
}

export class PlanAndSolveAgent extends Agent {
  constructor({
    name, llm, systemPrompt = null, config = null,
    customPrompts = null,
  }) {
    super({ name, llm, systemPrompt, config });

    const plannerPrompt = customPrompts?.planner || null;
    const executorPrompt = customPrompts?.executor || null;
    this.planner = new Planner(this.llm, plannerPrompt);
    this.executor = new Executor(this.llm, executorPrompt);
  }

  async run(inputText, kwargs = {}) {
    console.log(`\n🤖 ${this.name} 开始处理问题: ${inputText}`);

    const plan = await this.planner.plan(inputText, kwargs);
    if (plan.length === 0) {
      const finalAnswer = '无法生成有效的行动计划，任务终止。';
      console.log(`\n--- 任务终止 ---\n${finalAnswer}`);
      this.addMessage(new Message(inputText, 'user'));
      this.addMessage(new Message(finalAnswer, 'assistant'));
      return finalAnswer;
    }

    const finalAnswer = await this.executor.execute(inputText, plan, kwargs);
    console.log(`\n--- 任务完成 ---\n最终答案: ${finalAnswer}`);

    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(finalAnswer, 'assistant'));
    return finalAnswer;
  }
}