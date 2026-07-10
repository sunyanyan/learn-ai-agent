/**
 * ========================================================================
 * 第四章 智能体经典范式构建
 *
 * 来源：https://github.com/datawhalechina/hello-agents
 * 包含 ReAct、Plan-and-Solve、Reflection 三种经典范式的 JS 实现
 *
 * 运行方式：使用 omlx 加载本地模型，兼容 OpenAI SDK
 * 运行前请先启动 omlx 并加载模型
 * ========================================================================
 */

import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';


// ─── 初始化 ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new OpenAI({
    baseURL: "http://localhost:8000/v1",
    apiKey: "omlx"
});

// 替换为你 omlx 中加载的模型名
const MODEL = 'gemma-4-26b-a4b-it-4bit';


// ─── 基础 LLM 调用封装（对应 Python 的 HelloAgentsLLM 类） ──────────────────
/**
 * 调用大语言模型，支持流式输出，返回完整响应文本。
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} temperature
 * @returns {Promise<string>}
 */
async function llmThink(messages, temperature = 0) {
    console.log(`🧠 正在调用 ${MODEL} 模型...`);
    try {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages,
            temperature,
            stream: true,
        });

        console.log("✅ 大语言模型响应成功:");
        const collectedContent = [];
        for await (const chunk of response) {
            if (!chunk.choices) continue;
            const content = chunk.choices[0].delta.content || "";
            process.stdout.write(content);
            collectedContent.push(content);
        }
        console.log(); // 流式输出结束后换行
        return collectedContent.join("");

    } catch (e) {
        console.log(`❌ 调用LLM API时发生错误: ${e.message}`);
        return null;
    }
}


// ══════════════════════════════════════════════════════════════════════════
// 示例 1：ReAct 智能体（Reasoning + Acting）
//
// 概念：Thought → Action → Observation 循环，直到得出最终答案
// 通过文本解析（正则）提取 LLM 输出中的 Thought 和 Action
// 工具执行后 Observation 追加到历史记录，形成闭环上下文
//
// 与 quick-demo.js 示例 8 的区别：
// - quick-demo.js 使用 OpenAI Function Calling（tools API）
// - 本章使用文本解析方式（Thought/Action/Finish 格式），更贴近"从零构建"
// ══════════════════════════════════════════════════════════════════════════

// ── ReAct 提示词模板 ──
const REACT_PROMPT_TEMPLATE = `请注意，你是一个有能力调用外部工具的智能助手。

可用工具如下:
{tools}

请严格按照以下格式进行回应:

Thought: 你的思考过程，用于分析问题、拆解任务和规划下一步行动。
Action: 你决定采取的行动，必须是以下格式之一:
- \`{tool_name}[{tool_input}]\`: 调用一个可用工具。
- \`Finish[最终答案]\`: 当你认为已经获得最终答案时。
- 当你收集到足够的信息，能够回答用户的最终问题时，你必须在 Action: 字段后使用 Finish[最终答案] 来输出最终答案。

现在，请开始解决以下问题:
Question: {question}
History: {history}
`;

// ── 工具执行器（对应 Python 的 ToolExecutor 类） ──
class ToolExecutor {
    constructor() {
        /** @type {Record<string, {description: string, func: Function}>} */
        this.tools = {};
    }

    /**
     * 注册一个新工具。
     */
    register(name, description, func) {
        if (this.tools[name]) {
            console.log(`警告: 工具 '${name}' 已存在，将被覆盖。`);
        }
        this.tools[name] = { description, func };
        console.log(`工具 '${name}' 已注册。`);
    }

    /**
     * 根据名称获取工具的执行函数。
     */
    get(name) {
        return this.tools[name]?.func;
    }

    /**
     * 获取所有可用工具的格式化描述字符串。
     */
    getAvailableTools() {
        return Object.entries(this.tools)
            .map(([name, info]) => `- ${name}: ${info.description}`)
            .join('\n');
    }
}

