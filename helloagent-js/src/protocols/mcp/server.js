/**
 * MCP 服务器实现 - 支持 JSON-RPC 2.0 over stdio/HTTP/SSE
 */

import { createServer } from 'http';
import { createInterface as createReadlineInterface } from 'readline';
import process from 'process';

/**
 * 解析函数签名，生成 JSON Schema 输入定义
 * @param {Function} func
 * @returns {{type: 'object', properties: Object, required: string[]}}
 */
function generateInputSchema(func) {
  const fnStr = func.toString();
  const paramMatch = fnStr.match(/\(([^)]*)\)/);
  if (!paramMatch) {
    return { type: 'object', properties: {}, required: [] };
  }

  const paramStr = paramMatch[1].trim();
  if (!paramStr) {
    return { type: 'object', properties: {}, required: [] };
  }

  const properties = {};
  const required = [];
  const paramParts = paramStr.split(',').map(p => p.trim());

  for (const part of paramParts) {
    if (!part || part.startsWith('...')) continue;
    const [name, defaultValueRaw] = part.split('=').map(s => s.trim());
    const hasDefault = defaultValueRaw !== undefined;
    let type = 'string';

    if (hasDefault) {
      const raw = defaultValueRaw;
      if (raw === 'true' || raw === 'false') type = 'boolean';
      else if (!isNaN(Number(raw)) && raw !== '') type = 'number';
      else if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) type = 'string';
      else if (raw.startsWith('[')) type = 'array';
      else if (raw.startsWith('{')) type = 'object';
    } else {
      required.push(name);
    }

    properties[name] = { type };
  }

  return { type: 'object', properties, required };
}

/**
 * MCP 服务器类
 */
export class MCPServer {
  constructor({ name, description = null }) {
    this.name = name;
    this.description = description;
    this._tools = new Map();
    this._resources = new Map();
    this._prompts = new Map();
    this._transport = null;
    this._httpServer = null;
    this._sseClients = new Set();
  }

  /**
   * 注册工具
   * @param {Object} opts
   * @param {Function} opts.func
   * @param {string|null} [opts.name=null]
   * @param {string|null} [opts.description=null]
   */
  addTool({ func, name = null, description = null }) {
    const toolName = name || func.name || 'unnamed_tool';
    const inputSchema = generateInputSchema(func);
    this._tools.set(toolName, {
      name: toolName,
      description: description || `工具 ${toolName}`,
      func,
      inputSchema,
    });
  }

  /**
   * 注册资源
   * @param {Object} opts
   * @param {Function} opts.func
   * @param {string|null} [opts.uri=null]
   * @param {string|null} [opts.name=null]
   * @param {string|null} [opts.description=null]
   */
  addResource({ func, uri = null, name = null, description = null }) {
    const resourceUri = uri || func.name || 'unnamed_resource';
    this._resources.set(resourceUri, {
      uri: resourceUri,
      name: name || resourceUri,
      description: description || `资源 ${resourceUri}`,
      func,
    });
  }

  /**
   * 注册提示模板
   * @param {Object} opts
   * @param {Function} opts.func
   * @param {string|null} [opts.name=null]
   * @param {string|null} [opts.description=null]
   */
  addPrompt({ func, name = null, description = null }) {
    const promptName = name || func.name || 'unnamed_prompt';
    this._prompts.set(promptName, {
      name: promptName,
      description: description || `提示 ${promptName}`,
      func,
    });
  }

