/**
 * MCP 智能文档助手示例
 *
 * 本示例展示如何：
 * 1. 使用 MCPServer 创建文档管理服务器（内存传输）
 * 2. 使用 MCPClient 通过 stdio 传输连接独立服务器进程
 * 3. 方式 1：使用内置演示服务器，MCPTool + SimpleAgent 构建智能文档助手
 * 4. 方式 2：连接外部 MCP 服务器（社区 npx 服务器 / 自定义 JS 服务器）
 * 5. 实战案例：多 Agent 协作的智能文档助手（GitHub 搜索 + 文档生成）
 * 6. 使用 MCP 协议工具函数（createContext, parseContext 等）
 */

import { SimpleAgent, HelloAgentsLLM, ToolRegistry } from '../src/index.js';
import {
  MCPServer, MCPClient, MCPServerBuilder,
  createContext, parseContext, createSuccessResponse, createErrorResponse,
} from '../src/protocols/index.js';
import { MCPTool } from '../src/tools/index.js';
import { promises as fs, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── 文档工具函数 ─────────────────────────────────────────────────────────────

/**
 * 规范化 MCP 传递的参数
 * MCP 服务器将参数作为对象传递（如 { directory: '.' }），
 * 但 generateInputSchema 对简单命名参数支持更好，因此需要解包
 */
function _normArg(arg, key, defaultValue) {
  if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
    return arg[key] ?? defaultValue;
  }
  return arg ?? defaultValue;
}

/** 列出目录中的文件 */
function listFiles(directory = '.') {
  const dir = _normArg(directory, 'directory', '.');
  const absDir = path.resolve(PROJECT_ROOT, dir);
  const entries = readdirSync(absDir);
  const files = entries.filter((f) => statSync(path.join(absDir, f)).isFile());
  return JSON.stringify({ files, count: files.length, directory: dir, success: true }, null, 2);
}

/** 读取文件内容 */
function readFile(filePath) {
  const fp = _normArg(filePath, 'filePath', '');
  if (!fp) return JSON.stringify({ error: '需要提供 filePath', success: false });
  const absPath = path.resolve(PROJECT_ROOT, fp);
  try {
    const content = readFileSync(absPath, 'utf-8');
    return JSON.stringify({ filePath: fp, content, success: true }, null, 2);
  } catch (e) {
    return JSON.stringify({ filePath: fp, error: e.message, success: false });
  }
}

/** 写入文件内容 */
function writeFile(filePath, content) {
  const fp = _normArg(filePath, 'filePath', '');
  const data = _normArg(content, 'content', '');
  if (!fp) return JSON.stringify({ error: '需要提供 filePath', success: false });
  const absPath = path.resolve(PROJECT_ROOT, fp);
  try {
    writeFileSync(absPath, data, 'utf-8');
    return JSON.stringify({ filePath: fp, bytesWritten: data.length, success: true }, null, 2);
  } catch (e) {
    return JSON.stringify({ filePath: fp, error: e.message, success: false });
  }
}

/** 在目录中搜索包含关键字的文件 */
function searchContent(keyword, directory = '.') {
  const kw = _normArg(keyword, 'keyword', '');
  const dir = _normArg(directory, 'directory', '.');
  if (!kw) return JSON.stringify({ error: '需要提供 keyword', success: false });
  const absDir = path.resolve(PROJECT_ROOT, dir);
  const entries = readdirSync(absDir);
  const results = [];
  for (const entry of entries) {
    const entryPath = path.join(absDir, entry);
    if (statSync(entryPath).isFile()) {
      try {
        const content = readFileSync(entryPath, 'utf-8');
        if (content.includes(kw)) {
          const lines = content.split('\n');
          const matches = lines
            .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
            .filter((l) => l.text.includes(kw));
          results.push({ file: entry, matches: matches.slice(0, 3) });
        }
      } catch { /* 跳过无法读取的文件 */ }
    }
  }
  return JSON.stringify({ keyword: kw, directory: dir, results, count: results.length, success: true }, null, 2);
}

// ─── Demo 1: MCP Server + Client (内存传输) ─────────────────────────────────

