import { Tool, ToolParameter } from '../base.js';

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_RESULTS = 5;
const SUPPORTED_RETURN_MODES = new Set(['text', 'structured', 'json', 'dict']);
const SUPPORTED_BACKENDS = new Set([
  'hybrid', 'advanced', 'tavily', 'serpapi',
  'duckduckgo', 'searxng', 'perplexity',
]);

function limitText(text, tokenLimit) {
  const charLimit = tokenLimit * CHARS_PER_TOKEN;
  if (text.length <= charLimit) return text;
  return text.slice(0, charLimit) + '... [truncated]';
}

async function fetchRawContent(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function normalizedResult({ title, url, content, rawContent = null }) {
  const payload = {
    title: title || url,
    url,
    content: content || '',
  };
  if (rawContent !== null) payload.rawContent = rawContent;
  return payload;
}

function structuredPayload(results, { backend, answer = null, notices = [] }) {
  return {
    results: Array.from(results),
    backend,
    answer,
    notices: notices.filter(Boolean),
  };
}

export class SearchTool extends Tool {
  constructor({
    backend = 'hybrid',
    tavilyKey = null,
    serpapiKey = null,
    perplexityKey = null,
  } = {}) {
    super({
      name: 'search',
      description: '智能网页搜索引擎，支持 Tavily、SerpApi、DuckDuckGo、SearXNG、Perplexity 等后端，可返回结构化或文本化的搜索结果。',
    });
    this.backend = (backend || 'hybrid').toLowerCase();
    this.tavilyKey = tavilyKey || process.env.TAVILY_API_KEY;
    this.serpapiKey = serpapiKey || process.env.SERPAPI_API_KEY;
    this.perplexityKey = perplexityKey || process.env.PERPLEXITY_API_KEY;
    this.availableBackends = [];
    this._setupBackends();
  }

  async run(parameters) {
    const query = (parameters.input || parameters.query || '').trim();
    if (!query) return '错误：搜索查询不能为空';

    let backend = String(parameters.backend || this.backend || 'hybrid').toLowerCase();
    if (!SUPPORTED_BACKENDS.has(backend)) backend = 'hybrid';

    let mode = String(parameters.mode || parameters.returnMode || 'text').toLowerCase();
    if (!SUPPORTED_RETURN_MODES.has(mode)) mode = 'text';

    const fetchFullPage = Boolean(parameters.fetchFullPage || false);
    const maxResults = parseInt(parameters.maxResults || DEFAULT_MAX_RESULTS, 10);
    const maxTokens = parseInt(parameters.maxTokensPerSource || '2000', 10);
    const loopCount = parseInt(parameters.loopCount || '0', 10);

    const payload = await this._structuredSearch({
      query, backend, fetchFullPage, maxResults, maxTokens, loopCount,
    });

    if (mode === 'structured' || mode === 'json' || mode === 'dict') {
      return payload;
    }
    return this._formatTextResponse({ query, payload });
  }

  getParameters() {
    return [
      new ToolParameter({
        name: 'input',
        type: 'string',
        description: '搜索查询关键词',
        required: true,
      }),
    ];
  }

  _setupBackends() {
    if (this.tavilyKey) {
      this.availableBackends.push('tavily');
      console.log('✅ Tavily 搜索引擎已初始化');
    } else {
      console.warn('⚠️ TAVILY_API_KEY 未设置');
    }

    if (this.serpapiKey) {
      this.availableBackends.push('serpapi');
      console.log('✅ SerpApi 搜索引擎已初始化');
    } else {
      console.warn('⚠️ SERPAPI_API_KEY 未设置');
    }

    if (!SUPPORTED_BACKENDS.has(this.backend)) {
      console.warn('⚠️ 不支持的搜索后端，将使用 hybrid 模式');
      this.backend = 'hybrid';
    } else if (this.backend === 'tavily' && !this.availableBackends.includes('tavily')) {
      console.warn('⚠️ Tavily 不可用，将使用 hybrid 模式');
      this.backend = 'hybrid';
    } else if (this.backend === 'serpapi' && !this.availableBackends.includes('serpapi')) {
      console.warn('⚠️ SerpApi 不可用，将使用 hybrid 模式');
      this.backend = 'hybrid';
    }

    if (this.backend === 'hybrid') {
      if (this.availableBackends.length > 0) {
        console.log(`🔧 混合搜索模式已启用，可用后端: ${this.availableBackends.join(', ')}`);
      } else {
        console.warn('⚠️ 没有可用的 Tavily/SerpApi 搜索源，将回退到通用模式');
      }
    }
  }

  async _structuredSearch({ query, backend, fetchFullPage, maxResults, maxTokens, loopCount }) {
    const target = backend === 'hybrid' ? 'advanced' : backend;

    if (target === 'tavily') return this._searchTavily({ query, fetchFullPage, maxResults, maxTokens });
    if (target === 'serpapi') return this._searchSerpapi({ query, fetchFullPage, maxResults, maxTokens });
    if (target === 'duckduckgo') return this._searchDuckDuckGo({ query, fetchFullPage, maxResults, maxTokens });
    if (target === 'searxng') return this._searchSearXNG({ query, fetchFullPage, maxResults, maxTokens });
    if (target === 'perplexity') return this._searchPerplexity({ query, fetchFullPage, maxResults, maxTokens, loopCount });
    if (target === 'advanced') return this._searchAdvanced({ query, fetchFullPage, maxResults, maxTokens, loopCount });

    throw new Error(`Unsupported search backend: ${backend}`);
  }

  async _searchTavily({ query, fetchFullPage, maxResults, maxTokens }) {
    if (!this.tavilyKey) throw new Error('TAVILY_API_KEY 未配置');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.tavilyKey, query, max_results: maxResults, include_raw_content: fetchFullPage }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    const results = (data.results || []).slice(0, maxResults).map(item => {
      let raw = fetchFullPage ? item.raw_content : item.content;
      if (raw && fetchFullPage) raw = limitText(raw, maxTokens);
      return normalizedResult({ title: item.title || item.url || '', url: item.url || '', content: item.content || '', rawContent: raw });
    });
    return structuredPayload(results, { backend: 'tavily', answer: data.answer });
  }

  async _searchSerpapi({ query, fetchFullPage, maxResults, maxTokens }) {
    if (!this.serpapiKey) throw new Error('SERPAPI_API_KEY 未配置');
    const params = new URLSearchParams({
      engine: 'google', q: query, api_key: this.serpapiKey, gl: 'cn', hl: 'zh-cn', num: String(maxResults),
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    const answerBox = data.answer_box || {};
    const answer = answerBox.answer || answerBox.snippet;
    const results = (data.organic_results || []).slice(0, maxResults).map(item => {
      let raw = item.snippet;
      if (raw && fetchFullPage) raw = limitText(raw, maxTokens);
      return normalizedResult({ title: item.title || item.link || '', url: item.link || '', content: item.snippet || '', rawContent: raw });
    });
    return structuredPayload(results, { backend: 'serpapi', answer });
  }

  async _searchDuckDuckGo({ query, fetchFullPage, maxResults, maxTokens }) {
    const results = [];
    const notices = [];
    try {
      const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]+)<\/a>/g;
      const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
      const links = [];
      const snippets = [];
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        links.push({ url: m[1], title: m[2].trim() });
      }
      while ((m = snippetRegex.exec(html)) !== null) {
        snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
      }
      for (let i = 0; i < Math.min(links.length, maxResults); i++) {
        const url = links[i].url;
        const title = links[i].title || url;
        const content = snippets[i] || '';
        if (!url || !title) continue;
        let rawContent = content;
        if (fetchFullPage && url) {
          const fetched = await fetchRawContent(url);
          if (fetched) rawContent = limitText(fetched, maxTokens);
        }
        results.push(normalizedResult({ title, url, content, rawContent }));
      }
    } catch (e) {
      throw new Error(`DuckDuckGo 搜索失败: ${e.message}`);
    }
    return structuredPayload(results, { backend: 'duckduckgo', notices });
  }

  async _searchSearXNG({ query, fetchFullPage, maxResults, maxTokens }) {
    const host = (process.env.SEARXNG_URL || 'http://localhost:8888').replace(/\/$/, '');
    const res = await fetch(`${host}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN&safesearch=1&categories=general`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const entries = (data.results || []).slice(0, maxResults);
    const results = [];
    for (const entry of entries) {
      const url = entry.url || entry.link;
      const title = entry.title || url || '';
      const content = entry.content || entry.snippet || '';
      let rawContent = content;
      if (fetchFullPage && url) {
        const fetched = await fetchRawContent(url);
        if (fetched) rawContent = fetched;
      }
      results.push(normalizedResult({ title, url, content, rawContent }));
    }
    return structuredPayload(results, { backend: 'searxng' });
  }

  async _searchPerplexity({ query, fetchFullPage, maxResults, maxTokens, loopCount }) {
    if (!this.perplexityKey) throw new Error('PERPLEXITY_API_KEY 未配置');
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.perplexityKey}`,
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: 'Search the web and provide factual information with sources.' },
          { role: 'user', content: query },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    const content = data.choices[0].message.content;
    const citations = data.citations || ['https://perplexity.ai'];
    const results = citations.slice(0, maxResults).map((url, idx) => {
      const snippet = idx === 0 ? content : 'See main Perplexity response above.';
      const raw = fetchFullPage && idx === 0 ? limitText(content, maxTokens) : null;
      return normalizedResult({ title: `Perplexity Source ${loopCount + 1}-${idx + 1}`, url, content: snippet, rawContent: raw });
    });
    return structuredPayload(results, { backend: 'perplexity', answer: content });
  }

  async _searchAdvanced({ query, fetchFullPage, maxResults, maxTokens, loopCount }) {
    const notices = [];
    let aggregated = [];
    let answer = null;
    let backendUsed = 'advanced';

    if (this.tavilyKey) {
      try {
        const payload = await this._searchTavily({ query, fetchFullPage, maxResults, maxTokens });
        if (payload.results.length > 0) return payload;
        notices.push('⚠️ Tavily 未返回有效结果，尝试其他搜索源');
      } catch (e) {
        notices.push(`⚠️ Tavily 搜索失败：${e.message}`);
      }
    }

    if (this.serpapiKey) {
      try {
        const payload = await this._searchSerpapi({ query, fetchFullPage, maxResults, maxTokens });
        if (payload.results.length > 0) {
          payload.notices = [...notices, ...payload.notices];
          return payload;
        }
        notices.push('⚠️ SerpApi 未返回有效结果，回退到通用搜索');
      } catch (e) {
        notices.push(`⚠️ SerpApi 搜索失败：${e.message}`);
      }
    }

    try {
      const ddg = await this._searchDuckDuckGo({ query, fetchFullPage, maxResults, maxTokens });
      aggregated.push(...ddg.results);
      notices.push(...(ddg.notices || []));
      backendUsed = ddg.backend || backendUsed;
    } catch (e) {
      notices.push(`⚠️ DuckDuckGo 搜索失败：${e.message}`);
    }

    return structuredPayload(aggregated, { backend: backendUsed, answer, notices });
  }

  _formatTextResponse({ query, payload }) {
    const answer = payload.answer;
    const notices = payload.notices || [];
    const results = payload.results || [];
    const backend = payload.backend || this.backend;

    const lines = [`🔍 搜索关键词：${query}`, `🧭 使用搜索源：${backend}`];
    if (answer) lines.push(`💡 直接答案：${answer}`);

    if (results.length > 0) {
      lines.push('');
      lines.push('📚 参考来源：');
      results.forEach((item, idx) => {
        lines.push(`[${idx + 1}] ${item.title || item.url || ''}`);
        if (item.content) lines.push(`    ${item.content}`);
        if (item.url) lines.push(`    来源: ${item.url}`);
        lines.push('');
      });
    } else {
      lines.push('❌ 未找到相关搜索结果。');
    }

    if (notices.length > 0) {
      lines.push('⚠️ 注意事项：');
      for (const n of notices) {
        if (n) lines.push(`- ${n}`);
      }
    }

    return lines.filter(l => l !== null).join('\n');
  }
}

export function search(query, backend = 'hybrid') {
  const tool = new SearchTool({ backend });
  return tool.run({ input: query, backend });
}

export function searchTavily(query) {
  const tool = new SearchTool({ backend: 'tavily' });
  return tool.run({ input: query, backend: 'tavily' });
}

export function searchSerpapi(query) {
  const tool = new SearchTool({ backend: 'serpapi' });
  return tool.run({ input: query, backend: 'serpapi' });
}

export function searchHybrid(query) {
  const tool = new SearchTool({ backend: 'hybrid' });
  return tool.run({ input: query, backend: 'hybrid' });
}