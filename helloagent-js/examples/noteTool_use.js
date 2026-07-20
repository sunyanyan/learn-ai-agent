/**
 * 第九章示例：NoteTool 结构化笔记与 ContextBuilder 的集成
 *
 * 对应第九章 9.4 节（NoteTool：结构化笔记）及 9.4.4 完整使用示例。
 *
 * 本示例展示如何：
 * 1. 使用 NoteTool 进行笔记的增删改查（场景1：长期项目追踪）
 * 2. 通过 ProjectAssistant 将 NoteTool 检索到的笔记注入到
 *    ContextBuilder 的 GSSC 流水线中，实现长时程任务的上下文管理
 *
 * 由于 JS 版尚未实现 MemoryTool / RAGTool，ContextBuilder 的
 * memoryTool / ragTool 使用 Mock 工具演示，仅 NoteTool 使用真实实现。
 */

import { promises as fs } from 'fs';
import { join } from 'path';

import { NoteTool } from '../src/tools/builtin/note.js';
import { ContextBuilder, ContextConfig, ContextPacket } from '../src/context/index.js';
import { Message } from '../src/core/message.js';
import { SimpleAgent, HelloAgentsLLM } from '../src/index.js';

// ─── Mock 工具（与 contextBuilder_use.js 一致） ───────────────────────────

class MockMemoryTool {
  constructor() { this.memories = []; }
  async run(params) {
    if (params.action === 'add') {
      this.memories.push({
        content: params.content,
        importance: params.importance ?? 0.5,
      });
      return '✅ 记忆已添加';
    }
    if (params.action === 'search') {
      const q = (params.query || '').toLowerCase();
      const matched = this.memories
        .filter(m => m.content.toLowerCase().includes(q) || q.includes('任务'))
        .slice(0, params.limit ?? 5);
      return matched.length === 0 ? '未找到' : matched.map(m => m.content).join('\n');
    }
    return '未找到';
  }
}

class MockRAGTool {
  constructor() {
    this.documents = [
      '使用合适的数据类型（如 category 代替 object）可显著减少 Pandas 内存占用。',
      '分块读取大文件时使用 chunksize 参数可以避免一次性加载全部数据。',
    ];
  }
  async run(params) {
    if (params.action !== 'search') return '未找到';
    const q = (params.query || '').toLowerCase();
    const matched = this.documents.filter(d =>
      d.toLowerCase().includes('pandas') || d.toLowerCase().includes('内存') || d.toLowerCase().includes(q));
    return matched.length === 0 ? '未找到' : matched.slice(0, params.limit ?? 5).join('\n---\n');
  }
}

// ─── 1. NoteTool 基础使用（对应 9.4.1 / 9.4.3） ──────────────────────────────

async function basicNoteToolDemo(workspace) {
  console.log('=== NoteTool 基础使用 ===\n');
  const notes = new NoteTool({ workspace });

  // 场景1：长期项目追踪
  console.log('--- 创建笔记 ---');
  const createRes1 = await notes.run({
    action: 'create',
    title: '重构项目 - 第一阶段',
    content: '已完成数据模型层的重构，测试覆盖率达到 85%。下一步将重构业务逻辑层。',
    noteType: 'task_state',
    tags: ['refactoring', 'phase1'],
  });
  console.log(createRes1);

  const createRes2 = await notes.run({
    action: 'create',
    title: '依赖冲突问题',
    content: '发现某些第三方库版本不兼容，需要解决。影响范围：业务逻辑层的 3 个模块。',
    noteType: 'blocker',
    tags: ['dependency', 'urgent'],
  });
  console.log(createRes2);

  const createRes3 = await notes.run({
    action: 'create',
    title: '下一步计划',
    content: '1. 重构业务逻辑层\n2. 解决依赖冲突\n3. 提升集成测试覆盖率至 85%',
    noteType: 'action',
    tags: ['planning'],
  });
  console.log(createRes3 + '\n');

  // 列出笔记
  console.log('--- 列出全部笔记 ---');
  console.log(await notes.run({ action: 'list', limit: 10 }));

  // 按类型筛选
  console.log('--- 仅列出 blocker 笔记 ---');
  console.log(await notes.run({ action: 'list', noteType: 'blocker' }));

  // 搜索
  console.log('--- 搜索「依赖」 ---');
  console.log(await notes.run({ action: 'search', query: '依赖' }));

  // 摘要
  console.log('--- 笔记摘要 ---');
  console.log(await notes.run({ action: 'summary' }));
}

// ─── 2. ProjectAssistant：NoteTool 与 ContextBuilder 深度集成（对应 9.4.4） ──

class ProjectAssistant extends SimpleAgent {
  constructor({ name, projectName, llm = null, workspace }) {
    super({ name, llm: llm || new HelloAgentsLLM(), systemPrompt: '' });
    this.projectName = projectName;
    this.workspace = workspace;

    this.memoryTool = new MockMemoryTool();
    this.ragTool = new MockRAGTool();
    this.noteTool = new NoteTool({ workspace: join(workspace, `${projectName}_notes`) });

    this.contextBuilder = new ContextBuilder({
      memoryTool: this.memoryTool,
      ragTool: this.ragTool,
      config: new ContextConfig({ maxTokens: 4000, minRelevance: 0.1 }),
    });

    this.conversationHistory = [];
  }

