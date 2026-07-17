/**
 * 第九章示例：上下文工程
 *
 * 本示例展示如何使用 ContextBuilder 的 GSSC 流水线（Gather-Select-Structure-Compress）
 * 构建结构化上下文，并与 Agent 集成。
 *
 * 由于 JS 版尚未实现 MemoryTool / RAGTool，此处使用 Mock 工具演示。
 */

import {
  ContextBuilder,
  ContextConfig,
  ContextPacket,
} from '../src/context/index.js';
import { Message } from '../src/core/message.js';
import { SimpleAgent, HelloAgentsLLM } from '../src/index.js';

// ─── Mock 工具 ──────────────────────────────────────────────

class MockMemoryTool {
  constructor() {
    this.memories = [];
  }

  addMemory(content, memoryType = 'working', importance = 0.5) {
    this.memories.push({ content, memoryType, importance });
  }

  async run(params) {
    const action = params.action;

    if (action === 'add') {
      this.memories.push({
        content: params.content,
        memoryType: params.memory_type || 'working',
        importance: params.importance || 0.5,
      });
      return '✅ 记忆已添加';
    }

    if (action === 'search') {
      const query = (params.query || '').toLowerCase();
      const minImportance = params.min_importance ?? 0;
      const limit = params.limit ?? 5;

      const matched = this.memories
        .filter(m => m.importance >= minImportance)
        .filter(m => m.content.toLowerCase().includes(query) || query.includes('任务'))
        .slice(0, limit);

      if (matched.length === 0) return '未找到';

      return matched.map(m => `记忆: ${m.content} (重要性: ${m.importance})`).join('\n');
    }

    return '未找到';
  }
}

class MockRAGTool {
  constructor() {
    this.documents = [
      'Pandas内存优化的核心策略包括:\n1. 使用合适的数据类型(如category代替object)\n2. 分块读取大文件\n3. 使用 chunksize 参数',
      '数据类型优化可以显著减少内存占用。例如,将int64降级为int32可以节省50%的内存。',
      'Pandas 2.0引入了PyArrow支持,可以更高效地处理大规模数据。',
    ];
  }

  async run(params) {
    if (params.action !== 'search') return '未找到';

    const query = (params.query || '').toLowerCase();
    const matched = this.documents.filter(d =>
      d.toLowerCase().includes('pandas') || d.toLowerCase().includes('内存') || d.toLowerCase().includes('数据'),
    );

    if (matched.length === 0) return '未找到';

    return matched.slice(0, params.limit || 5).join('\n---\n');
  }
}

// ─── 1. 基础使用 ──────────────────────────────────────────

async function basicUsage() {
  console.log('=== 上下文工程示例 ===\n');

  const memoryTool = new MockMemoryTool();
  const ragTool = new MockRAGTool();

  const config = new ContextConfig({
    maxTokens: 3000,
    reserveRatio: 0.2,
    minRelevance: 0.2,
    enableCompression: true,
  });

  const builder = new ContextBuilder({
    memoryTool,
    ragTool,
    config,
  });

  const conversationHistory = [
    new Message('我正在开发一个数据分析工具', 'user'),
    new Message('很好!数据分析工具通常需要处理大量数据。您计划使用什么技术栈?', 'assistant'),
    new Message('我打算使用Python和Pandas,已经完成了CSV读取模块', 'user'),
    new Message('不错的选择!Pandas在数据处理方面非常强大。接下来您可能需要考虑数据清洗和转换。', 'assistant'),
  ];

  memoryTool.addMemory('用户正在开发数据分析工具,使用Python和Pandas', 'semantic', 0.8);
  memoryTool.addMemory('已完成CSV读取模块的开发', 'episodic', 0.7);

  const context = await builder.build({
    userQuery: '如何优化Pandas的内存占用?',
    conversationHistory,
    systemInstructions: '你是一位资深的Python数据工程顾问。你的回答需要:1) 提供具体可行的建议 2) 解释技术原理 3) 给出代码示例',
  });

  console.log('='.repeat(80));
  console.log('构建的上下文:');
  console.log('='.repeat(80));
  console.log(context);
  console.log('='.repeat(80));
  console.log();
}

// ─── 2. 与 Agent 集成 ────────────────────────────────────

class ContextAwareAgent extends SimpleAgent {
  constructor({ name, llm, systemPrompt = '', memoryTool = null, ragTool = null }) {
    super({ name, llm, systemPrompt });
    this.memoryTool = memoryTool || new MockMemoryTool();
    this.ragTool = ragTool || new MockRAGTool();
    this.contextBuilder = new ContextBuilder({
      memoryTool: this.memoryTool,
      ragTool: this.ragTool,
      config: new ContextConfig({ maxTokens: 4000 }),
    });
    this.conversationHistory = [];
  }

  async run(userInput) {
    const optimizedContext = await this.contextBuilder.build({
      userQuery: userInput,
      conversationHistory: this.conversationHistory,
      systemInstructions: this.systemPrompt,
    });

    const messages = [
      { role: 'system', content: optimizedContext },
      { role: 'user', content: userInput },
    ];

    const response = await this.llm.invoke(messages);

    this.conversationHistory.push(new Message(userInput, 'user'));
    this.conversationHistory.push(new Message(response, 'assistant'));

    await this.memoryTool.run({
      action: 'add',
      content: `Q: ${userInput}\nA: ${response.slice(0, 200)}...`,
      memory_type: 'episodic',
      importance: 0.6,
    });

    return response;
  }
}

async function agentIntegrationDemo() {
  console.log('--- ContextAwareAgent 集成示例 ---\n');

  const llm = new HelloAgentsLLM();
  const memoryTool = new MockMemoryTool();
  const ragTool = new MockRAGTool();

  const agent = new ContextAwareAgent({
    name: '数据分析顾问',
    llm,
    systemPrompt: '你是一位资深的Python数据工程顾问。',
    memoryTool,
    ragTool,
  });

  const response = await agent.run('如何优化Pandas的内存占用?');
  console.log(`Response: ${response}\n`);
}

// ─── 3. 额外包（additionalPackets）示例 ──────────────────

async function additionalPacketsDemo() {
  console.log('--- 额外包 (additionalPackets) 示例 ---\n');

  const builder = new ContextBuilder({
    config: new ContextConfig({ maxTokens: 4000 }),
  });

  const customPackets = [
    new ContextPacket({
      content: '工具结果: df.memory_usage(deep=True) 显示 Pandas 内存 数据 使用 int64 列占用 120MB',
      metadata: { type: 'tool_result' },
    }),
  ];

  const context = await builder.build({
    userQuery: 'Pandas 内存优化 数据类型',
    conversationHistory: [],
    systemInstructions: '你是数据分析助手',
    additionalPackets: customPackets,
  });

  console.log('='.repeat(80));
  console.log(context);
  console.log('='.repeat(80));
  console.log();
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  await basicUsage();
  await additionalPacketsDemo();
  // 取消注释以下行以测试与 Agent 的集成（需要配置 .env 中的 LLM API）
  // await agentIntegrationDemo();
}

main().catch(console.error);