// ── 搜索工具（模拟 SerpApi，实际使用时替换为真实搜索 API） ──
async function search(query) {
    console.log(`🔍 正在执行网页搜索: ${query}`);

    // 模拟搜索结果（实际项目中替换为 SerpApi / Google API 等）
    const mockResults = {
        '华为最新手机型号及主要卖点': `[1] 华为手机- 华为官网
智能手机 ; Mate 系列. 非凡旗舰 · HUAWEI Mate XTs. 非凡大师 ; Pura 系列. 先锋影像 · HUAWEI Pura 80 Pro+ ; Pocket 系列. 美学新篇.

[2] 2025年华为手机推荐
华为目前最受欢迎的旗舰机型是 Mate 70 和 Pura 80 Pro+。Mate 70 主要卖点：顶级拍照配置，全焦段覆盖，适合专业摄影，做工出色，户外抗摔。Pura 80 Pro+ 强调先锋影像技术。

[3] 2025年华为新款手机推荐
Mate 70系列和Pura 80 Pro+系列是最新发布的旗舰机型。HUAWEI Mate 70 拍照配置顶级，全焦段覆盖。HUAWEI Pura 80 Pro+ 强调先锋影像技术。`,
    };

    await new Promise(r => setTimeout(r, 200)); // 模拟网络延迟

    // 精确匹配优先
    if (mockResults[query]) return mockResults[query];
    // 模糊匹配
    for (const key of Object.keys(mockResults)) {
        if (query.includes(key) || key.includes(query)) return mockResults[key];
    }
    return `对不起，没有找到关于 '${query}' 的信息。`;
}

// ── ReAct 智能体（对应 Python 的 ReActAgent 类） ──
class ReActAgent {
    /**
     * @param {Function} llmThinkFn - LLM 调用函数
     * @param {ToolExecutor} toolExecutor - 工具执行器
     * @param {number} maxSteps - 最大步数
     */
    constructor(llmThinkFn, toolExecutor, maxSteps = 5) {
        this.llmThink = llmThinkFn;
        this.toolExecutor = toolExecutor;
        this.maxSteps = maxSteps;
        this.history = [];
    }

    /**
     * 运行 ReAct 智能体来回答一个问题。
     */
    async run(question) {
        this.history = []; // 每次运行时重置历史记录
        let currentStep = 0;

        while (currentStep < this.maxSteps) {
            currentStep++;
            console.log(`\n--- 第 ${currentStep} 步 ---`);

            // 1. 格式化提示词
            const toolsDesc = this.toolExecutor.getAvailableTools();
            const historyStr = this.history.join('\n');
            const prompt = REACT_PROMPT_TEMPLATE
                .replace('{tools}', toolsDesc)
                .replace('{question}', question)
                .replace('{history}', historyStr);

            // 2. 调用 LLM 进行思考
            const responseText = await this.llmThink([{ role: 'user', content: prompt }]);

            if (!responseText) {
                console.log("错误: LLM 未能返回有效响应。");
                break;
            }

            // 3. 解析 LLM 的输出
            const { thought, action } = this.parseOutput(responseText);

            if (thought) console.log(`🤔 思考: ${thought}`);

            if (!action) {
                console.log("警告: 未能解析出有效的 Action，流程终止。");
                break;
            }

            // 4. 执行 Action
            if (action.startsWith('Finish')) {
                const finishMatch = action.match(/^Finish\[([\s\S]*)\]$/);
                if (finishMatch) {
                    console.log(`🎉 最终答案: ${finishMatch[1]}`);
                    return finishMatch[1];
                }
            }

            const { toolName, toolInput } = this.parseAction(action);
            if (!toolName || toolInput === null) {
                console.log("警告: Action 格式无效，跳过本轮。");
                continue;
            }

            console.log(`🎬 行动: ${toolName}[${toolInput}]`);

            const toolFunction = this.toolExecutor.get(toolName);
            const observation = toolFunction
                ? await toolFunction(toolInput)
                : `错误: 未找到名为 '${toolName}' 的工具。`;

            // 5. 观测结果的整合
            console.log(`👀 观察: ${observation}`);

            // 将本轮的 Action 和 Observation 添加到历史记录中
            this.history.push(`Action: ${action}`);
            this.history.push(`Observation: ${observation}`);
        }

        console.log("\n已达到最大步数，流程终止。");
        return null;
    }

