import { ToolRegistry } from './registry.js';

export class ToolChain {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.steps = [];
  }

  addStep(toolName, inputTemplate, outputKey = null) {
    const key = outputKey || `step_${this.steps.length}_result`;
    this.steps.push({ toolName, inputTemplate, outputKey: key });
    console.log(`✅ 工具链 '${this.name}' 添加步骤: ${toolName}`);
  }

  /**
   * @param {ToolRegistry} registry
   * @param {string} inputData
   * @param {Object} [context]
   */
  async execute(registry, inputData, context = {}) {
    if (this.steps.length === 0) return '❌ 工具链为空，无法执行';

    console.log(`🚀 开始执行工具链: ${this.name}`);
    context.input = inputData;
    let finalResult = inputData;

    for (let i = 0; i < this.steps.length; i++) {
      const { toolName, inputTemplate, outputKey } = this.steps[i];
      console.log(`📝 执行步骤 ${i + 1}/${this.steps.length}: ${toolName}`);

      let actualInput;
      try {
        actualInput = inputTemplate.replace(/\{(\w+)\}/g, (_, key) => context[key] ?? '');
      } catch (e) {
        return `❌ 模板变量替换失败: ${e.message}`;
      }

      try {
        const result = await registry.executeTool(toolName, actualInput);
        context[outputKey] = result;
        finalResult = result;
        console.log(`✅ 步骤 ${i + 1} 完成`);
      } catch (e) {
        return `❌ 工具 '${toolName}' 执行失败: ${e.message}`;
      }
    }

    console.log(`🎉 工具链 '${this.name}' 执行完成`);
    return finalResult;
  }
}

export class ToolChainManager {
  constructor(registry) {
    this.registry = registry;
    this.chains = new Map();
  }

  registerChain(chain) {
    this.chains.set(chain.name, chain);
    console.log(`✅ 工具链 '${chain.name}' 已注册`);
  }

  async executeChain(chainName, inputData, context = {}) {
    if (!this.chains.has(chainName)) return `❌ 工具链 '${chainName}' 不存在`;
    return await this.chains.get(chainName).execute(this.registry, inputData, context);
  }

  listChains() {
    return [...this.chains.keys()];
  }

  getChainInfo(chainName) {
    if (!this.chains.has(chainName)) return null;
    const chain = this.chains.get(chainName);
    return {
      name: chain.name,
      description: chain.description,
      steps: chain.steps.length,
      stepDetails: chain.steps.map(s => ({
        toolName: s.toolName,
        inputTemplate: s.inputTemplate,
        outputKey: s.outputKey,
      })),
    };
  }
}

export function createResearchChain() {
  const chain = new ToolChain('research_and_calculate', '搜索信息并进行相关计算');
  chain.addStep('search', '{input}', 'search_result');
  chain.addStep('my_calculator', '2 + 2', 'calc_result');
  return chain;
}

export function createSimpleChain() {
  const chain = new ToolChain('simple_demo', '简单的工具链演示');
  chain.addStep('my_calculator', '{input}', 'result');
  return chain;
}