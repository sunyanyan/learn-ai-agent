#!/usr/bin/env node
/**
 * 在 Agent 中使用天气 MCP 服务器（JS 版）
 *
 * 对应 Python 教程：16_weather_mcp_agent.py
 * 使用 SimpleAgent + MCPTool 连接自定义天气 MCP 服务器，
 * 支持两种运行模式：
 *   node weather_mcp_agent.js demo       — 单次演示
 *   node weather_mcp_agent.js            — 交互模式
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { SimpleAgent, HelloAgentsLLM } from '../src/index.js';
import { MCPTool } from '../src/tools/index.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, 'weather_mcp_server.js');

function createWeatherAssistant() {
  const llm = new HelloAgentsLLM();

  const assistant = new SimpleAgent({
    name: '天气助手',
    llm,
    systemPrompt: '你是天气助手，可以查询城市天气。\n使用 get_weather 工具查询天气，支持中文城市名。\n',
  });

  const weatherTool = new MCPTool({
    name: 'weather',
    description: '天气查询 MCP 工具',
    serverCommand: ['node', serverScript],
    autoExpand: true,
  });

  assistant.addTool(weatherTool);
  assistant.enableToolCalling = true;

  return assistant;
}

async function demo() {
  const assistant = createWeatherAssistant();
  console.log('\n查询北京天气：');
  const response = await assistant.run('北京今天天气怎么样？');
  console.log(`回答: ${response}\n`);
}

async function interactive() {
  const assistant = createWeatherAssistant();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('\n你: ', async (input) => {
      const trimmed = input.trim();
      if (['quit', 'exit', 'q'].includes(trimmed.toLowerCase())) {
        rl.close();
        return;
      }
      if (!trimmed) {
        ask();
        return;
      }
      try {
        const response = await assistant.run(trimmed);
        console.log(`助手: ${response}`);
      } catch (e) {
        console.error(`❌ 错误: ${e.message}`);
      }
      ask();
    });
  };

  console.log('天气助手已启动，输入 quit/exit 退出。');
  ask();
}

const mode = process.argv[2];
if (mode === 'demo') {
  demo().catch(console.error);
} else {
  interactive();
}