    /**
     * 解析 LLM 的输出，提取 Thought 和 Action。
     */
    parseOutput(text) {
        // Thought: 匹配到 Action: 或文本末尾
        const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=\nAction:|$)/);
        // Action: 匹配到文本末尾
        const actionMatch = text.match(/Action:\s*([\s\S]*?)$/);
        return {
            thought: thoughtMatch ? thoughtMatch[1].trim() : null,
            action: actionMatch ? actionMatch[1].trim() : null,
        };
    }

    /**
     * 解析 Action 字符串，提取工具名称和输入。
     */
    parseAction(actionText) {
        const match = actionText.match(/^(\w+)\[([\s\S]*)\]$/);
        if (match) {
            return { toolName: match[1], toolInput: match[2] };
        }
        return { toolName: null, toolInput: null };
    }
}

async function example1_reActAgent() {
    console.log("\n========== 示例 1：ReAct 智能体 ==========\n");

    // 1. 初始化工具执行器
    const toolExecutor = new ToolExecutor();

    // 2. 注册搜索工具
    const searchDescription = "一个网页搜索引擎。当你需要回答关于时事、事实以及在你的知识库中找不到的信息时，应使用此工具。";
    toolExecutor.register("Search", searchDescription, search);

    // 3. 打印可用工具
    console.log("\n--- 可用的工具 ---");
    console.log(toolExecutor.getAvailableTools());

    // 4. 运行 ReAct 智能体
    const question = "华为最新的手机是哪一款？它的主要卖点是什么？";
    console.log(`\n问题: ${question}`);

    const agent = new ReActAgent(llmThink, toolExecutor, maxSteps = 5);
    await agent.run(question);
}


// ══════════════════════════════════════════════════════════════════════════
// 示例 2：Plan-and-Solve 智能体
//
// 概念：先规划 (Plan)，后执行 (Solve) 的两阶段范式
// 规划阶段：LLM 将问题分解为结构化步骤列表（JSON 数组）
// 执行阶段：逐步执行计划，每步将历史结果作为上下文传入下一步
//
// 与 ReAct 的区别：ReAct 走一步看一步，Plan-and-Solve 先出完整蓝图再施工
// ══════════════════════════════════════════════════════════════════════════

// ── 规划器提示词模板 ──
const PLANNER_PROMPT_TEMPLATE = `你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个JSON数组，其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划:
[
  "步骤1",
  "步骤2",
  "步骤3"
]
`;

// ── 执行器提示词模板 ──
const EXECUTOR_PROMPT_TEMPLATE = `你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决"当前步骤"，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{current_step}

请仅输出针对"当前步骤"的回答:
`;

// ── 规划器（对应 Python 的 Planner 类） ──
class Planner {
    constructor(llmThinkFn) {
        this.llmThink = llmThinkFn;
    }

    /**
     * 根据用户问题生成一个行动计划。
     * @param {string} question
     * @returns {Promise<string[]>}
     */
    async plan(question) {
        const prompt = PLANNER_PROMPT_TEMPLATE.replace('{question}', question);

        console.log("--- 正在生成计划 ---");
        const responseText = await this.llmThink([{ role: 'user', content: prompt }]) || "";

        console.log(`✅ 计划已生成:\n${responseText}`);

        // 解析 LLM 输出的 JSON 数组
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const plan = JSON.parse(jsonMatch[0]);
                return Array.isArray(plan) ? plan : [];
            }
            console.log("❌ 解析计划时出错: 未找到 JSON 数组。");
            console.log(`原始响应: ${responseText}`);
            return [];
        } catch (e) {
            console.log(`❌ 解析计划时出错: ${e.message}`);
            console.log(`原始响应: ${responseText}`);
            return [];
        }
    }
}

// ── 执行器（对应 Python 的 Executor 类） ──
class Executor {
    constructor(llmThinkFn) {
        this.llmThink = llmThinkFn;
    }

    /**
     * 根据计划，逐步执行并解决问题。
     * @param {string} question
     * @param {string[]} plan
     * @returns {Promise<string>}
     */
    async execute(question, plan) {
        let history = ""; // 用于存储历史步骤和结果的字符串

        console.log("\n--- 正在执行计划 ---");

        let responseText = "";

        for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            console.log(`\n-> 正在执行步骤 ${i + 1}/${plan.length}: ${step}`);

            const prompt = EXECUTOR_PROMPT_TEMPLATE
                .replace('{question}', question)
                .replace('{plan}', JSON.stringify(plan))
                .replace('{history}', history || "无")
                .replace('{current_step}', step);

            responseText = await this.llmThink([{ role: 'user', content: prompt }]) || "";

            // 更新历史记录，为下一步做准备
            history += `步骤 ${i + 1}: ${step}\n结果: ${responseText}\n\n`;

            console.log(`✅ 步骤 ${i + 1} 已完成，结果: ${responseText}`);
        }

