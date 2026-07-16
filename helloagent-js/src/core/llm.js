import OpenAI from 'openai';
import { HelloAgentsException } from './exceptions.js';

const SUPPORTED_PROVIDERS = [
  'openai', 'deepseek', 'qwen', 'modelscope', 'kimi',
  'zhipu', 'ollama', 'vllm', 'local', 'auto', 'custom',
];

export class HelloAgentsLLM {
  constructor(opts = {}) {
    const {
      model, apiKey, baseUrl, provider,
      temperature = 0.7, maxTokens = null, timeout = null,
      ...kwargs
    } = opts;

    this.model = model || process.env.LLM_MODEL_ID;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.timeout = timeout || parseInt(process.env.LLM_TIMEOUT || '60', 10);
    this.kwargs = kwargs;

    const requestedProvider = provider ? provider.toLowerCase() : null;
    this.provider = provider || this._autoDetectProvider(apiKey, baseUrl);

    if (requestedProvider === 'custom') {
      this.provider = 'custom';
      this.apiKey = apiKey || process.env.LLM_API_KEY;
      this.baseUrl = baseUrl || process.env.LLM_BASE_URL;
    } else {
      const creds = this._resolveCredentials(apiKey, baseUrl);
      this.apiKey = creds.apiKey;
      this.baseUrl = creds.baseUrl;
    }

    if (!this.model) {
      this.model = this._getDefaultModel();
    }
    if (!this.apiKey || !this.baseUrl) {
      throw new HelloAgentsException('API密钥和服务地址必须被提供或在.env文件中定义。');
    }

    this._client = this._createClient();
  }

  _autoDetectProvider(apiKey, baseUrl) {
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
    if (process.env.DASHSCOPE_API_KEY) return 'qwen';
    if (process.env.MODELSCOPE_API_KEY) return 'modelscope';
    if (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) return 'kimi';
    if (process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY) return 'zhipu';
    if (process.env.OLLAMA_API_KEY || process.env.OLLAMA_HOST) return 'ollama';
    if (process.env.VLLM_API_KEY || process.env.VLLM_HOST) return 'vllm';

    const actualApiKey = apiKey || process.env.LLM_API_KEY;
    if (actualApiKey) {
      const lower = actualApiKey.toLowerCase();
      if (actualApiKey.startsWith('ms-')) return 'modelscope';
      if (lower === 'ollama') return 'ollama';
      if (lower === 'vllm') return 'vllm';
      if (lower === 'local') return 'local';
      if (actualApiKey.endsWith('.') || actualApiKey.slice(-20).includes('.')) return 'zhipu';
    }

    const actualBaseUrl = baseUrl || process.env.LLM_BASE_URL;
    if (actualBaseUrl) {
      const bLower = actualBaseUrl.toLowerCase();
      if (bLower.includes('api.openai.com')) return 'openai';
      if (bLower.includes('api.deepseek.com')) return 'deepseek';
      if (bLower.includes('dashscope.aliyuncs.com')) return 'qwen';
      if (bLower.includes('api-inference.modelscope.cn')) return 'modelscope';
      if (bLower.includes('api.moonshot.cn')) return 'kimi';
      if (bLower.includes('open.bigmodel.cn')) return 'zhipu';
      if (bLower.includes('localhost') || bLower.includes('127.0.0.1')) {
        if (bLower.includes(':11434') || bLower.includes('ollama')) return 'ollama';
        if (bLower.includes(':8000') && bLower.includes('vllm')) return 'vllm';
        if (bLower.includes(':8080') || bLower.includes(':7860')) return 'local';
        if (actualApiKey && actualApiKey.toLowerCase() === 'ollama') return 'ollama';
        if (actualApiKey && actualApiKey.toLowerCase() === 'vllm') return 'vllm';
        return 'local';
      }
      if ([':8080', ':7860', ':5000'].some(p => bLower.includes(p))) return 'local';
    }

    return 'auto';
  }