async function demo1_memoryTransport() {
  console.log('=== Demo 1: MCP Server + Client (内存传输) ===\n');

  // 创建文档管理 MCP 服务器
  const docServer = new MCPServer({
    name: 'doc-server',
    description: '提供文件列表、读取、写入和搜索功能的文档管理服务器',
  });

  // 注册文档工具
  docServer.addTool({ name: 'list_files', description: '列出指定目录中的文件', func: listFiles });
  docServer.addTool({ name: 'read_file', description: '读取指定文件的内容', func: readFile });
  docServer.addTool({ name: 'write_file', description: '向指定文件写入内容', func: writeFile });
  docServer.addTool({ name: 'search_content', description: '在目录中搜索包含关键字的文件', func: searchContent });

  console.log('🚀 文档服务器已创建，注册了 4 个工具\n');

  // 通过内存传输连接客户端
  const client = new MCPClient({ serverSource: docServer });
  await client.connect();
  console.log('🔗 MCPClient 已通过内存传输连接到服务器\n');

  // 列出可用工具
  console.log('📋 获取服务器工具列表...');
  const tools = await client.listTools();
  for (const t of tools) {
    console.log(`   • ${t.name}: ${t.description}`);
  }
  console.log('');

  // 调用 list_files 工具
  console.log('📁 调用 list_files 工具（目录: examples）...');
  const listResult = await client.callTool('list_files', { directory: 'examples' });
  console.log(listResult[0]?.text || JSON.stringify(listResult));
  console.log('');

  // 调用 read_file 工具
  console.log('📖 调用 read_file 工具（文件: package.json）...');
  const readResult = await client.callTool('read_file', { filePath: 'package.json' });
  const readData = JSON.parse(readResult[0]?.text || '{}');
  const pkg = readData.success ? JSON.parse(readData.content || '{}') : {};
  console.log(`   名称: ${pkg.name}, 版本: ${pkg.version}, 描述: ${pkg.description}`);
  console.log('');

  // 调用 search_content 工具
  console.log('🔍 调用 search_content 工具（关键字: agent）...');
  const searchResult = await client.callTool('search_content', { keyword: 'agent', directory: 'src' });
  const searchData = JSON.parse(searchResult[0]?.text || '{}');
  console.log(`   找到 ${searchData.count || 0} 个文件包含关键字 "agent"`);
  for (const r of searchData.results || []) {
    console.log(`   • ${r.file} (${r.matches?.length || 0} 处匹配)`);
  }
  console.log('');

  // 断开连接
  await client.disconnect();
  console.log('✅ Demo 1 完成\n');
}

// ─── Demo 2: MCP Server + Client (stdio 传输) ─────────────────────────────────

async function demo2_stdioTransport() {
  console.log('=== Demo 2: MCP Server + Client (stdio 传输) ===\n');

  // 创建独立的 stdio 服务器脚本内容
  const serverScript = `
import { MCPServer } from '${path.join(PROJECT_ROOT, 'src/protocols/mcp/server.js').replace(/\\/g, '\\\\')}';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = '${PROJECT_ROOT.replace(/\\/g, '\\\\')}';

function _normArg(arg, key, defaultValue) {
  if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
    return arg[key] ?? defaultValue;
  }
  return arg ?? defaultValue;
}

function listFiles(directory = '.') {
  const dir = _normArg(directory, 'directory', '.');
  const absDir = path.resolve(PROJECT_ROOT, dir);
  const entries = readdirSync(absDir);
  const files = entries.filter((f) => statSync(path.join(absDir, f)).isFile());
  return JSON.stringify({ files, count: files.length, directory: dir, success: true }, null, 2);
}

function readFile(filePath) {
  const fp = _normArg(filePath, 'filePath', '');
  if (!fp) return JSON.stringify({ error: '需要提供 filePath', success: false });
  const absPath = path.resolve(PROJECT_ROOT, fp);
  try {
    const content = readFileSync(absPath, 'utf-8');
    return JSON.stringify({ filePath: fp, content, success: true }, null, 2);
  } catch (e) {
    return JSON.stringify({ filePath: fp, error: e.message, success: false });
  }
}

const server = new MCPServer({ name: 'stdio-doc-server', description: 'stdio 文档服务器' });
server.addTool({ name: 'list_files', description: '列出文件', func: listFiles });
server.addTool({ name: 'read_file', description: '读取文件', func: readFile });
server.run({ transport: 'stdio' });
`;

  // 写入临时文件
  const tempFile = path.join('/tmp', `mcp_stdio_server_${Date.now()}.js`);
  await fs.writeFile(tempFile, serverScript, 'utf-8');
  console.log(`📝 临时服务器脚本已创建: ${tempFile}\n`);

  try {
    // 通过 stdio 传输连接（启动子进程）
    const client = new MCPClient({ serverSource: ['node', tempFile] });
    await client.connect();
    console.log('🔗 MCPClient 已通过 stdio 传输连接到子进程服务器\n');

    // 列出工具
    console.log('📋 获取 stdio 服务器工具列表...');
    const tools = await client.listTools();
    for (const t of tools) {
      console.log(`   • ${t.name}: ${t.description}`);
    }
    console.log('');

    // 调用工具
    console.log('📁 调用 list_files...');
    const listResult = await client.callTool('list_files', { directory: 'src' });
    const listData = JSON.parse(listResult[0]?.text || '{}');
    console.log(`   找到 ${listData.count || 0} 个文件`);
    console.log('');

    console.log('📖 调用 read_file（文件: README.md）...');
    const readResult = await client.callTool('read_file', { filePath: 'README.md' });
    const readData = JSON.parse(readResult[0]?.text || '{}');
    if (readData.success) {
      const preview = readData.content?.slice(0, 120).replace(/\\n/g, ' ') || '';
      console.log(`   内容预览: ${preview}...`);
    } else {
      console.log(`   ❌ 读取失败: ${readData.error}`);
    }
    console.log('');

    await client.disconnect();
    console.log('✅ Demo 2 完成\n');
  } finally {
    // 清理临时文件
    await fs.unlink(tempFile).catch(() => {});
    console.log('🧹 临时服务器脚本已清理\n');
  }
}