        // 循环结束后，最后一步的响应就是最终答案
        return responseText;
    }
}

// ── Plan-and-Solve 智能体（对应 Python 的 PlanAndSolveAgent 类） ──
class PlanAndSolveAgent {
    constructor(llmThinkFn) {
        this.llmThink = llmThinkFn;
        this.planner = new Planner(llmThinkFn);
        this.executor = new Executor(llmThinkFn);
    }

    /**
     * 运行智能体的完整流程：先规划，后执行。
     */
    async run(question) {
        console.log(`\n--- 开始处理问题 ---\n问题: ${question}`);

        // 1. 调用规划器生成计划
        const plan = await this.planner.plan(question);

        // 检查计划是否成功生成
        if (!plan || plan.length === 0) {
            console.log("\n--- 任务终止 ---\n无法生成有效的行动计划。");
            return;
        }

        // 2. 调用执行器执行计划
        const finalAnswer = await this.executor.execute(question, plan);

        console.log(`\n--- 任务完成 ---\n最终答案: ${finalAnswer}`);
    }
}

async function example2_planAndSolveAgent() {
    console.log("\n========== 示例 2：Plan-and-Solve 智能体 ==========\n");

    const question = "一个水果店周一卖出了15个苹果。周二卖出的苹果数量是周一的两倍。周三卖出的数量比周二少了5个。请问这三天总共卖出了多少个苹果？";

    const agent = new PlanAndSolveAgent(llmThink);
    await agent.run(question);
}


// ══════════════════════════════════════════════════════════════════════════
// 示例 3：Reflection 智能体（执行 → 反思 → 优化）
//
// 概念：通过自我批判和修正来优化结果
// 执行：生成初步解决方案（"初稿"）
// 反思：评审员角色审视初稿，提供结构化反馈
// 优化：根据反馈修正初稿，生成"修订稿"
// 循环直到反馈为"无需改进"或达到最大迭代次数
//
// 核心设计：Memory 模块存储完整"执行-反思"轨迹
// ══════════════════════════════════════════════════════════════════════════

// ── 初始执行提示词模板 ──
const INITIAL_PROMPT_TEMPLATE = `你是一位资深的Python程序员。请根据以下要求，编写一个Python函数。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。

要求: {task}

请直接输出代码，不要包含任何额外的解释。
`;

// ── 反思提示词模板 ──
const REFLECT_PROMPT_TEMPLATE = `你是一位极其严格的代码评审专家和资深算法工程师，对代码的性能有极致的要求。
你的任务是审查以下Python代码，并专注于找出其在算法效率上的主要瓶颈。

# 原始任务:
{task}

# 待审查的代码:
\`\`\`python
{code}
\`\`\`

请分析该代码的时间复杂度，并思考是否存在一种算法上更优的解决方案来显著提升性能。
如果存在，请清晰地指出当前算法的不足，并提出具体的、可行的改进算法建议（例如，使用筛法替代试除法）。
如果代码在算法层面已经达到最优，才能回答"无需改进"。

请直接输出你的反馈，不要包含任何额外的解释。
`;

// ── 优化提示词模板 ──
const REFINE_PROMPT_TEMPLATE = `你是一位资深的Python程序员。你正在根据一位代码评审专家的反馈来优化你的代码。

# 原始任务:
{task}

# 你上一轮尝试的代码:
{last_code_attempt}

评审员的反馈:
{feedback}

请根据评审员的反馈，生成一个优化后的新版本代码。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。
请直接输出优化后的代码，不要包含任何额外的解释。
`;

// ── 短期记忆模块（对应 Python 的 Memory 类） ──
class Memory {
    constructor() {
        /** @type {Array<{type: string, content: string}>} */
        this.records = [];
    }