  async run(userInput, { saveAsNote = false } = {}) {
    const relevantNotes = await this._retrieveRelevantNotes(userInput);
    const notePackets = this._notesToPackets(relevantNotes);

    const context = await this.contextBuilder.build({
      userQuery: userInput,
      conversationHistory: this.conversationHistory,
      systemInstructions: this._buildSystemInstructions(),
      additionalPackets: notePackets,
    });

    console.log('='.repeat(60));
    console.log('构建的上下文：');
    console.log('='.repeat(60));
    console.log(context);
    console.log('='.repeat(60));

    let response;
    try {
      const messages = [
        { role: 'system', content: context },
        { role: 'user', content: userInput },
      ];
      response = await this.llm.invoke(messages);
    } catch (e) {
      response = `（LLM 调用失败：${e.message || e}，此处为示例占位回复）`;
    }

    if (saveAsNote) await this._saveAsNote(userInput, response);

    this.conversationHistory.push(new Message(userInput, 'user'));
    this.conversationHistory.push(new Message(response, 'assistant'));
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }

    return response;
  }

  async _retrieveRelevantNotes(query, limit = 3) {
    try {
      const blockers = await this.noteTool.listAsObjects({ noteType: 'blocker', limit: 2 });
      const searchResults = await this.noteTool.searchAsObjects({ query, limit });
      const merged = new Map();
      for (const n of blockers) merged.set(n.id, n);
      for (const n of searchResults) merged.set(n.id, n);
      return [...merged.values()].slice(0, limit);
    } catch (e) {
      console.warn(`⚠️ 笔记检索失败: ${e.message || e}`);
      return [];
    }
  }

  _notesToPackets(notes) {
    const stateTypes = ['task_state', 'blocker', 'action'];
    return notes.map(note => {
      const content = `[笔记: ${note.title}]\n${note.content || ''}`;
      const timestamp = note.updated_at ? new Date(note.updated_at) : new Date();
      const ctxType = stateTypes.includes(note.type) ? 'task_state' : 'knowledge_base';
      return new ContextPacket({
        content,
        timestamp,
        relevanceScore: 0.75,
        metadata: { type: ctxType, noteType: note.type, noteId: note.id },
      });
    });
  }

  async _saveAsNote(userInput, response) {
    try {
      let noteType = 'conclusion';
      if (/问题|阻塞|冲突/.test(userInput)) noteType = 'blocker';
      else if (/计划|下一步|规划/.test(userInput)) noteType = 'action';

      await this.noteTool.run({
        action: 'create',
        title: userInput.slice(0, 30) + (userInput.length > 30 ? '...' : ''),
        content: `## 问题\n${userInput}\n\n## 分析\n${response}`,
        noteType,
        tags: [this.projectName, 'auto_generated'],
      });
    } catch (e) {
      console.warn(`⚠️ 保存笔记失败: ${e.message || e}`);
    }
  }

  _buildSystemInstructions() {
    return `你是 ${this.projectName} 项目的长期助手。

你的职责：
1. 基于历史笔记提供连贯的建议
2. 追踪项目进展和待解决问题
3. 在回答时引用相关的历史笔记
4. 提供具体、可操作的下一步建议

注意：
- 优先关注标记为 blocker 的问题
- 在建议中说明依据来源（笔记、记忆或知识库）
- 保持对项目整体进度的认识`;
  }
}

async function projectAssistantDemo(workspace) {
  console.log('\n=== ProjectAssistant：NoteTool + ContextBuilder 集成 ===\n');

  const assistant = new ProjectAssistant({
    name: '项目助手',
    projectName: 'data_pipeline_refactoring',
    workspace,
  });

  // 先注入一些历史笔记
  await assistant.noteTool.run({
    action: 'create',
    title: '重构项目 - 第一阶段',
    content: '已完成数据模型层的重构，测试覆盖率达到 85%。下一步将重构业务逻辑层。',
    noteType: 'task_state',
    tags: ['refactoring', 'phase1'],
  });
  await assistant.noteTool.run({
    action: 'create',
    title: '依赖冲突问题',
    content: '在重构业务逻辑层时发现 numpy 和 pandas 版本不兼容，影响 3 个模块。',
    noteType: 'blocker',
    tags: ['dependency', 'urgent'],
  });

  console.log('--- 第一次对话：记录项目状态 ---\n');
  const r1 = await assistant.run(
    '我们已经完成了数据模型层的重构，测试覆盖率达到 85%。下一步计划重构业务逻辑层。',
    { saveAsNote: true },
  );
  console.log(`\n助手回复：\n${r1}\n`);

  console.log('--- 第二次对话：提出问题 ---\n');
  const r2 = await assistant.run(
    '在重构业务逻辑层时，我遇到了依赖版本冲突的问题，该如何解决？',
    { saveAsNote: true },
  );
  console.log(`\n助手回复：\n${r2}\n`);

  console.log('--- 查看笔记摘要 ---');
  console.log(await assistant.noteTool.run({ action: 'summary' }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tmpRoot = `/tmp/helloagent_note_demo_${Date.now()}`;
  await fs.mkdir(tmpRoot, { recursive: true });
  const noteWorkspace = join(tmpRoot, 'project_notes');

  try {
    await basicNoteToolDemo(noteWorkspace);
    await projectAssistantDemo(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    console.log('🧹 临时目录已清理');
  }
}

main().catch(console.error);