// ─── Demo 3: 智能文档助手 (MCPTool + SimpleAgent) ─────────────────────────────

async function demo3_docAssistant() {
  console.log('=== Demo 3: 智能文档助手 (MCPTool + SimpleAgent) ===\n');

  // 创建文档管理 MCP 服务器
  const docServer = new MCPServer({
    name: 'doc-assistant-server',
    description: '智能文档助手专用服务器',
  });

  docServer.addTool({ name: 'list_files', description: '列出指定目录中的文件', func: listFiles });
  docServer.addTool({ name: 'read_file', description: '读取指定文件的内容', func: readFile });
  docServer.addTool({ name: 'write_file', description: '向指定文件写入内容', func: writeFile });
  docServer.addTool({ name: 'search_content', description: '在目录中搜索包含关键字的文件', func: searchContent });

  console.log('🚀 文档助手服务器已创建\n');

  // 使用 MCPServerBuilder 链式 API 创建另一个服务器（展示构建器用法）
  new MCPServerBuilder({ name: 'builder-demo', description: '链式构建器演示' })
    .withTool({ name: 'greet', description: '发送问候', func: ({ name = '用户' }) => `你好，${name}！欢迎使用智能文档助手。` })
    .build();

  console.log('🏗️  通过 MCPServerBuilder 创建了额外的演示服务器\n');

  // 创建 MCPTool，自动展开为独立工具
  const mcpTool = new MCPTool({
    name: 'doc',
    description: '文档管理 MCP 工具集',
    server: docServer,
    autoExpand: true,
  });

  // 等待工具发现完成
  await mcpTool._discoveryPromise;
  console.log('🔍 MCP 工具发现完成\n');

  // 获取展开后的工具列表
  const expandedTools = mcpTool.getExpandedTools();
  console.log('📦 展开后的工具列表:');
  for (const t of expandedTools || []) {
    console.log(`   • ${t.name}: ${t.description}`);
    const params = t.getParameters();
    if (params.length > 0) {
      console.log(`     参数: ${params.map((p) => `${p.name}(${p.type}${p.required ? '' : ', 可选'})`).join(', ')}`);
    }
  }
  console.log('');

  // 创建 SimpleAgent 并注册展开的工具
  const llm = new HelloAgentsLLM();
  const agent = new SimpleAgent({
    name: '智能文档助手',
    llm,
    systemPrompt: '你是一个智能文档助手，可以帮助用户管理项目文件。你可以列出目录、读取文件、写入文件和搜索内容。当用户询问文件相关问题时，请使用可用的文档工具来获取准确信息。',
  });

  // 将展开的工具注册到 Agent
  const registry = new ToolRegistry();
  for (const tool of expandedTools || []) {
    registry.registerTool(tool);
  }
  agent.toolRegistry = registry;
  agent.enableToolCalling = true;

  console.log('🤖 智能文档助手已初始化，注册了 MCP 文档工具\n');

  // 演示查询 1：列出文件
  console.log('--- 查询 1: 列出当前目录有哪些文件？ ---');
  try {
    const response1 = await agent.run('列出 examples 目录有哪些文件？');
    console.log(`助手回复:\n${response1}\n`);
  } catch (e) {
    console.log(`⚠️ 查询 1 执行失败: ${e.message}\n`);
  }

  // 演示查询 2：读取文件
  console.log('--- 查询 2: 读取 package.json 的内容 ---');
  try {
    const response2 = await agent.run('读取 package.json 文件的内容，告诉我项目名称和版本');
    console.log(`助手回复:\n${response2}\n`);
  } catch (e) {
    console.log(`⚠️ 查询 2 执行失败: ${e.message}\n`);
  }

  // 演示查询 3：搜索内容
  console.log('--- 查询 3: 搜索包含 "agent" 的文件 ---');
  try {
    const response3 = await agent.run('在 src 目录中搜索包含 "agent" 关键字的文件');
    console.log(`助手回复:\n${response3}\n`);
  } catch (e) {
    console.log(`⚠️ 查询 3 执行失败: ${e.message}\n`);
  }

  console.log('✅ Demo 3 完成\n');
}