  /**
   * 获取服务器信息
   * @returns {{name: string, description: string|null, protocol: string}}
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      protocol: 'MCP',
    };
  }

  /**
   * 处理 JSON-RPC 2.0 请求
   * @param {Object} request
   * @returns {Object|null}
   */
  async _handleRequest(request) {
    const { id, method, params = {} } = request;

    try {
      let result;
      switch (method) {
        case 'initialize': {
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: this.getInfo(),
          };
          break;
        }
        case 'tools/list': {
          const tools = Array.from(this._tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
          result = { tools };
          break;
        }
        case 'tools/call': {
          const { name, arguments: args = {} } = params;
          const tool = this._tools.get(name);
          if (!tool) throw new Error(`Tool not found: ${name}`);
          const content = await tool.func(args);
          result = { content: [{ type: 'text', text: String(content) }] };
          break;
        }
        case 'resources/list': {
          const resources = Array.from(this._resources.values()).map(r => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: 'text/plain',
          }));
          result = { resources };
          break;
        }
        case 'resources/read': {
          const { uri } = params;
          const resource = this._resources.get(uri);
          if (!resource) throw new Error(`Resource not found: ${uri}`);
          const content = await resource.func();
          result = { contents: [{ uri, mimeType: 'text/plain', text: String(content) }] };
          break;
        }
        case 'prompts/list': {
          const prompts = Array.from(this._prompts.values()).map(p => ({
            name: p.name,
            description: p.description,
            arguments: [],
          }));
          result = { prompts };
          break;
        }
        case 'prompts/get': {
          const { name, arguments: args = {} } = params;
          const prompt = this._prompts.get(name);
          if (!prompt) throw new Error(`Prompt not found: ${name}`);
          const messages = await prompt.func(args);
          result = { description: prompt.description, messages };
          break;
        }
        case 'ping': {
          result = {};
          break;
        }
        default:
          throw new Error(`Method not found: ${method}`);
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err.message },
      };
    }
  }

  /**
   * 运行 stdio 传输层
   */
  async _runStdio() {
    console.log('🚀 MCP 服务器通过 stdio 启动');
    const rl = createReadlineInterface({ input: process.stdin, output: process.stdout, terminal: false });

    for await (const line of rl) {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        const response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
        process.stdout.write(JSON.stringify(response) + '\n');
        continue;
      }

      if (request.method === 'notifications/initialized') continue;

      const response = await this._handleRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    }
  }

  /**
   * 运行 HTTP 传输层
   * @param {string} host
   * @param {number} port
   */
  async _runHttp(host, port) {
    console.log(`🌐 MCP 服务器通过 HTTP 启动于 http://${host}:${port}`);
    this._httpServer = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let request;
        try {
          request = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
          return;
        }
        const response = await this._handleRequest(request);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      });
    });

    return new Promise((resolve) => {
      this._httpServer.listen(port, host, () => resolve());
    });
  }

  /**
   * 运行 SSE 传输层
   * @param {string} host
   * @param {number} port
   */
  async _runSse(host, port) {
    console.log(`📡 MCP 服务器通过 SSE 启动于 http://${host}:${port}`);
    this._httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/sse' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        this._sseClients.add(res);
        req.on('close', () => this._sseClients.delete(res));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let request;
        try {
          request = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
          return;
        }
        const response = await this._handleRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    });

    return new Promise((resolve) => {
      this._httpServer.listen(port, host, () => resolve());
    });
  }

  /**
   * 启动服务器
   * @param {Object} [opts={}]
   * @param {string} [opts.transport='stdio']
   * @param {string} [opts.host='127.0.0.1']
   * @param {number} [opts.port=8000]
   */
  async run({ transport = 'stdio', host = '127.0.0.1', port = 8000 } = {}) {
    this._transport = transport;
    switch (transport) {
      case 'stdio':
        await this._runStdio();
        break;
      case 'http':
        await this._runHttp(host, port);
        break;
      case 'sse':
        await this._runSse(host, port);
        break;
      default:
        throw new Error(`Unknown transport: ${transport}`);
    }
  }
}

/**
 * MCP 服务器构建器（链式 API）
 */
export class MCPServerBuilder {
  constructor({ name, description = null }) {
    this._server = new MCPServer({ name, description });
  }

  withTool({ func, name, description }) {
    this._server.addTool({ func, name, description });
    return this;
  }

  withResource({ func, uri, name, description }) {
    this._server.addResource({ func, uri, name, description });
    return this;
  }

  withPrompt({ func, name, description }) {
    this._server.addPrompt({ func, name, description });
    return this;
  }

  build() {
    return this._server;
  }

  async run(opts = {}) {
    const server = this.build();
    await server.run(opts);
    return server;
  }
}

/**
 * 创建示例 MCP 服务器（计算器和问候工具）
 * @returns {MCPServer}
 */
export function createExampleServer() {
  const server = new MCPServer({ name: 'example-server' });

  server.addTool({
    name: 'calculator',
    description: '执行基础数学运算',
    func: ({ expression }) => {
      try {
        // eslint-disable-next-line no-eval
        return String(eval(expression));
      } catch {
        return 'Error: invalid expression';
      }
    },
  });

  server.addTool({
    name: 'greet',
    description: '向用户发送问候',
    func: ({ name = 'World' }) => `Hello, ${name}!`,
  });

  return server;
}
