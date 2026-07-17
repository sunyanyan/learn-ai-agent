import { SimpleAgent, ReActAgent, ReflectionAgent, PlanAndSolveAgent,
  HelloAgentsLLM, ToolRegistry, CalculatorTool, SearchTool } from '../src/index.js';

// Shared LLM instance
const llm = new HelloAgentsLLM();

// 1. SimpleAgent
async function simpleAgentDemo() {
  console.log(`=== HelloAgents JS v0.2.9 ===`);
  console.log(`Provider: ${llm.provider}, Model: ${llm.model}`);
  console.log('');

  console.log('--- SimpleAgent Demo ---');
  const agent = new SimpleAgent({
    name: 'AI助手',
    llm,
    systemPrompt: '你是一个有用的AI助手',
  });
  const response = await agent.run('你好！请介绍一下自己');
  console.log(`Response: ${response}`);
  console.log('');

  return agent;
}

// 2. ReActAgent with tools
async function reactAgentDemo() {
  console.log('--- ReActAgent Demo ---');
  const registry = new ToolRegistry();
  registry.registerTool(new CalculatorTool());

  const reactAgent = new ReActAgent({
    name: '研究助手',
    llm,
    toolRegistry: registry,
    maxSteps: 5,
  });
  const result = await reactAgent.run('计算 2 + 3 * 4 的结果');
  console.log(`Result: ${result}`);
  console.log('');
}

// 3. ReflectionAgent
async function reflectionAgentDemo() {
  console.log('--- ReflectionAgent Demo ---');
  const reflectionAgent = new ReflectionAgent({
    name: '代码专家',
    llm,
    maxIterations: 2,
  });
  const code = await reflectionAgent.run('编写一个简单的冒泡排序算法');
  console.log(`Code: ${code}`);
  console.log('');
}

// 4. PlanAndSolveAgent
async function planAndSolveAgentDemo() {
  console.log('--- PlanAndSolveAgent Demo ---');
  const planAgent = new PlanAndSolveAgent({ name: '问题解决专家', llm });
  const answer = await planAgent.run('一家公司第一年营收100万，第二年增长20%，第三年增长15%。如果每年的成本是营收的70%，请计算三年的总利润。');
  console.log(`Answer: ${answer}`);
  console.log('');
}

// 5. Stream demo
async function streamDemo(agent) {
  console.log('--- Stream Demo ---');
  console.log('助手: ');
  for await (const chunk of agent.streamRun('什么是人工智能？')) {
    process.stdout.write(chunk);
  }
  console.log();
}

async function main() {
  // const agent = await simpleAgentDemo();
  // await reactAgentDemo();
  // await reflectionAgentDemo();
  await planAndSolveAgentDemo();
  // await streamDemo(agent);
}

main().catch(console.error);