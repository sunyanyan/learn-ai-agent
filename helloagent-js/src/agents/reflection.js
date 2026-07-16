import { Agent } from '../core/agent.js';
import { Message } from '../core/message.js';

const DEFAULT_PROMPTS = {
  initial: `\n请根据以下要求完成任务：\n\n任务: {task}\n\n请提供一个完整、准确的回答。\n`,
  reflect: `\n请仔细审查以下回答，并找出可能的问题或改进空间：\n\n# 原始任务:\n{task}\n\n# 当前回答:\n{content}\n\n请分析这个回答的质量，指出不足之处，并提出具体的改进建议。\n如果回答已经很好，请回答"无需改进"。\n`,
  refine: `\n请根据反馈意见改进你的回答：\n\n# 原始任务:\n{task}\n\n# 上一轮回答:\n{lastAttempt}\n\n# 反馈意见:\n{feedback}\n\n请提供一个改进后的回答。\n`,
};

class Memory {
  constructor() {
    this.records = [];
  }

  addRecord(recordType, content) {
    this.records.push({ type: recordType, content });
    console.log(`📝 记忆已更新，新增一条 '${recordType}' 记录。`);
  }

  getTrajectory() {
    let trajectory = '';
    for (const record of this.records) {
      if (record.type === 'execution') {
        trajectory += `--- 上一轮尝试 (代码) ---\n${record.content}\n\n`;
      } else if (record.type === 'reflection') {
        trajectory += `--- 评审员反馈 ---\n${record.content}\n\n`;
      }
    }
    return trajectory.trim();
  }

  getLastExecution() {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].type === 'execution') return this.records[i].content;
    }
    return '';
  }
}

export class ReflectionAgent extends Agent {
  constructor({
    name, llm, systemPrompt = null, config = null,
    maxIterations = 3, customPrompts = null,
  }) {
    super({ name, llm, systemPrompt, config });
    this.maxIterations = maxIterations;
    this.memory = new Memory();
    this.prompts = customPrompts || DEFAULT_PROMPTS;
  }

  async run(inputText, kwargs = {}) {
    console.log(`\n🤖 ${this.name} 开始处理任务: ${inputText}`);
    this.memory = new Memory();

    console.log('\n--- 正在进行初始尝试 ---');
    const initialPrompt = this.prompts.initial.replace('{task}', inputText);
    const initialResult = await this._getLlmResponse(initialPrompt, kwargs);
    this.memory.addRecord('execution', initialResult);

    for (let i = 0; i < this.maxIterations; i++) {
      console.log(`\n--- 第 ${i + 1}/${this.maxIterations} 轮迭代 ---`);

      console.log('\n-> 正在进行反思...');
      const lastResult = this.memory.getLastExecution();
      const reflectPrompt = this.prompts.reflect
        .replace('{task}', inputText)
        .replace('{content}', lastResult);
      const feedback = await this._getLlmResponse(reflectPrompt, kwargs);
      this.memory.addRecord('reflection', feedback);

      if (feedback.includes('无需改进') || feedback.toLowerCase().includes('no need for improvement')) {
        console.log('\n✅ 反思认为结果已无需改进，任务完成。');
        break;
      }

      console.log('\n-> 正在进行优化...');
      const refinePrompt = this.prompts.refine
        .replace('{task}', inputText)
        .replace('{lastAttempt}', lastResult)
        .replace('{feedback}', feedback);
      const refinedResult = await this._getLlmResponse(refinePrompt, kwargs);
      this.memory.addRecord('execution', refinedResult);
    }

    const finalResult = this.memory.getLastExecution();
    console.log(`\n--- 任务完成 ---\n最终结果:\n${finalResult}`);

    this.addMessage(new Message(inputText, 'user'));
    this.addMessage(new Message(finalResult, 'assistant'));
    return finalResult;
  }

  async _getLlmResponse(prompt, kwargs = {}) {
    const messages = [{ role: 'user', content: prompt }];
    return (await this.llm.invoke(messages, kwargs)) || '';
  }
}