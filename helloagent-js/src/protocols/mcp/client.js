/**
 * MCP 客户端实现 - 支持 stdio/HTTP/SSE/Memory 传输
 */

import { spawn } from 'child_process';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { createInterface } from 'readline';
import process from 'process';

/**
 * 内存传输层 - 直接与 MCPServer 实例通信
 */
class MemoryTransport {
  constructor(server) {
    this.server = server;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    console.log('🔗 连接到 MCP 服务器... (memory)');
    console.log('✅ 连接成功！');
  }

  async disconnect() {
    this.connected = false;
    console.log('🔌 连接已断开');
  }

  async send(request) {
    if (!this.connected) throw new Error('Transport not connected');
    return await this.server._handleRequest(request);
  }

  getInfo() {
    return { status: this.connected ? 'connected' : 'disconnected', transportType: 'memory' };
  }
}

/**
 * stdio 传输层 - 通过子进程 stdin/stdout 通信
 */
class StdioTransport {
  constructor(command, args = [], env = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.process = null;
    this.reader = null;
    this.connected = false;
    this._pending = new Map();
    this._idCounter = 1;
  }

  async connect() {
    console.log('🔗 连接到 MCP 服务器... (stdio)');
    this.process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.reader = createInterface({ input: this.process.stdout });
    this.reader.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg);
      }
    });

    // 初始化握手
    const initResponse = await this._sendRequest({
      jsonrpc: '2.0',
      id: this._nextId(),
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-client', version: '1.0.0' } },
    });

    // 发送 initialized 通知
    this._sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    this.connected = true;
    console.log('✅ 连接成功！');
    return initResponse;
  }

  async disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    this.connected = false;
    console.log('🔌 连接已断开');
  }

  _nextId() {
    return this._idCounter++;
  }

  _sendRequest(request) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(request.id);
        reject(new Error('Request timeout'));
      }, 30000);
      this._pending.set(request.id, {
        resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  _sendNotification(notification) {
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  async send(request) {
    if (!this.connected) throw new Error('Transport not connected');
    const req = { ...request, jsonrpc: '2.0', id: this._nextId() };
    const response = await this._sendRequest(req);
    return response;
  }

  getInfo() {
    return { status: this.connected ? 'connected' : 'disconnected', transportType: 'stdio', command: this.command };
  }
}

/**
 * HTTP 传输层
 */
class HttpTransport {
  constructor(url) {
    this.url = new URL(url);
    this.connected = false;
  }

  async connect() {
    console.log('🔗 连接到 MCP 服务器... (http)');
    this.connected = true;
    console.log('✅ 连接成功！');
  }

  async disconnect() {
    this.connected = false;
    console.log('🔌 连接已断开');
  }

  async send(request) {
    if (!this.connected) throw new Error('Transport not connected');
    const body = JSON.stringify({ ...request, jsonrpc: '2.0' });
    const isHttps = this.url.protocol === 'https:';
    const reqModule = isHttps ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = reqModule(
        this.url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  getInfo() {
    return { status: this.connected ? 'connected' : 'disconnected', transportType: 'http', url: this.url.href };
  }
}

/**
 * SSE 传输层
 */
class SseTransport {
  constructor(url) {
    this.url = new URL(url);
    this.connected = false;
    this._eventSource = null;
  }

  async connect() {
    console.log('🔗 连接到 MCP 服务器... (sse)');
    this.connected = true;
    console.log('✅ 连接成功！');
  }

  async disconnect() {
    this.connected = false;
    console.log('🔌 连接已断开');
  }

  async send(request) {
    if (!this.connected) throw new Error('Transport not connected');
    const body = JSON.stringify({ ...request, jsonrpc: '2.0' });
    const isHttps = this.url.protocol === 'https:';
    const reqModule = isHttps ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = reqModule(
        this.url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  getInfo() {
    return { status: this.connected ? 'connected' : 'disconnected', transportType: 'sse', url: this.url.href };
  }
}

/**
 * MCP 客户端类
 */
export class MCPClient {
  constructor({
    serverSource,
    serverArgs = [],
    transportType = null,
    env = {},
    ...transportKwargs
  } = {}) {
    this.serverSource = serverSource;
    this.serverArgs = serverArgs;
    this.transportType = transportType;
    this.env = env;
    this.transportKwargs = transportKwargs;
    this._transport = null;
  }

  /**
   * 推断传输类型
   */
  _inferTransportType() {
    if (this.transportType) return this.transportType;
    if (typeof this.serverSource === 'object' && this.serverSource !== null && typeof this.serverSource._handleRequest === 'function') {
      return 'memory';
    }
    if (Array.isArray(this.serverSource)) return 'stdio';
    if (typeof this.serverSource === 'string') {
      if (this.serverSource.startsWith('http://') || this.serverSource.startsWith('https://')) return 'http';
      if (this.serverSource.endsWith('.js') || this.serverSource.endsWith('.mjs')) return 'stdio';
    }
    return 'stdio';
  }

  /**
   * 创建传输层实例
   */
  _createTransport() {
    const type = this._inferTransportType();
    switch (type) {
      case 'memory':
        return new MemoryTransport(this.serverSource);
      case 'stdio': {
        let command, args;
        if (Array.isArray(this.serverSource)) {
          [command, ...args] = this.serverSource;
        } else {
          command = 'node';
          args = [this.serverSource, ...this.serverArgs];
        }
        return new StdioTransport(command, args, this.env);
      }
      case 'http':
        return new HttpTransport(this.serverSource);
      case 'sse':
        return new SseTransport(this.serverSource);
      default:
        throw new Error(`Unknown transport type: ${type}`);
    }
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect() {
    this._transport = this._createTransport();
    await this._transport.connect();
    return this;
  }

  /**
   * 断开连接
   */
  async disconnect() {
    if (this._transport) {
      await this._transport.disconnect();
      this._transport = null;
    }
  }

  /**
   * 异步迭代器支持（类似 Python async with）
   */
  async *[Symbol.asyncIterator]() {
    await this.connect();
    try {
      yield this;
    } finally {
      await this.disconnect();
    }
  }

  /**
   * 发送 JSON-RPC 请求并解析结果
   */
  async _request(method, params = {}) {
    if (!this._transport) throw new Error('Client not connected');
    const response = await this._transport.send({ method, params });
    if (response.error) throw new Error(response.error.message);
    return response.result;
  }

  /**
   * 列出可用工具
   * @returns {Promise<Array<{name: string, description: string, inputSchema: Object}>>}
   */
  async listTools() {
    const result = await this._request('tools/list', {});
    return result.tools || [];
  }

  /**
   * 调用工具
   * @param {string} toolName
   * @param {Object} [args={}]
   * @returns {Promise<*>}
   */
  async callTool(toolName, args = {}) {
    const result = await this._request('tools/call', { name: toolName, arguments: args });
    return result.content;
  }

  /**
   * 列出可用资源
   * @returns {Promise<Array<{uri: string, name: string, description: string, mimeType: string}>>}
   */
  async listResources() {
    const result = await this._request('resources/list', {});
    return result.resources || [];
  }

  /**
   * 读取资源
   * @param {string} uri
   * @returns {Promise<*>}
   */
  async readResource(uri) {
    const result = await this._request('resources/read', { uri });
    return result.contents;
  }

  /**
   * 列出可用提示模板
   * @returns {Promise<Array<{name: string, description: string, arguments: Array}>>}
   */
  async listPrompts() {
    const result = await this._request('prompts/list', {});
    return result.prompts || [];
  }

  /**
   * 获取提示模板
   * @param {string} promptName
   * @param {Object} [args={}]
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async getPrompt(promptName, args = {}) {
    const result = await this._request('prompts/get', { name: promptName, arguments: args });
    return result.messages;
  }

  /**
   * 发送 ping 检查连接
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      await this._request('ping', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取传输层信息
   * @returns {Object}
   */
  getTransportInfo() {
    if (!this._transport) return { status: 'disconnected', transportType: null };
    return this._transport.getInfo();
  }
}
