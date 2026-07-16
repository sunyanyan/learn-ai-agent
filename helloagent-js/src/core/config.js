/**
 * 配置管理 - HelloAgents JS
 */

export class Config {
  /**
   * HelloAgents配置类
   * @param {Object} opts
   * @param {string} opts.default_model
   * @param {string} opts.default_provider
   * @param {number} opts.temperature
   * @param {number|null} opts.max_tokens
   * @param {boolean} opts.debug
   * @param {string} opts.log_level
   * @param {number} opts.max_history_length
   */
  constructor(opts = {}) {
    this.default_model = opts.default_model ?? 'gpt-3.5-turbo';
    this.default_provider = opts.default_provider ?? 'openai';
    this.temperature = opts.temperature ?? 0.7;
    this.max_tokens = opts.max_tokens ?? null;
    this.debug = opts.debug ?? false;
    this.log_level = opts.log_level ?? 'INFO';
    this.max_history_length = opts.max_history_length ?? 100;
  }

  /**
   * 从环境变量创建配置
   * @returns {Config}
   */
  static fromEnv() {
    return new Config({
      debug: (process.env.DEBUG || 'false').toLowerCase() === 'true',
      log_level: process.env.LOG_LEVEL || 'INFO',
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
      max_tokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS, 10) : null,
    });
  }

  /**
   * 转换为普通对象
   * @returns {Object}
   */
  toDict() {
    return {
      default_model: this.default_model,
      default_provider: this.default_provider,
      temperature: this.temperature,
      max_tokens: this.max_tokens,
      debug: this.debug,
      log_level: this.log_level,
      max_history_length: this.max_history_length,
    };
  }
}