// ─── Demo 5: 方式 2 - 连接外部 MCP 服务器 ──────────────────────────────────────

async function demo5_externalServer() {
  console.log('=== Demo 5: 方式 2 - 连接外部 MCP 服务器 ===\n');

  // 示例 1：连接到社区提供的文件系统服务器（npx 方式）
  console.log('📡 示例 1：连接社区文件系统 MCP 服务器 (npx)\n');
  const fsTool = new MCPTool({
    name: 'filesystem',
    description: '访问本地文件系统',
    serverCommand: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '.'],
    autoExpand: true,
  });

  try {
    await fsTool._discoveryPromise;
    const expanded = fsTool.getExpandedTools();
    if (expanded && expanded.length > 0) {
      console.log(`✅ 成功连接，发现 ${expanded.length} 个工具：`);
      for (const t of expanded) {
        console.log(`   • ${t.name}: ${t.description}`);
      }

      // 调用工具读取文件
      console.log('\n📖 调用 read_text_file 读取 package.json...');
      const result = await fsTool.run({
        action: 'call_tool',
        toolName: 'read_text_file',
        arguments: { path: 'package.json' },
      });
      console.log(`   结果（前 200 字符）: ${result.slice(0, 200)}...`);
    } else {
      console.log('⚠️  未能发现工具（可能需要安装 npx 包）');
    }
  } catch (e) {
    console.log(`⚠️  社区服务器连接失败: ${e.message}`);
    console.log('   这通常是因为 npx 未安装或网络不可用。请确保已安装 Node.js 和 npm。\n');
  }

  console.log('');

  // 示例 2：连接到自定义的 JS MCP 服务器
  console.log('🛠️  示例 2：连接自定义 MCP 服务器 (Node.js 脚本)\n');

  // 创建一个自定义 MCP 服务器脚本
  const customServerScript = `
import { MCPServer } from '${path.join(PROJECT_ROOT, 'src/protocols/mcp/server.js').replace(/\\/g, '\\\\')}';

const server = new MCPServer({ name: 'custom-server', description: '自定义业务逻辑服务器' });

server.addTool({
  name: 'get_project_stats',
  description: '获取项目统计信息',
  func: () => JSON.stringify({ name: 'helloagent-js', tools: 10, agents: 6, version: '0.2.9' }),
});

server.addTool({
  name: 'format_code',
  description: '格式化代码片段',
  func: ({ code = '', language = 'javascript' } = {}) => {
    return JSON.stringify({ language, formatted: code.trim(), lines: code.split('\\n').length });
  },
});

server.run({ transport: 'stdio' });
`;

  const customServerFile = path.join('/tmp', `mcp_custom_server_${Date.now()}.js`);
  await fs.writeFile(customServerFile, customServerScript, 'utf-8');
  console.log(`📝 自定义服务器脚本已创建: ${customServerFile}\n`);

  try {
    const customTool = new MCPTool({
      name: 'custom',
      description: '自定义业务逻辑服务器',
      serverCommand: ['node', customServerFile],
      autoExpand: true,
    });

    await customTool._discoveryPromise;
    const expanded = customTool.getExpandedTools();

    if (expanded && expanded.length > 0) {
      console.log(`✅ 成功连接，发现 ${expanded.length} 个工具：`);
      for (const t of expanded) {
        console.log(`   • ${t.name}: ${t.description}`);
      }

      // 调用 get_project_stats
      console.log('\n📊 调用 get_project_stats...');
      const statsResult = await customTool.run({
        action: 'call_tool',
        toolName: 'get_project_stats',
        arguments: {},
      });
      console.log(`   结果: ${statsResult}`);

      // 调用 format_code
      console.log('\n📝 调用 format_code...');
      const formatResult = await customTool.run({
        action: 'call_tool',
        toolName: 'format_code',
        arguments: { code: 'const x = 1;', language: 'javascript' },
      });
      console.log(`   结果: ${formatResult}`);
    } else {
      console.log('⚠️  未能发现工具');
    }
  } catch (e) {
    console.log(`⚠️  自定义服务器连接失败: ${e.message}`);
  } finally {
    await fs.unlink(customServerFile).catch(() => {});
    console.log('🧹 自定义服务器脚本已清理');
  }

  console.log('\n✅ Demo 5 完成\n');
}

