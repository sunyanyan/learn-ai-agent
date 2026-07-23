import { Tool, ToolParameter } from '../base.js';
import { MCPClient } from '../../protocols/mcp/client.js';
import { MCPServer } from '../../protocols/mcp/server.js';

/**
 * MCP 包装工具 - 将单个 MCP 工具包装为框架内的 Tool 实例
 */
export class MCPWrappedTool extends Tool {
  /**
   * @param {Object} opts
   * @param {MCPTool} opts.mcpTool - 父级 MCPTool 实例
   * @param {Object} opts.toolInfo - 工具信息 { name, description, inputSchema }
   * @param {string} [opts.prefix=''] - 工具名前缀
   */
  constructor({ mcpTool, toolInfo, prefix = '' }) {
    const mcpToolName = toolInfo.name || 'unknown';
    const toolName = prefix ? `${prefix}${mcpToolName}` : mcpToolName;
    const description = toolInfo.description || `MCP工具: ${mcpToolName}`;

    super({ name: toolName, description });

    this.mcpTool = mcpTool;
    this.toolInfo = toolInfo;
    this.mcpToolName = mcpToolName;
    this._parameters = this._parseInputSchema(toolInfo.inputSchema || {});
  }

  /**
   * 解析 JSON Schema 输入定义，转换为 ToolParameter 数组
   * @param {Object} inputSchema
   * @returns {ToolParameter[]}
   */
  _parseInputSchema(inputSchema) {
    const parameters = [];
    const properties = inputSchema.properties || {};
    const requiredFields = inputSchema.required || [];

    for (const [paramName, paramInfo] of Object.entries(properties)) {
      parameters.push(new ToolParameter({
        name: paramName,
        type: paramInfo.type || 'string',
        description: paramInfo.description || '',
        required: requiredFields.includes(paramName),
      }));
    }

    return parameters;
  }

  getParameters() {
    return this._parameters;
  }

  /**
   * 执行工具调用，委托给父级 MCPTool
   * @param {Object} params
   * @returns {Promise<*>}
   */
  async run(params) {
    return await this.mcpTool.run({
      action: 'call_tool',
      toolName: this.mcpToolName,
      arguments: params,
    });
  }
}

/**
 * MCP 工具 - 管理 MCP 服务器连接，支持工具发现、调用和资源访问
 */
export class MCPTool extends Tool {
  /**
   * @param {Object} opts
   * @param {string} [opts.name='mcp'] - 工具名称
   * @param {string|null} [opts.description=null] - 工具描述
   * @param {string[]|null} [opts.serverCommand=null] - 服务器启动命令，如 ['node', 'server.js']
   * @param {string[]} [opts.serverArgs=[]] - 服务器参数
   * @param {MCPServer|null} [opts.server=null] - MCPServer 实例（内存传输）
   * @param {boolean} [opts.autoExpand=true] - 是否自动展开为独立工具
   * @param {Object} [opts.env={}] - 环境变量
   * @param {string[]|null} [opts.envKeys=null] - 需要注入的环境变量键列表
   */
  constructor({
    name = 'mcp',
    description = null,
    serverCommand = null,
    serverArgs = [],
    server = null,
    autoExpand = true,
    env = {},
    envKeys = null,
    ...kwargs
  } = {}) {
    super({ name, description: description || '', expandable: autoExpand });

    this.serverCommand = serverCommand;
    this.serverArgs = serverArgs;
    this.server = server;
    this.autoExpand = autoExpand;
    this.prefix = autoExpand ? `${name}_` : '';
    this.env = this._prepareEnv(env, envKeys, serverCommand);
    this.kwargs = kwargs;

    this._availableTools = [];
    this._discoveryPromise = null;

    // 如果没有提供服务器命令或服务器实例，创建内置服务器
    if (!serverCommand && !server) {
      this.server = this._createBuiltinServer();
    }

    // 异步发现工具（fire-and-forget，构造函数中不 await）
    this._discoveryPromise = this._discoverTools().catch((err) => {
      console.warn(`⚠️ MCP 工具发现失败: ${err.message}`);
      this._availableTools = [];
    });

    // 如果未提供描述，基于可用工具自动生成
    if (!description) {
      this.description = this._generateDescription();
    }
  }

