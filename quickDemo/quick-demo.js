/**
 * ========================================================================
 * AI Agent 从零到一：整合示例
 *
 * 来源：https://github.com/pguso/ai-agents-from-scratch
 * 整合了 11 个渐进式示例，演示从基础 LLM 交互到完整 Agent 架构
 *
 * 运行方式：使用 omlx 加载本地模型，兼容 OpenAI SDK
 * 运行前请先启动 omlx 并加载模型
 * ========================================================================
 */

import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';


// ─── 初始化 ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new OpenAI({
    baseURL: "http://localhost:8000/v1",
    apiKey: "omlx"
});

// 替换为你 omlx 中加载的模型名
const MODEL = 'gemma-4-26b-a4b-it-4bit';

// 工具函数：保存对话日志（用于 Memory 示例）
// ========================================================================

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 1：基础对话
 *
 * 概念：加载模型 → 创建 context → 发送 prompt → 获得回复
 * LLM 本质是"给定上文，预测下一个 token"，逐字生成回复
 * ──────────────────────────────────────────────────────────────────────
 */
async function example1_basicPrompting() {
    console.log("\n========== 示例 1：基础对话 ==========\n");

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'user', content: 'What is a large language model?' }
        ],
    });

    console.log("AI:", response.choices[0].message.content);
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 2：System Prompt 与 Agent 专门化
 *
 * 概念：通过 system prompt 把通用 LLM 变成专门角色（翻译、编码、分析等）
 * 同一个模型 + 不同 system prompt = 不同 Agent 的"身份"
 * ──────────────────────────────────────────────────────────────────────
 */
async function example2_systemPromptTranslator() {
    console.log("\n========== 示例 2：System Prompt - 翻译 Agent ==========\n");

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: 'system',
                content: `You are a professional translator. Translate the user's English text to Chinese.
Return ONLY the translation. No explanations.`
            },
            {
                role: 'user',
                content: 'Large language models are transforming how we build software.'
            }
        ],
        temperature: 0.1, // 翻译任务需要确定性输出
    });

    console.log("翻译结果:", response.choices[0].message.content);
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 3：推理 Agent
 *
 * 概念：通过 system prompt 配置 LLM 进行逻辑推理和定量分析
 * LLM 训练于文本预测而非推理，但可以通过 prompt 引导推理模式
 * 纯 LLM 推理有局限性（计数错误、算术失误），后续用工具弥补
 * ──────────────────────────────────────────────────────────────────────
 */
async function example3_reasoningAgent() {
    console.log("\n========== 示例 3：推理 Agent ==========\n");

    const systemPrompt = `You are an expert logical and quantitative reasoner.
Your goal is to analyze word problems and compute the exact numeric answer.
Return ONLY the final number. No explanation.`;

    const prompt = `If I buy 3 apples at $2 each and a discount of $1 is applied, how much do I pay?`;

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
        ],
        temperature: 0.0,
    });

    console.log("答案:", response.choices[0].message.content);
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 4：批量并行处理
 *
 * 概念：用 Promise.all 并行发送多个 LLM 请求，提升吞吐量
 * 适用于多用户场景、多 Agent 协作、批量分析
 * ──────────────────────────────────────────────────────────────────────
 */
