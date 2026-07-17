/**
 * ContextBuilder - GSSC流水线实现 (JavaScript版)
 *
 * 实现 Gather-Select-Structure-Compress 上下文构建流程：
 * 1. Gather:   从多源收集候选信息（历史、记忆、RAG、工具结果）
 * 2. Select:   基于优先级、相关性、多样性筛选
 * 3. Structure: 组织成结构化上下文模板
 * 4. Compress: 在预算内压缩与规范化
 */

import { Message } from '../core/message.js';

// ─── Token 计数 ────────────────────────────────────────────

/**
 * 计算文本的近似 token 数
 *
 * 使用基于字符的粗略估算：英文约 4 字符 ≈ 1 token，中文约 2 字符 ≈ 1 token。
 * 如需精确计数，可注入自定义 tokenizer（见 ContextBuilder.constructor.options.tokenCounter）。
 *
 * @param {string} text - 输入文本
 * @returns {number} 近似 token 数
 */
export function countTokens(text) {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    // CJK 统一汉字 & 常见中文字符范围
    const code = ch.codePointAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||   // CJK 统一汉字
      (code >= 0x3400 && code <= 0x4dbf) ||   // CJK 扩展A
      (code >= 0x3000 && code <= 0x303f)      // CJK 标点
    ) {
      tokens += 0.5; // 中文约 2 字符 ≈ 1 token
    } else {
      tokens += 0.25; // 英文约 4 字符 ≈ 1 token
    }
  }
  return Math.max(1, Math.ceil(tokens));
}

// ─── ContextPacket ────────────────────────────────────────

/**
 * 上下文信息包
 */
export class ContextPacket {
  /**
   * @param {Object} opts
   * @param {string} opts.content - 上下文内容
   * @param {Date}   [opts.timestamp=new Date()] - 时间戳
   * @param {Object} [opts.metadata={}] - 元数据
   * @param {number} [opts.tokenCount=0] - 预计算的 token 数（0 = 自动计算）
   * @param {number} [opts.relevanceScore=0] - 相关性分数 0.0-1.0
   */
  constructor({ content, timestamp = new Date(), metadata = {}, tokenCount = 0, relevanceScore = 0 }) {
    this.content = content;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.tokenCount = tokenCount || countTokens(content);
    this.relevanceScore = relevanceScore;
  }
}

// ─── ContextConfig ────────────────────────────────────────

/**
 * 上下文构建配置
 */
export class ContextConfig {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxTokens=8000] - 总 token 预算
   * @param {number} [opts.reserveRatio=0.15] - 生成余量（10-20%）
   * @param {number} [opts.minRelevance=0.3] - 最小相关性阈值
   * @param {boolean} [opts.enableMMR=true] - 启用最大边际相关性（多样性）
   * @param {number} [opts.mmrLambda=0.7] - MMR平衡参数（0=纯多样性, 1=纯相关性）
   * @param {string} [opts.systemPromptTemplate=''] - 系统提示模板
   * @param {boolean} [opts.enableCompression=true] - 启用压缩
   */
  constructor({
    maxTokens = 8000,
    reserveRatio = 0.15,
    minRelevance = 0.3,
    enableMMR = true,
    mmrLambda = 0.7,
    systemPromptTemplate = '',
    enableCompression = true,
  } = {}) {
    this.maxTokens = maxTokens;
    this.reserveRatio = reserveRatio;
    this.minRelevance = minRelevance;
    this.enableMMR = enableMMR;
    this.mmrLambda = mmrLambda;
    this.systemPromptTemplate = systemPromptTemplate;
    this.enableCompression = enableCompression;
  }

  /**
   * 获取可用 token 预算（扣除余量）
   * @returns {number}
   */
  getAvailableTokens() {
    return Math.floor(this.maxTokens * (1 - this.reserveRatio));
  }
}

function tokenize(text) {
  const tokens = new Set();
  const isCjk = (code) =>
    (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
  let ascii = '';
  const flush = () => {
    if (ascii) { tokens.add(ascii); ascii = ''; }
  };
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (isCjk(code)) {
      flush();
      tokens.add(ch);
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      ascii += ch.toLowerCase();
    } else {
      flush();
    }
  }
  flush();
  return tokens;
}

// ─── ContextBuilder ───────────────────────────────────────

/**
 * 上下文构建器 - GSSC流水线
 *
 * @example
 * const builder = new ContextBuilder({
 *   memoryTool: memoryTool,
 *   ragTool: ragTool,
 *   config: new ContextConfig({ maxTokens: 8000 }),
 * });
 *
 * const context = builder.build({
 *   userQuery: '用户问题',
 *   conversationHistory: [...],
 *   systemInstructions: '系统指令',
 * });
 */
