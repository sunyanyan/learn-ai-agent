/**
 * 第九章示例：TerminalTool 与其他工具的协同
 *
 * 对应第九章 9.5.4 节「与其他工具的协同」中的 (2) 与 NoteTool 协同、
 * (3) 与 ContextBuilder 协同（不含与 MemoryTool 协同示例）。
 *
 * 本示例展示如何：
 * 1. 使用 TerminalTool 即时检索日志文件，将发现的问题记录为 NoteTool 结构化笔记
 * 2. 使用 TerminalTool 探索代码库结构，将输出转换为 ContextPacket，
 *    交给 ContextBuilder 的 GSSC 流水线构建结构化上下文
 *
 * 注意：原书 Python 示例中使用了 `git log --oneline -10` 命令，
 * 但 `git` 不在 TerminalTool 的命令白名单中。此处用白名单内的
 * `find . -name '*.js' | head -n 10` 替代，演示相同思路。
 */

import { promises as fs } from 'fs';
import { join } from 'path';

import { TerminalTool } from '../src/tools/builtin/terminal.js';
import { NoteTool } from '../src/tools/builtin/note.js';
import { ContextBuilder, ContextConfig, ContextPacket } from '../src/context/index.js';

// ─── 1. 与 NoteTool 协同（对应 9.5.4 (2)） ──────────────────────────────────

async function terminalWithNoteDemo(workspace) {
  console.log('=== TerminalTool + NoteTool 协同 ===\n');

  // 准备测试用日志文件
  const logDir = join(workspace, 'logs');
  await fs.mkdir(logDir, { recursive: true });
  const logContent = [
    '2025-01-18 10:00:00 INFO  Server started on port 8080',
    '2025-01-18 10:05:00 WARN  Cache miss ratio high: 0.35',
    '2025-01-18 10:10:00 ERROR slow query: SELECT * FROM orders WHERE status=1 (took 5.2s)',
    '2025-01-18 10:15:00 ERROR slow query: SELECT * FROM users JOIN orders ON ... (took 3.8s)',
    '2025-01-18 10:20:00 INFO  Request processed: /api/health',
    '2025-01-18 10:25:00 ERROR slow query: UPDATE products SET stock=stock-1 WHERE id=42 (took 4.1s)',
    '2025-01-18 10:30:00 INFO  Backup completed successfully',
  ].join('\n');
  await fs.writeFile(join(logDir, 'app.log'), logContent, 'utf-8');

  // 初始化工具
  const terminal = new TerminalTool({ workspace, timeout: 10 });
  const noteTool = new NoteTool({ workspace: join(workspace, 'notes') });

  // 步骤1：使用 TerminalTool 发现性能瓶颈
  console.log('--- 步骤1：TerminalTool 检索日志中的慢查询 ---\n');
  const logAnalysis = await terminal.run({
    command: "grep 'slow query' logs/app.log | tail -n 10",
  });
  console.log('TerminalTool 输出：');
  console.log(logAnalysis);
  console.log();

  // 步骤2：将发现记录为 blocker 笔记
  console.log('--- 步骤2：NoteTool 记录为结构化笔记 ---\n');
  const createResult = await noteTool.run({
    action: 'create',
    title: '数据库慢查询问题',
    content: `## 问题描述\n发现多个慢查询,影响系统性能\n\n## 日志分析\n\`\`\`\n${logAnalysis}\n\`\`\`\n\n## 下一步\n1. 分析慢查询SQL\n2. 添加索引\n3. 优化查询逻辑`,
    noteType: 'blocker',
    tags: ['performance', 'database'],
  });
  console.log(createResult);
  console.log();

  // 步骤3：验证笔记已保存
  console.log('--- 步骤3：验证笔记 ---\n');
  console.log(await noteTool.run({ action: 'list', noteType: 'blocker' }));
}

// ─── 2. 与 ContextBuilder 协同（对应 9.5.4 (3)） ────────────────────────────

async function terminalWithContextBuilderDemo(workspace) {
  console.log('=== TerminalTool + ContextBuilder 协同 ===\n');

  // 准备测试用代码库结构
  const srcDir = join(workspace, 'src');
  await fs.mkdir(join(srcDir, 'models'), { recursive: true });
  await fs.mkdir(join(srcDir, 'services'), { recursive: true });
  await fs.mkdir(join(srcDir, 'api'), { recursive: true });
  await fs.writeFile(join(srcDir, 'models', 'user.js'), 'export class User {}', 'utf-8');
  await fs.writeFile(join(srcDir, 'models', 'order.js'), 'export class Order {}', 'utf-8');
  await fs.writeFile(join(srcDir, 'services', 'userService.js'), 'export class UserService {}', 'utf-8');
  await fs.writeFile(join(srcDir, 'services', 'orderService.js'), 'export class OrderService {}', 'utf-8');
  await fs.writeFile(join(srcDir, 'api', 'routes.js'), 'export function setupRoutes() {}', 'utf-8');
  await fs.writeFile(join(srcDir, 'index.js'), "import './models/user.js'", 'utf-8');

  // 初始化工具
  const terminal = new TerminalTool({ workspace, timeout: 10 });
  const contextBuilder = new ContextBuilder({
    config: new ContextConfig({ maxTokens: 4000, minRelevance: 0.1 }),
  });

  // 步骤1：使用 TerminalTool 探索代码库
  console.log('--- 步骤1：TerminalTool 探索代码库结构 ---\n');
  const codeStructure = await terminal.run({ command: 'ls -R src' });
  console.log('代码库结构：');
  console.log(codeStructure);
  console.log();

  // 使用白名单内的命令查看文件列表（原书使用 git log，但 git 不在白名单中）
  const recentChanges = await terminal.run({
    command: "find . -name '*.js' | head -n 10",
  });
  console.log('JS 文件列表（替代原书 git log）：');
  console.log(recentChanges);
  console.log();

  // 步骤2：转换为 ContextPacket
  console.log('--- 步骤2：将 TerminalTool 输出转换为 ContextPacket ---\n');
  const packets = [
    new ContextPacket({
      content: `代码库结构:\n${codeStructure}`,
      relevanceScore: 0.7,
      metadata: { type: 'tool_result', source: 'terminal', category: 'code_structure' },
    }),
    new ContextPacket({
      content: `JS 文件列表:\n${recentChanges}`,
      relevanceScore: 0.8,
      metadata: { type: 'tool_result', source: 'terminal', category: 'file_list' },
    }),
  ];
  console.log(`已创建 ${packets.length} 个 ContextPacket`);
  packets.forEach((p, i) => {
    console.log(`  [${i}] type=${p.metadata.type}, category=${p.metadata.category}, tokenCount=${p.tokenCount}`);
  });
  console.log();

  // 步骤3：在构建上下文时包含这些信息
  console.log('--- 步骤3：ContextBuilder 构建上下文 ---\n');
  const context = await contextBuilder.build({
    userQuery: '如何重构用户服务模块?',
    conversationHistory: [],
    systemInstructions: '你是一位资深的前端架构师,负责代码库维护和重构。',
    additionalPackets: packets,
  });

  console.log('='.repeat(60));
  console.log('构建的上下文：');
  console.log('='.repeat(60));
  console.log(context);
  console.log('='.repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tmpRoot = `/tmp/helloagent_terminal_demo_${Date.now()}`;
  await fs.mkdir(tmpRoot, { recursive: true });

  try {
    await terminalWithNoteDemo(tmpRoot);
    console.log('\n');
    await terminalWithContextBuilderDemo(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    console.log('\n🧹 临时目录已清理');
  }
}

main().catch(console.error);