async function example4_batchProcessing() {
    console.log("\n========== 示例 4：并行批处理 ==========\n");

    const questions = [
        "What is 6 + 6?",
        "What is the capital of France?",
        "Explain recursion in one sentence."
    ];

    // 并行发送所有请求，而不是一个一个等待
    const results = await Promise.all(
        questions.map(q =>
            client.chat.completions.create({
                model: MODEL,
                messages: [{ role: 'user', content: q }],
                max_tokens: 100,
            })
        )
    );

    results.forEach((resp, i) => {
        console.log(`Q${i + 1}: ${questions[i]}`);
        console.log(`A${i + 1}: ${resp.choices[0].message.content}\n`);
    });
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 5：流式输出
 *
 * 概念：LLM 逐 token 生成，streaming 暴露这个过程
 * onTextChunk / stream 回调让用户实时看到进度，提升 UX
 * ──────────────────────────────────────────────────────────────────────
 */
async function example5_streaming() {
    console.log("\n========== 示例 5：流式输出 ==========\n");

    const stream = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'user', content: 'Explain what hoisting is in JavaScript. Be concise.' }
        ],
        max_tokens: 500,
        stream: true,
    });

    console.log("AI: ");
    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        process.stdout.write(content);
    }
    console.log("\n");
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 6：Function Calling / 工具调用
 *
 * 概念：Function Calling 是从"文本生成器"变成"Agent"的核心能力
 * Agent = LLM + System Prompt + Tools
 * LLM 通过 description 判断何时调用哪个工具
 *
 * 流程：
 * 1. 定义工具函数（description + params JSON Schema + handler）
 * 2. 发送 prompt 时附上可用工具
 * 3. LLM 决定是否调用工具
 * 4. 库执行 handler，将结果交回 LLM
 * 5. LLM 基于工具输出生成最终回复
 * ──────────────────────────────────────────────────────────────────────
 */
async function example6_functionCalling() {
    console.log("\n========== 示例 6：Function Calling ==========\n");

    const availableFunctions = {
        getCurrentTime: {
            description: "Get the current time",
            parameters: {
                type: "object",
                properties: {},
            },
        },
        add: {
            description: "Add two numbers together",
            parameters: {
                type: "object",
                properties: {
                    a: { type: "number", description: "First number" },
                    b: { type: "number", description: "Second number" },
                },
                required: ["a", "b"],
            },
        },
    };

    // 工具的实际处理函数
    const toolHandlers = {
        getCurrentTime: () => new Date().toLocaleTimeString(),
        add: ({ a, b }) => (a + b).toString(),
    };

    const messages = [
        {
            role: 'system',
            content: 'You are a helpful assistant that can use tools. When you need real-time data or calculations, use the available functions.'
        },
        { role: 'user', content: 'What time is it right now?' }
    ];

    // 第一次调用：LLM 决定是否调用工具
    let response = await callLLMWithTools(messages, availableFunctions);

    // 如果 LLM 返回了 tool_calls，执行对应工具
    while (response.choices[0].message.tool_calls?.length > 0) {
        const message = response.choices[0].message;
        messages.push(message);

        for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function.name;
            const fnArgs = JSON.parse(toolCall.function.arguments);
            const result = toolHandlers[fnName](fnArgs);

            console.log(`   🔧 TOOL CALL: ${fnName}(${JSON.stringify(fnArgs)}) → ${result}`);

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
            });
        }

        // 再次调用 LLM，传入工具结果
        response = await callLLMWithTools(messages, availableFunctions);
    }

    console.log("AI:", response.choices[0].message.content);
}

// LLM 调用的封装（支持 function calling）
async function callLLMWithTools(messages, availableFunctions) {
    // 将 availableFunctions 转为 OpenAI tools 格式
    const tools = Object.entries(availableFunctions).map(([name, def]) => ({
        type: "function",
        function: { name, ...def },
    }));

    return await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
    });
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 7：持久化记忆
 *
 * 概念：Agent 默认无状态，通过将被记住的信息注入 system prompt 实现持久化
 * Agent 可以用 save 工具主动决定记什么；重复信息不重复保存
 * ──────────────────────────────────────────────────────────────────────
 */