export class ContextBuilder {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.memoryTool=null] - 记忆工具，需实现 `async run(params): Promise<string>`
   * @param {Object|null} [options.ragTool=null] - RAG工具，需实现 `async run(params): Promise<string>`
   * @param {ContextConfig|null} [options.config=null] - 上下文配置
   * @param {function|null} [options.tokenCounter=null] - 自定义 token 计数函数 `(text: string) => number`
   */
  constructor({ memoryTool = null, ragTool = null, config = null, tokenCounter = null } = {}) {
    this.memoryTool = memoryTool;
    this.ragTool = ragTool;
    this.config = config || new ContextConfig();
    /** @type {function(string): number} */
    this._countTokens = tokenCounter || countTokens;
  }

  // ── 公开接口 ──────────────────────────────────

  /**
   * 构建完整上下文
   *
   * @param {Object} params
   * @param {string} params.userQuery - 用户查询
   * @param {Message[]} [params.conversationHistory=[]] - 对话历史
   * @param {string|null} [params.systemInstructions=null] - 系统指令
   * @param {ContextPacket[]} [params.additionalPackets=[]] - 额外的上下文包
   * @returns {Promise<string>} 结构化上下文字符串
   */
  async build({
    userQuery,
    conversationHistory = [],
    systemInstructions = null,
    additionalPackets = [],
  }) {
    // 1. Gather: 收集候选信息
    const packets = await this._gather({
      userQuery,
      conversationHistory,
      systemInstructions,
      additionalPackets,
    });

    // 2. Select: 筛选与排序
    const selectedPackets = this._select(packets, userQuery);

    // 3. Structure: 组织成结构化模板
    const structuredContext = this._structure({
      selectedPackets,
      userQuery,
      systemInstructions,
    });

    // 4. Compress: 压缩与规范化（如果超预算）
    const finalContext = this._compress(structuredContext);

    return finalContext;
  }

  // ── Gather ──────────────────────────────────

  /**
   * Gather: 收集候选信息
   * @private
   */
  async _gather({ userQuery, conversationHistory, systemInstructions, additionalPackets }) {
    const packets = [];

    // P0: 系统指令（强约束）
    if (systemInstructions) {
      packets.push(new ContextPacket({
        content: systemInstructions,
        metadata: { type: 'instructions' },
      }));
    }

    // P1: 从记忆中获取任务状态与关键结论
    if (this.memoryTool) {
      try {
        // 搜索任务状态相关记忆
        const stateResults = await this.memoryTool.run({
          action: 'search',
          query: '(任务状态 OR 子目标 OR 结论 OR 阻塞)',
          min_importance: 0.7,
          limit: 5,
        });
        if (stateResults && !stateResults.includes('未找到')) {
          packets.push(new ContextPacket({
            content: stateResults,
            metadata: { type: 'task_state', importance: 'high' },
          }));
        }

        // 搜索与当前查询相关的记忆
        const relatedResults = await this.memoryTool.run({
          action: 'search',
          query: userQuery,
          limit: 5,
        });
        if (relatedResults && !relatedResults.includes('未找到')) {
          packets.push(new ContextPacket({
            content: relatedResults,
            metadata: { type: 'related_memory' },
          }));
        }
      } catch (e) {
        console.warn(`⚠️ 记忆检索失败: ${e.message || e}`);
      }
    }

    // P2: 从RAG中获取事实证据
    if (this.ragTool) {
      try {
        const ragResults = await this.ragTool.run({
          action: 'search',
          query: userQuery,
          limit: 5,
        });
        if (ragResults && !ragResults.includes('未找到') && !ragResults.includes('错误')) {
          packets.push(new ContextPacket({
            content: ragResults,
            metadata: { type: 'knowledge_base' },
          }));
        }
      } catch (e) {
        console.warn(`⚠️ RAG检索失败: ${e.message || e}`);
      }
    }

    // P3: 对话历史（辅助材料）
    if (conversationHistory && conversationHistory.length > 0) {
      // 只保留最近N条
      const recentHistory = conversationHistory.slice(-10);
      const historyText = recentHistory
        .map(msg => `[${msg.role}] ${msg.content}`)
        .join('\n');
      packets.push(new ContextPacket({
        content: historyText,
        metadata: { type: 'history', count: recentHistory.length },
      }));
    }

    // 添加额外包
    packets.push(...additionalPackets);

    return packets;
  }

  // ── Select ──────────────────────────────────

  /**
   * Select: 基于分数与预算的筛选
   * @private
   */
  _select(packets, userQuery) {
    const queryTokens = tokenize(userQuery.toLowerCase());
    for (const packet of packets) {
      const contentTokens = tokenize(packet.content.toLowerCase());
      if (queryTokens.size > 0) {
        let overlap = 0;
        for (const t of queryTokens) {
          if (contentTokens.has(t)) overlap++;
        }
        packet.relevanceScore = overlap / queryTokens.size;
      } else {
        packet.relevanceScore = 0;
      }
    }

    // 2) 计算新近性（指数衰减）
    const recencyScore = (ts) => {
      const delta = Math.max((Date.now() - ts.getTime()) / 1000, 0);
      const tau = 3600; // 1小时时间尺度
      return Math.exp(-delta / tau);
    };

    // 3) 计算复合分：0.7*相关性 + 0.3*新近性
    const scoredPackets = packets.map(p => {
      const rec = recencyScore(p.timestamp);
      const score = 0.7 * p.relevanceScore + 0.3 * rec;
      return { score, packet: p };
    });

    // 4) 系统指令单独拿出，固定纳入
    const systemPackets = scoredPackets
      .filter(({ packet }) => packet.metadata.type === 'instructions')
      .map(({ packet }) => packet);
    const remaining = scoredPackets
      .filter(({ packet }) => packet.metadata.type !== 'instructions')
      .sort((a, b) => b.score - a.score)
      .map(({ packet }) => packet);

    // 5) 依据 min_relevance 过滤（对非系统包）
    const filtered = remaining.filter(
      p => p.relevanceScore >= this.config.minRelevance,
    );

    // 6) 按预算填充
    const availableTokens = this.config.getAvailableTokens();
    const selected = [];
    let usedTokens = 0;

    // 先放入系统指令（不排序）
    for (const p of systemPackets) {
      if (usedTokens + p.tokenCount <= availableTokens) {
        selected.push(p);
        usedTokens += p.tokenCount;
      }
    }

    // 再按分数加入其余
    for (const p of filtered) {
      if (usedTokens + p.tokenCount > availableTokens) continue;
      selected.push(p);
      usedTokens += p.tokenCount;
    }

    return selected;
  }

  // ── Structure ──────────────────────────────

  /**
   * Structure: 组织成结构化上下文模板
   * @private
   */
  _structure({ selectedPackets, userQuery }) {
    const sections = [];

    // [Role & Policies] - 系统指令
    const p0Packets = selectedPackets.filter(p => p.metadata.type === 'instructions');
    if (p0Packets.length > 0) {
      let roleSection = '[Role & Policies]\n';
      roleSection += p0Packets.map(p => p.content).join('\n');
      sections.push(roleSection);
    }

    // [Task] - 当前任务
    sections.push(`[Task]\n用户问题：${userQuery}`);

    // [State] - 任务状态
    const p1Packets = selectedPackets.filter(p => p.metadata.type === 'task_state');
    if (p1Packets.length > 0) {
      let stateSection = '[State]\n关键进展与未决问题：\n';
      stateSection += p1Packets.map(p => p.content).join('\n');
      sections.push(stateSection);
    }

    // [Evidence] - 事实证据
    const p2Packets = selectedPackets.filter(p =>
      ['related_memory', 'knowledge_base', 'retrieval', 'tool_result'].includes(p.metadata.type),
    );
    if (p2Packets.length > 0) {
      let evidenceSection = '[Evidence]\n事实与引用：\n';
      for (const p of p2Packets) {
        evidenceSection += `\n${p.content}\n`;
      }
      sections.push(evidenceSection);
    }

    // [Context] - 辅助材料（历史等）
    const p3Packets = selectedPackets.filter(p => p.metadata.type === 'history');
    if (p3Packets.length > 0) {
      let contextSection = '[Context]\n对话历史与背景：\n';
      contextSection += p3Packets.map(p => p.content).join('\n');
      sections.push(contextSection);
    }

    // [Output] - 输出约束
    const outputSection = [
      '[Output]',
      '请按以下格式回答：',
      '1. 结论（简洁明确）',
      '2. 依据（列出支撑证据及来源）',
      '3. 风险与假设（如有）',
      '4. 下一步行动建议（如适用）',
    ].join('\n');
    sections.push(outputSection);

    return sections.join('\n\n');
  }

  // ── Compress ──────────────────────────────

  /**
   * Compress: 压缩与规范化
   * @private
   */
  _compress(context) {
    if (!this.config.enableCompression) return context;

    const currentTokens = this._countTokens(context);
    const availableTokens = this.config.getAvailableTokens();

    if (currentTokens <= availableTokens) return context;

    // 简单截断策略（保留前N个token）
    // 实际应用中可用LLM做高保真摘要
    console.warn(
      `⚠️ 上下文超预算 (${currentTokens} > ${availableTokens})，执行截断`,
    );

    // 按段落截断，保留结构
    const lines = context.split('\n');
    const compressedLines = [];
    let usedTokens = 0;

    for (const line of lines) {
      const lineTokens = this._countTokens(line);
      if (usedTokens + lineTokens > availableTokens) break;
      compressedLines.push(line);
      usedTokens += lineTokens;
    }

    return compressedLines.join('\n');
  }
}