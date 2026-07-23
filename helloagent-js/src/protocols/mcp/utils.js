/**
 * MCP 工具函数 - 上下文和响应辅助
 */

/**
 * 创建 MCP 上下文对象
 * @param {Object} [opts]
 * @param {Array} [opts.messages=[]]
 * @param {Array} [opts.tools=[]]
 * @param {Array} [opts.resources=[]]
 * @param {Object} [opts.metadata={}]
 * @returns {{messages: Array, tools: Array, resources: Array, metadata: Object}}
 */
export function createContext({ messages = [], tools = [], resources = [], metadata = {} } = {}) {
  return { messages, tools, resources, metadata };
}

/**
 * 解析并规范化 MCP 上下文
 * @param {string|Object} context - JSON 字符串或对象
 * @returns {{messages: Array, tools: Array, resources: Array, metadata: Object}}
 */
export function parseContext(context) {
  if (typeof context === 'string') {
    context = JSON.parse(context);
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new Error('Context must be a dictionary or JSON string');
  }
  for (const field of ['messages', 'tools', 'resources']) {
    if (!(field in context)) context[field] = [];
  }
  if (!('metadata' in context)) context.metadata = {};
  return context;
}

/**
 * 创建错误响应
 * @param {string} errorMessage
 * @param {string|null} [errorCode=null]
 * @param {Object|null} [details=null]
 * @returns {{error: {message: string, code: string, details?: Object}}}
 */
export function createErrorResponse(errorMessage, errorCode = null, details = null) {
  const response = {
    error: {
      message: errorMessage,
      code: errorCode || 'UNKNOWN_ERROR',
    },
  };
  if (details) response.error.details = details;
  return response;
}

/**
 * 创建成功响应
 * @param {*} data
 * @param {Object|null} [metadata=null]
 * @returns {{success: true, data: *, metadata?: Object}}
 */
export function createSuccessResponse(data, metadata = null) {
  const response = {
    success: true,
    data,
  };
  if (metadata) response.metadata = metadata;
  return response;
}