// ─── Demo 6: 实战案例 - 多 Agent 协作的智能文档助手 ─────────────────────────────

async function demo6_multiAgentDocAssistant() {
  console.log('=== Demo 6: 实战案例 - 多 Agent 协作的智能文档助手 ===\n');

  console.log('本案例使用两个 SimpleAgent 分工协作：');
  console.log('  Agent 1：GitHub 搜索专家 — 使用 GitHub MCP 服务搜索仓库');
  console.log('  Agent 2：文档生成专家 — 使用文件系统 MCP 服务生成报告\n');

  // ============================================================
  // Agent 1: GitHub 搜索专家
  // ============================================================
  console.log('【步骤 1】创建 GitHub 搜索专家...\n');

  const githubSearcher = new SimpleAgent({
    name: 'GitHub搜索专家',
    llm: new HelloAgentsLLM(),
    systemPrompt: `你是一个GitHub搜索专家。
你的任务是搜索GitHub仓库并返回结果。
请返回清晰、结构化的搜索结果，包括：
- 仓库名称
- 简短描述

保持简洁，不要添加额外的解释。`,
  });

  // 添加 GitHub MCP 工具（社区服务器）
  const githubTool = new MCPTool({
    name: 'gh',
    serverCommand: ['npx', '-y', '@modelcontextprotocol/server-github'],
    autoExpand: true,
  });

  try {
    await githubTool._discoveryPromise;
    const ghExpanded = githubTool.getExpandedTools();
    if (ghExpanded && ghExpanded.length > 0) {
      console.log(`✅ GitHub MCP 工具已展开为 ${ghExpanded.length} 个工具`);
      for (const t of ghExpanded) {
        console.log(`   • ${t.name}: ${t.description?.slice(0, 60)}`);
      }
    } else {
      console.log('⚠️  GitHub MCP 工具发现失败（可能未设置 GITHUB_PERSONAL_ACCESS_TOKEN）');
    }
  } catch (e) {
    console.log(`⚠️  GitHub MCP 连接失败: ${e.message}`);
    console.log('   需要 npx 和 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量\n');
  }

  // ============================================================
  // Agent 2: 文档生成专家
  // ============================================================
  console.log('\n【步骤 2】创建文档生成专家...\n');

  const documentWriter = new SimpleAgent({
    name: '文档生成专家',
    llm: new HelloAgentsLLM(),
    systemPrompt: `你是一个文档生成专家。
你的任务是根据提供的信息生成结构化的Markdown报告。

报告应该包括：
- 标题
- 简介
- 主要内容（分点列出，包括项目名称、描述等）
- 总结

请直接输出完整的Markdown格式报告内容。`,
  });

  // 添加文件系统 MCP 工具（社区服务器）
  const fsToolForWriter = new MCPTool({
    name: 'fs',
    serverCommand: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '.'],
    autoExpand: true,
  });

  try {
    await fsToolForWriter._discoveryPromise;
    const fsExpanded = fsToolForWriter.getExpandedTools();
    if (fsExpanded && fsExpanded.length > 0) {
      console.log(`✅ 文件系统 MCP 工具已展开为 ${fsExpanded.length} 个工具`);
      for (const t of fsExpanded) {
        console.log(`   • ${t.name}: ${t.description?.slice(0, 60)}`);
      }
    } else {
      console.log('⚠️  文件系统 MCP 工具发现失败');
    }
  } catch (e) {
    console.log(`⚠️  文件系统 MCP 连接失败: ${e.message}\n`);
  }

  // ============================================================
  // 执行多 Agent 协作任务
  // ============================================================
  console.log('\n' + '='.repeat(70));
  console.log('开始执行多 Agent 协作任务...');
  console.log('='.repeat(70));

  // 步骤 1：GitHub 搜索
  console.log('\n【步骤 3】Agent 1 搜索 GitHub...\n');
  try {
    const searchTask = "搜索关于 'AI agent' 的 GitHub 仓库，返回前 5 个最相关的结果";
    const searchResults = await githubSearcher.run(searchTask);
    console.log('搜索结果:');
    console.log('-'.repeat(70));
    console.log(searchResults);
    console.log('-'.repeat(70));

    // 步骤 2：生成报告
    console.log('\n【步骤 4】Agent 2 生成报告...\n');
    const reportTask = `根据以下 GitHub 搜索结果，生成一份 Markdown 格式的研究报告：

${searchResults}

报告要求：
1. 标题：# AI Agent 框架研究报告
2. 简介：说明这是关于 AI Agent 的 GitHub 项目调研
3. 主要发现：列出找到的项目及其特点
4. 总结：总结这些项目的共同特点

请直接输出完整的 Markdown 格式报告。`;

    const reportContent = await documentWriter.run(reportTask);
    console.log('报告内容:');
    console.log('='.repeat(70));
    console.log(reportContent);
    console.log('='.repeat(70));

    // 步骤 3：保存报告
    console.log('\n【步骤 5】保存报告到文件...');
    try {
      const reportPath = path.join(PROJECT_ROOT, 'report.md');
      writeFileSync(reportPath, reportContent, 'utf-8');
      const fileStat = statSync(reportPath);
      console.log(`✅ 报告已保存到 report.md (${fileStat.size} 字节)`);
    } catch (e) {
      console.log(`❌ 保存失败: ${e.message}`);
    }
  } catch (e) {
    console.log(`\n⚠️  任务执行失败: ${e.message}`);
    console.log('   这通常是因为 LLM 服务不可用或外部 MCP 服务器未安装。');
    console.log('   请确保 .env 中配置了 LLM API 密钥，并安装了 npx 相关包。');
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Demo 6 完成\n');
}