  _resolveCredentials(apiKey, baseUrl) {
    const get = (a, ...fallbacks) => a || fallbacks.find(f => f) || undefined;

    switch (this.provider) {
      case 'openai':
        return {
          apiKey: get(apiKey, process.env.OPENAI_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        };
      case 'deepseek':
        return {
          apiKey: get(apiKey, process.env.DEEPSEEK_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://api.deepseek.com',
        };
      case 'qwen':
        return {
          apiKey: get(apiKey, process.env.DASHSCOPE_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        };
      case 'modelscope':
        return {
          apiKey: get(apiKey, process.env.MODELSCOPE_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://api-inference.modelscope.cn/v1/',
        };
      case 'kimi':
        return {
          apiKey: get(apiKey, process.env.KIMI_API_KEY, process.env.MOONSHOT_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1',
        };
      case 'zhipu':
        return {
          apiKey: get(apiKey, process.env.ZHIPU_API_KEY, process.env.GLM_API_KEY, process.env.LLM_API_KEY),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
        };
      case 'ollama':
        return {
          apiKey: get(apiKey, process.env.OLLAMA_API_KEY, process.env.LLM_API_KEY, 'ollama'),
          baseUrl: baseUrl || process.env.OLLAMA_HOST || process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
        };
      case 'vllm':
        return {
          apiKey: get(apiKey, process.env.VLLM_API_KEY, process.env.LLM_API_KEY, 'vllm'),
          baseUrl: baseUrl || process.env.VLLM_HOST || process.env.LLM_BASE_URL || 'http://localhost:8000/v1',
        };
      case 'local':
        return {
          apiKey: get(apiKey, process.env.LLM_API_KEY, 'local'),
          baseUrl: baseUrl || process.env.LLM_BASE_URL || 'http://localhost:8000/v1',
        };
      case 'custom':
        return {
          apiKey: apiKey || process.env.LLM_API_KEY,
          baseUrl: baseUrl || process.env.LLM_BASE_URL,
        };
      default:
        return {
          apiKey: apiKey || process.env.LLM_API_KEY,
          baseUrl: baseUrl || process.env.LLM_BASE_URL,
        };
    }
  }

  _createClient() {
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      timeout: this.timeout * 1000,
    });
  }

  _getDefaultModel() {
    const defaults = {
      openai: 'gpt-3.5-turbo',
      deepseek: 'deepseek-chat',
      qwen: 'qwen-plus',
      modelscope: 'Qwen/Qwen2.5-72B-Instruct',
      kimi: 'moonshot-v1-8k',
      zhipu: 'glm-4',
      ollama: 'llama3.2',
      vllm: 'meta-llama/Llama-2-7b-chat-hf',
      local: 'local-model',
      custom: this.model || 'gpt-3.5-turbo',
    };
    if (defaults[this.provider]) return defaults[this.provider];

    const baseUrl = (process.env.LLM_BASE_URL || '').toLowerCase();
    if (baseUrl.includes('modelscope')) return 'Qwen/Qwen2.5-72B-Instruct';
    if (baseUrl.includes('deepseek')) return 'deepseek-chat';
    if (baseUrl.includes('dashscope')) return 'qwen-plus';
    if (baseUrl.includes('moonshot')) return 'moonshot-v1-8k';
    if (baseUrl.includes('bigmodel')) return 'glm-4';
    if (baseUrl.includes('ollama') || baseUrl.includes(':11434')) return 'llama3.2';
    if (baseUrl.includes(':8000') || baseUrl.includes('vllm')) return 'meta-llama/Llama-2-7b-chat-hf';
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'local-model';
    return 'gpt-3.5-turbo';
  }

  /**
   * 流式调用LLM，返回async generator
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} [temperature]
   * @returns {AsyncGenerator<string>}
   */
  async *think(messages, temperature = null) {
    console.log(`🧠 正在调用 ${this.model} 模型...`);
    try {
      const stream = await this._client.chat.completions.create({
        model: this.model,
        messages,
        temperature: temperature ?? this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
      });

      console.log('✅ 大语言模型响应成功:');
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          process.stdout.write(content);
          yield content;
        }
      }
      console.log();
    } catch (e) {
      console.error(`❌ 调用LLM API时发生错误: ${e.message}`);
      throw new HelloAgentsException(`LLM调用失败: ${e.message}`);
    }
  }

  /**
   * 非流式调用LLM，返回完整响应
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [kwargs]
   * @returns {Promise<string>}
   */
  async invoke(messages, kwargs = {}) {
    try {
      const response = await this._client.chat.completions.create({
        model: this.model,
        messages,
        temperature: kwargs.temperature ?? this.temperature,
        max_tokens: kwargs.maxTokens ?? this.maxTokens,
        ...this.kwargs,
      });
      return response.choices[0].message.content;
    } catch (e) {
      throw new HelloAgentsException(`LLM调用失败: ${e.message}`);
    }
  }

  /**
   * 流式调用LLM（think的别名，向后兼容）
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [kwargs]
   * @returns {AsyncGenerator<string>}
   */
  async *streamInvoke(messages, kwargs = {}) {
    yield* this.think(messages, kwargs.temperature ?? null);
  }

  getClient() {
    return this._client;
  }
}