/**
 * 消息系统 - HelloAgents JS
 */

/**
 * @typedef {"user"|"assistant"|"system"|"tool"} MessageRole
 */

export class Message {
  /**
   * 消息类
   * @param {string} content
   * @param {MessageRole} role
   * @param {Object} [opts]
   * @param {Date} [opts.timestamp]
   * @param {Object} [opts.metadata]
   */
  constructor(content, role, opts = {}) {
    this.content = content;
    this.role = role;
    this.timestamp = opts.timestamp ?? new Date();
    this.metadata = opts.metadata ?? {};
  }

  /**
   * 转换为OpenAI API格式
   * @returns {{role: MessageRole, content: string}}
   */
  toDict() {
    return {
      role: this.role,
      content: this.content,
    };
  }

  toString() {
    return `[${this.role}] ${this.content}`;
  }
}