// ─── Demo 7: MCP 协议工具函数 ─────────────────────────────────────────────────

async function demo7_protocolUtils() {
  console.log('=== Demo 4: MCP 协议工具函数 ===\n');

  // createContext
  const ctx = createContext({
    messages: [{ role: 'user', content: '你好' }],
    tools: [{ name: 'list_files' }],
    metadata: { sessionId: 'demo-123' },
  });
  console.log('📦 createContext 创建的上下文:');
  console.log(JSON.stringify(ctx, null, 2));
  console.log('');

  // parseContext
  const jsonStr = JSON.stringify(ctx);
  const parsed = parseContext(jsonStr);
  console.log('🔍 parseContext 解析结果:');
  console.log(`   messages 数量: ${parsed.messages.length}`);
  console.log(`   tools 数量: ${parsed.tools.length}`);
  console.log(`   metadata.sessionId: ${parsed.metadata.sessionId}`);
  console.log('');

  // createSuccessResponse
  const success = createSuccessResponse({ files: ['a.js', 'b.js'] }, { duration: 42 });
  console.log('✅ createSuccessResponse:');
  console.log(JSON.stringify(success, null, 2));
  console.log('');

  // createErrorResponse
  const error = createErrorResponse('文件未找到', 'FILE_NOT_FOUND', { path: '/tmp/missing.txt' });
  console.log('❌ createErrorResponse:');
  console.log(JSON.stringify(error, null, 2));
  console.log('');

  console.log('✅ Demo 4 完成\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== HelloAgents JS v0.2.9 - MCP 智能文档助手示例 ===\n`);

  // await demo1_memoryTransport();
  // await demo2_stdioTransport();
  // await demo3_docAssistant();
  // await demo5_externalServer();
  await demo6_multiAgentDocAssistant();
  // await demo7_protocolUtils();

  console.log('🎉 所有演示已完成！');
}

main().catch(console.error);