async function example7_persistentMemory() {
    console.log("\n========== 示例 7：持久化记忆 ==========\n");

    const memoryFile = path.join(__dirname, 'agent-memory.json');

    // ── MemoryManager: 加载、保存、格式化记忆 ──
    // 这是一个简化的内存管理类，保持与 Mid-shot 的核心稳健思想一致。
    async function loadMemories() {
        try {
            const data = await fs.readFile(memoryFile, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { memories: [] };
        }
    }

    async function saveMemories(data) {
        await fs.writeFile(memoryFile, JSON.stringify(data, null, 2));
    }

    async function addMemory(type, key, value) {
        const data = await loadMemories();
        const existing = data.memories.find(m => m.key === key);
        if (existing) {
            if (existing.value !== value) {
                existing.value = value;
                existing.timestamp = new Date().toISOString();
                console.log(`   💾 Updated memory: ${key} → ${value}`);
            } else {
                console.log(`   ⏭️  Duplicate memory skipped: ${key}`);
            }
        } else {
            data.memories.push({ type, key, value, timestamp: new Date().toISOString() });
            console.log(`   💾 Saved memory: ${key} = ${value}`);
        }
        await saveMemories(data);
    }

    function formatMemoryForPrompt(memories) {
        if (memories.length === 0) return '';
        let text = '\n=== LONG-TERM MEMORY ===\n';
        for (const m of memories) {
            text += `- ${m.key}: ${m.value}\n`;
        }
        return text;
    }

    // ── 构建带记忆的 system prompt ──
    const memories = (await loadMemories()).memories;
    const memoryStr = formatMemoryForPrompt(memories);

    const systemPrompt = `You are a helpful assistant with long-term memory.

Before saving, compare new info against existing memories. Don't save duplicates.
If the user shares new info, use the saveMemory tool to persist it.

${memoryStr}`;

    // ── 定义保存记忆的工具 ──
    const availableFunctions = {
        saveMemory: {
            description: "Save important information to long-term memory",
            parameters: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["fact", "preference"] },
                    key: { type: "string", description: "Short identifier e.g. user_name" },
                    value: { type: "string", description: "The information value" },
                },
                required: ["type", "key", "value"],
            },
        },
    };

    const toolHandlers = {
        saveMemory: async ({ type, key, value }) => {
            await addMemory(type, key, value);
            return `Memory saved: ${key} = ${value}`;
        }
    };

    // ── 第一轮对话：教 Agent 新信息 ──
    console.log("User: Hi! My name is Alex and I love pizza.");
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: "Hi! My name is Alex and I love pizza." },
    ];

    let response = await callLLMWithTools(messages, availableFunctions);
    while (response.choices[0].message.tool_calls?.length > 0) {
        const msg = response.choices[0].message;
        messages.push(msg);
        for (const tc of msg.tool_calls) {
            const result = await toolHandlers[tc.function.name](JSON.parse(tc.function.arguments));
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        response = await callLLMWithTools(messages, availableFunctions);
    }
    console.log("AI:", response.choices[0].message.content);

    // ── 第二轮对话验证记住 ──
    console.log("\nUser: What's my favorite food?");
    messages.push({ role: 'user', content: "What's my favorite food?" });
    response = await callLLMWithTools(messages, availableFunctions);
    while (response.choices[0].message.tool_calls?.length > 0) {
        const msg = response.choices[0].message;
        messages.push(msg);
        for (const tc of msg.tool_calls) {
            const result = await toolHandlers[tc.function.name](JSON.parse(tc.function.arguments));
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        response = await callLLMWithTools(messages, availableFunctions);
    }
    console.log("AI:", response.choices[0].message.content);
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 8：ReAct 模式（Reasoning + Acting）
 *
 * 概念：思考 → 行动 → 观察 循环，直到得出最终答案
 * LLM 在每一步推理要做什么，调用工具获得结果，再决定下一步
 * 相比纯 LLM 推理，工具调用保证计算准确性
 *
 * ReAct 的关键：每步显式推理 + 每步用工具而非"心算"
 * ──────────────────────────────────────────────────────────────────────
 */
async function example8_reactAgent() {
    console.log("\n========== 示例 8：ReAct 模式 ==========\n");

    const systemPrompt = `You are a mathematical assistant using the ReAct approach.

For every problem, follow this EXACT pattern:
Thought: [Explain what you need to calculate]
Action: [Call ONE tool with specific numbers]
Observation: [Wait for the tool result]
... (repeat as needed)
Thought: [Once you have ALL the information]
Answer: [Give the final answer and STOP]

RULES:
1. Use tools for ALL calculations - never calculate in your head
2. Each Action should call exactly ONE tool
3. Only write "Answer:" when you have the complete answer`;

    // 定义计算器工具
    const availableFunctions = {
        add: {
            description: "Add two numbers together",
            parameters: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
            },
        },
        multiply: {
            description: "Multiply two numbers together",
            parameters: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
            },
        },
        divide: {
            description: "Divide first number by second",
            parameters: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
            },
        },
    };

    const toolHandlers = {
        add: ({ a, b }) => { const r = a + b; console.log(`   🔧 add(${a}, ${b}) = ${r}`); return r.toString(); },
        multiply: ({ a, b }) => { const r = a * b; console.log(`   🔧 multiply(${a}, ${b}) = ${r}`); return r.toString(); },
        divide: ({ a, b }) => { if (b === 0) return "Error: Division by zero"; const r = a / b; console.log(`   🔧 divide(${a}, ${b}) = ${r}`); return r.toString(); },
    };

    const userQuestion = "A store sells 15 items at $8 each and 20 items at $8 each. What's the total revenue?";
    console.log("User:", userQuestion, "\n");

    // ── ReAct 循环 ──
    const maxIterations = 10;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion },
    ];

    let iteration = 0;
    while (iteration < maxIterations) {
        iteration++;
        console.log(`--- Iteration ${iteration} ---`);

        let response = await callLLMWithTools(messages, availableFunctions);

        // 处理工具调用
        while (response.choices[0].message.tool_calls?.length > 0) {
            const msg = response.choices[0].message;
            messages.push(msg);
            for (const tc of msg.tool_calls) {
                const result = toolHandlers[tc.function.name](JSON.parse(tc.function.arguments));
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
            response = await callLLMWithTools(messages, availableFunctions);
        }

        const finalText = response.choices[0].message.content;
        console.log("AI:", finalText);
        messages.push({ role: 'assistant', content: finalText });

        // 检测是否到达最终答案
        if (finalText.toLowerCase().includes("answer:")) {
            console.log("\n✅ Final answer reached!");
            return;
        }

        // 让 LLM 继续推理
        messages.push({ role: 'user', content: "Continue your reasoning. What's the next step?" });
    }

    console.log("\n⚠️ Max iterations reached without final answer");
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 9：Atom of Thought (AoT) 模式
 *
 * 概念：将推理拆成最小"原子"步骤，LLM 只规划不执行
 * Plan → Validate → Execute 三阶段分离
 * 执行逻辑在代码中（白盒）而非 LLM 内部（黑盒）
 *
 * 与 ReAct 的区别：
 * - ReAct: LLM 边想边执行（下一个靠 model）
 * - AoT: LLM 出计划，系统验证后确定性执行（下一个靠 code）
 *
 * 适合生产级场景：审计、回放、测试、并行
 * ──────────────────────────────────────────────────────────────────────
 */
async function example9_aotAgent() {
    console.log("\n========== 示例 9：Atom of Thought 模式 ==========\n");

    // ── Phase 1: LLM 生成原子计划 ──
    const systemPrompt = `You are a mathematical planning assistant using Atom of Thought methodology.

Output ONLY valid JSON matching this format:
{
  "atoms": [
    {"id": 1, "kind": "tool", "name": "add", "input": {"a": 15, "b": 7}, "dependsOn": []},
    {"id": 2, "kind": "tool", "name": "multiply", "input": {"a": "<result_of_1>", "b": 3}, "dependsOn": [1]},
    {"id": 3, "kind": "final", "name": "report", "dependsOn": [2]}
  ]
}

Rules:
1. Each atom = exactly ONE operation (add/subtract/multiply/divide)
2. Use "<result_of_N>" to reference previous atom results
3. Final atom has NO input, only dependsOn
4. Available tools: add, subtract, multiply, divide
5. Output JSON only, no explanation`;

    const userQuestion = "Calculate: 100 divided by 5, then add 3, then multiply by 2";
    console.log("User:", userQuestion, "\n");
    console.log("── Phase 1: Planning ──");

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userQuestion },
        ],
        temperature: 0.0,
    });

    const rawPlan = response.choices[0].message.content;
    let plan;
    try {
        // 尝试提取 JSON
        const jsonMatch = rawPlan.match(/\{[\s\S]*\}/);
        plan = JSON.parse(jsonMatch ? jsonMatch[0] : rawPlan);
    } catch (e) {
        console.error("Failed to parse plan:", e.message);
        console.log("Raw output:", rawPlan);
        return;
    }

    console.log("Plan:", JSON.stringify(plan, null, 2), "\n");

    // ── Phase 2: 系统验证计划 ──
    console.log("── Phase 2: Validation ──");
    const toolImplementations = {
        add: (a, b) => a + b,
        subtract: (a, b) => a - b,
        multiply: (a, b) => a * b,
        divide: (a, b) => { if (b === 0) throw new Error("Division by zero"); return a / b; },
    };

    for (const atom of plan.atoms) {
        if (atom.kind === "tool" && !toolImplementations[atom.name]) {
            console.error(`❌ Unknown tool: ${atom.name}`);
            return;
        }
        console.log(`✅ Atom ${atom.id} (${atom.kind}:${atom.name}) validated`);
    }

    // ── Phase 3: 系统确定性执行 ──
    console.log("\n── Phase 3: Execution ──");
    const state = {};
    const sortedAtoms = [...plan.atoms].sort((a, b) => a.id - b.id);

    for (const atom of sortedAtoms) {
        // 解析引用
        let input = {};
        if (atom.input) {
            input = JSON.parse(JSON.stringify(atom.input));
            for (const [key, val] of Object.entries(input)) {
                if (typeof val === 'string' && val.startsWith('<result_of_')) {
                    const refId = parseInt(val.match(/\d+/)[0]);
                    input[key] = state[refId];
                    console.log(`   Resolved ${val} → ${state[refId]}`);
                }
            }
        }

        if (atom.kind === "tool") {
            state[atom.id] = toolImplementations[atom.name](input.a, input.b);
            console.log(`   Atom ${atom.id}: ${atom.name}(${input.a}, ${input.b}) = ${state[atom.id]}`);
        } else if (atom.kind === "final") {
            const finalValue = state[atom.dependsOn[0]];
            state[atom.id] = finalValue;
            console.log(`\n   🎯 FINAL ANSWER: ${finalValue}`);
        }
    }
}