    /**
     * 向记忆中添加一条新记录。
     * @param {string} recordType - 'execution' 或 'reflection'
     * @param {string} content
     */
    addRecord(recordType, content) {
        this.records.push({ type: recordType, content });
        console.log(`📝 记忆已更新，新增一条 '${recordType}' 记录。`);
    }

    /**
     * 将所有记忆记录格式化为一个连贯的字符串文本，用于构建提示词。
     */
    getTrajectory() {
        const parts = this.records.map(record => {
            if (record.type === 'execution') {
                return `--- 上一轮尝试 (代码) ---\n${record.content}`;
            } else if (record.type === 'reflection') {
                return `--- 评审员反馈 ---\n${record.content}`;
            }
            return null;
        }).filter(Boolean);

        return parts.join('\n\n');
    }

    /**
     * 获取最近一次的执行结果（最新生成的代码）。
     * @returns {string|null}
     */
    getLastExecution() {
        for (let i = this.records.length - 1; i >= 0; i--) {
            if (this.records[i].type === 'execution') {
                return this.records[i].content;
            }
        }
        return null;
    }
}

// ── Reflection 智能体（对应 Python 的 ReflectionAgent 类） ──
class ReflectionAgent {
    /**
     * @param {Function} llmThinkFn - LLM 调用函数
     * @param {number} maxIterations - 最大迭代次数
     */
    constructor(llmThinkFn, maxIterations = 3) {
        this.llmThink = llmThinkFn;
        this.memory = new Memory();
        this.maxIterations = maxIterations;
    }

    /**
     * 运行 Reflection 智能体。
     * @param {string} task
     * @returns {Promise<string>}
     */
    async run(task) {
        console.log(`\n--- 开始处理任务 ---\n任务: ${task}`);

        // --- 1. 初始执行 ---
        console.log("\n--- 正在进行初始尝试 ---");
        const initialPrompt = INITIAL_PROMPT_TEMPLATE.replace('{task}', task);
        const initialCode = await this.getLLMResponse(initialPrompt);
        this.memory.addRecord("execution", initialCode);

        // --- 2. 迭代循环：反思与优化 ---
        for (let i = 0; i < this.maxIterations; i++) {
            console.log(`\n--- 第 ${i + 1}/${this.maxIterations} 轮迭代 ---`);

            // a. 反思
            console.log("\n-> 正在进行反思...");
            const lastCode = this.memory.getLastExecution();
            const reflectPrompt = REFLECT_PROMPT_TEMPLATE
                .replace('{task}', task)
                .replace('{code}', lastCode);
            const feedback = await this.getLLMResponse(reflectPrompt);
            this.memory.addRecord("reflection", feedback);

            // b. 检查是否需要停止
            if (feedback.includes("无需改进")) {
                console.log("\n✅ 反思认为代码已无需改进，任务完成。");
                break;
            }

            // c. 优化
            console.log("\n-> 正在进行优化...");
            const refinePrompt = REFINE_PROMPT_TEMPLATE
                .replace('{task}', task)
                .replace('{last_code_attempt}', lastCode)
                .replace('{feedback}', feedback);
            const refinedCode = await this.getLLMResponse(refinePrompt);
            this.memory.addRecord("execution", refinedCode);
        }

        const finalCode = this.memory.getLastExecution();
        console.log(`\n--- 任务完成 ---\n最终生成的代码:\n${finalCode}`);
        return finalCode;
    }

    /**
     * 辅助方法：调用 LLM 并获取完整响应。
     */
    async getLLMResponse(prompt) {
        const messages = [{ role: 'user', content: prompt }];
        const responseText = await this.llmThink(messages);
        return responseText || "";
    }
}

async function example3_reflectionAgent() {
    console.log("\n========== 示例 3：Reflection 智能体 ==========\n");

    const task = "编写一个Python函数，找出1到n之间所有的素数 (prime numbers)。";

    const agent = new ReflectionAgent(llmThink, maxIterations = 2);
    await agent.run(task);
}


// ─── 主函数 ──────────────────────────────────────────────────────────────────
async function main() {
    try {
        await example1_reActAgent();
        await example2_planAndSolveAgent();
        await example3_reflectionAgent();

        console.log("\n\n=== 所有示例完成！ ===");
    } catch (error) {
        console.error("\n❌ Error:", error.message);
        console.error("\n提示：请确保 omlx 已启动并加载了模型。");
    }
}

main();