  /**
   * 准备环境变量
   * @param {Object} env
   * @param {string[]|null} envKeys
   * @param {string[]|null} serverCommand
   * @returns {Object}
   */
  _prepareEnv(env, envKeys, serverCommand) {
    const result = { ...env };

    if (envKeys && Array.isArray(envKeys)) {
      for (const key of envKeys) {
        if (process.env[key] !== undefined) {
          result[key] = process.env[key];
        }
      }
    }

    return result;
  }

  /**
   * 创建内置 MCP 服务器（提供基础数学和系统工具）
   * @returns {MCPServer}
   */
  _createBuiltinServer() {
    const server = new MCPServer({ name: 'builtin-mcp-server', description: '内置 MCP 服务器' });

    server.addTool({
      name: 'add',
      description: '两数相加',
      func: ({ a, b }) => Number(a) + Number(b),
    });

    server.addTool({
      name: 'subtract',
      description: '两数相减',
      func: ({ a, b }) => Number(a) - Number(b),
    });

    server.addTool({
      name: 'multiply',
      description: '两数相乘',
      func: ({ a, b }) => Number(a) * Number(b),
    });

    server.addTool({
      name: 'divide',
      description: '两数相除',
      func: ({ a, b }) => {
        if (Number(b) === 0) throw new Error('除数不能为零');
        return Number(a) / Number(b);
      },
    });

    server.addTool({
      name: 'greet',
      description: '向用户发送问候',
      func: ({ name = 'World' }) => `Hello, ${name}!`,
    });

    server.addTool({
      name: 'get_system_info',
      description: '获取系统信息',
      func: () => {
        return `Node.js ${process.version}, 平台: ${process.platform}, 架构: ${process.arch}`;
      },
    });

    console.log('🛠️ 内置 MCP 服务器已创建');
    return server;
  }

  /**
   * 获取 MCPClient 的 serverSource 配置
   * @returns {MCPServer|string|string[]}
   */
  _getServerSource() {
    if (this.server) {
      return this.server;
    }
    if (this.serverCommand) {
      return [...this.serverCommand, ...this.serverArgs];
    }
    return null;
  }

  /**
   * 发现 MCP 服务器上的可用工具
   * @returns {Promise<void>}
   */
  async _discoverTools() {
    const serverSource = this._getServerSource();
    if (!serverSource) {
      console.warn('⚠️ 未配置 MCP 服务器，无法发现工具');
      this._availableTools = [];
      return;
    }

    const client = new MCPClient({
      serverSource,
      env: this.env,
      ...this.kwargs,
    });

    try {
      await client.connect();
      const tools = await client.listTools();
      this._availableTools = tools;
      console.log(`🔍 发现 ${tools.length} 个 MCP 工具`);
    } catch (err) {
      console.error(`❌ MCP 工具发现失败: ${err.message}`);
      this._availableTools = [];
    } finally {
      await client.disconnect();
    }
  }

  /**
   * 基于可用工具自动生成描述
   * @returns {string}
   */
  _generateDescription() {
    if (!this._availableTools || this._availableTools.length === 0) {
      return `MCP 工具集 (${this.name}) - 暂无可用工具`;
    }

    const toolNames = this._availableTools.map(t => t.name).join(', ');
    return `MCP 工具集 (${this.name}) - 可用工具: ${toolNames}`;
  }

  /**
   * 获取展开后的工具列表
   * @returns {MCPWrappedTool[]|null}
   */
  getExpandedTools() {
    if (!this.autoExpand) {
      return null;
    }

    if (!this._availableTools || this._availableTools.length === 0) {
      return null;
    }

    const tools = [];
    for (const toolInfo of this._availableTools) {
      tools.push(new MCPWrappedTool({
        mcpTool: this,
        toolInfo,
        prefix: this.prefix,
      }));
    }

    return tools;
  }