/**
 * ──────────────────────────────────────────────────────────────────────
 * 示例 10：错误处理
 *
 * 概念：Agent 编排多层不可靠步骤，需要统一的错误体系
 * - LLM 调用（超时、空输出）
 * - 工具执行（网络失败、参数无效）
 * - 工作流（策略守卫、依赖链断裂）
 *
 * 恢复策略梯级：超时 → 重试（指数退避+jitter）→ 降级 → 优雅失败
 * ──────────────────────────────────────────────────────────────────────
 */
async function example10_errorHandling() {
    console.log("\n========== 示例 10：错误处理 ==========\n");

    // ── 错误分类体系 ──
    class AppError extends Error {
        constructor(code, message, { userMessage, retryable = false, cause } = {}) {
            super(message);
            this.name = this.constructor.name;
            this.code = code;
            this.userMessage = userMessage ?? "Something went wrong.";
            this.retryable = retryable;
            this.cause = cause;
        }
    }
    class ValidationError extends AppError {
        constructor(message, opts) { super("VALIDATION_ERROR", message, { ...opts, retryable: false }); }
    }
    class LLMCallError extends AppError {
        constructor(message, opts) { super("LLM_CALL_FAILED", message, { retryable: opts?.retryable ?? true, ...opts }); }
    }
    class ToolExecutionError extends AppError {
        constructor(toolName, message, opts) { super("TOOL_EXECUTION_FAILED", message, { ...opts }); this.toolName = toolName; }
    }

    // ── 工具函数 ──
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function jitteredBackoffDelay(attempt, base = 200, max = 3000) {
        const exp = Math.min(max, base * 2 ** (attempt - 1));
        return exp + Math.floor(Math.random() * Math.max(1, exp * 0.25));
    }

    async function withRetries(fn, { retries = 2, label = "op", retryOn } = {}) {
        let lastErr;
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastErr = err;
                if (attempt === retries + 1 || !retryOn?.(err)) break;
                const delay = jitteredBackoffDelay(attempt);
                console.warn(`   [retry] ${label} failed (attempt ${attempt}/${retries + 1}). Retrying in ${delay}ms.`);
                await sleep(delay);
            }
        }
        throw lastErr;
    }

    function classifyError(err) {
        const error = err instanceof AppError ? err
            : new AppError("UNKNOWN_ERROR", "Unknown error", { cause: err });
        return { error, retryable: error.retryable };
    }

    // ── 模拟可以失败的工具 ──
    let callCount = 0;
    async function unstableFetchUser({ userId }) {
        callCount++;
        await sleep(50);
        if (callCount <= 2) throw new ToolExecutionError("fetchUser", "Network timeout", { retryable: true });
        return { userId, name: "Alex", source: "primary" };
    }

    // ── Agent 调用 LLM（带重试） ──
    async function callLLM(prompt) {
        return await withRetries(
            async () => {
                try {
                    const resp = await client.chat.completions.create({
                        model: MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 200,
                    });
                    const text = resp.choices[0].message.content?.trim();
                    if (!text) throw new LLMCallError("Empty response", { retryable: true });
                    return text;
                } catch (err) {
                    if (err instanceof LLMCallError) throw err;
                    throw new LLMCallError("LLM call failed", { cause: err });
                }
            },
            {
                retries: 1,
                label: "LLM call",
                retryOn: (e) => classifyError(e).retryable,
            }
        );
    }

    // ── Agent 主流程 ──
    async function runAgent(userInput) {
        const correlationId = crypto.randomUUID();

        // 验证输入
        if (!userInput?.trim()) {
            throw new ValidationError("Empty input");
        }

        // 尝试调用 LLM
        try {
            const result = await callLLM(userInput);
            return { ok: true, output: result };
        } catch (err) {
            const { error } = classifyError(err);

            // LLM 失败 → 降级尝试用工具解决
            if (error instanceof LLMCallError) {
                console.warn("   [degraded_mode] LLM unavailable. Trying tool fallback...");
                try {
                    const profile = await withRetries(
                        () => unstableFetchUser({ userId: "u_123" }),
                        { retries: 2, label: "fetchUser", retryOn: e => classifyError(e).retryable }
                    );
                    return { ok: true, output: `Fallback result: ${profile.name} (source: ${profile.source})` };
                } catch (toolErr) {
                    console.error(`   [agent_error] code=${classifyError(toolErr).error.code} correlation=${correlationId}`);
                    return { ok: false, output: "I couldn't complete that request (Reference: " + correlationId + ")" };
                }
            }

            throw error;
        }
    }

    console.log("User: What is AI?\n");
    const result = await runAgent("What is AI?");
    console.log(result.ok ? "AI: " + result.output : "Error: " + result.output);

    // 重置计数器演示降级路径
    console.log("\n--- Degrade demo ---");
    callCount = 0;
    console.log("User: How about set this aside, what is AI?\n");
    const result2 = await runAgent("How about set this aside, what is AI?");
    console.log(result2.ok ? "AI: " + result2.output : "Error: " + result2.output);
}



// ─── 主函数 ──────────────────────────────────────────────────────────────────
async function main() {
    try {
        await example1_basicPrompting();
        await example2_systemPromptTranslator();
        await example3_reasoningAgent();
        await example4_batchProcessing();
        await example5_streaming();
        await example6_functionCalling();
        await example7_persistentMemory();
        await example8_reactAgent();
        await example9_aotAgent();
        await example10_errorHandling();

        console.log("\n\n=== 所有示例完成！ ===");
    } catch (error) {
        console.error("\n❌ Error:", error.message);
        console.error("\n提示：请确保 omlx 已启动并加载了模型。");
    }
}

main();