  /**
   * 执行 MCP 操作
   * @param {Object} parameters
   * @returns {Promise<string>}
   */
  async run(parameters) {
    // 等待工具发现完成（如果还在进行中）
    if (this._discoveryPromise) {
      await this._discoveryPromise;
    }

    let action = (parameters.action || '').toLowerCase();

    // 智能推断：如果没有 action 但提供了 toolName，推断为 call_tool
    if (!action && parameters.toolName) {
      action = 'call_tool';
    }

    const serverSource = this._getServerSource();
    if (!serverSource) {
      return '错误：未配置 MCP 服务器';
    }

    const client = new MCPClient({
      serverSource,
      env: this.env,
      ...this.kwargs,
    });

    try {
      await client.connect();

      switch (action) {
        case 'list_tools': {
          const tools = await client.listTools();
          return JSON.stringify(tools, null, 2);
        }

        case 'call_tool': {
          const toolName = parameters.toolName;
          const args = parameters.arguments || {};
          if (!toolName) {
            return '错误：call_tool 需要提供 toolName';
          }
          console.log(`🔧 调用 MCP 工具: ${toolName}`);
          const result = await client.callTool(toolName, args);
          return JSON.stringify(result, null, 2);
        }

        case 'list_resources': {
          const resources = await client.listResources();
          return JSON.stringify(resources, null, 2);
        }

        case 'read_resource': {
          const uri = parameters.uri;
          if (!uri) {
            return '错误：read_resource 需要提供 uri';
          }
          console.log(`📖 读取 MCP 资源: ${uri}`);
          const result = await client.readResource(uri);
          return JSON.stringify(result, null, 2);
        }

        case 'list_prompts': {
          const prompts = await client.listPrompts();
          return JSON.stringify(prompts, null, 2);
        }

        case 'get_prompt': {
          const promptName = parameters.promptName;
          const promptArgs = parameters.promptArguments || {};
          if (!promptName) {
            return '错误：get_prompt 需要提供 promptName';
          }
          console.log(`💬 获取 MCP 提示模板: ${promptName}`);
          const result = await client.getPrompt(promptName, promptArgs);
          return JSON.stringify(result, null, 2);
        }

        default: {
          return `错误：未知的 MCP 操作: ${action}。支持的操作: list_tools, call_tool, list_resources, read_resource, list_prompts, get_prompt`;
        }
      }
    } catch (err) {
      const errMsg = `MCP 操作失败 (${action}): ${err.message}`;
      console.error(`❌ ${errMsg}`);
      return errMsg;
    } finally {
      await client.disconnect();
    }
  }

  /**
   * 获取 MCPTool 的参数定义
   * @returns {ToolParameter[]}
   */
  getParameters() {
    return [
      new ToolParameter({
        name: 'action',
        type: 'string',
        description: 'MCP 操作类型: list_tools, call_tool, list_resources, read_resource, list_prompts, get_prompt',
        required: false,
        default: 'list_tools',
      }),
      new ToolParameter({
        name: 'toolName',
        type: 'string',
        description: '要调用的工具名称（call_tool 时使用）',
        required: false,
      }),
      new ToolParameter({
        name: 'arguments',
        type: 'object',
        description: '工具调用参数（call_tool 时使用）',
        required: false,
        default: {},
      }),
      new ToolParameter({
        name: 'uri',
        type: 'string',
        description: '资源 URI（read_resource 时使用）',
        required: false,
      }),
      new ToolParameter({
        name: 'promptName',
        type: 'string',
        description: '提示模板名称（get_prompt 时使用）',
        required: false,
      }),
      new ToolParameter({
        name: 'promptArguments',
        type: 'object',
        description: '提示模板参数（get_prompt 时使用）',
        required: false,
        default: {},
      }),
    ];
  }
}
