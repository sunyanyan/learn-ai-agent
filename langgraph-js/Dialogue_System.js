/**
 * ========================================================================
 * 智能搜索助手 - 基于 LangGraph + Tavily API 的真实搜索系统（JS 版）
 *
 * 来源：https://github.com/datawhalechina/hello-agents/blob/main/code/chapter6/Langgraph/Dialogue_System.py
 *
 * 流程：
 * 1. 理解用户需求（LLM 生成搜索关键词）
 * 2. 使用 Tavily API 真实搜索信息
 * 3. 基于搜索结果生成回答
 *
 * 运行方式：使用 omlx 加载本地模型，兼容 OpenAI SDK
 * 运行前请先启动 omlx 并加载模型
 *
 * 依赖安装：
 *   npm install @langchain/langgraph @langchain/core openai @tavily/core dotenv
 * ========================================================================
 */

import readline from 'readline';
import { ChatOpenAI } from '@langchain/openai';
import { Annotation, StateGraph, MemorySaver } from '@langchain/langgraph';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { tavily } from '@tavily/core';
import 'dotenv/config';

// ─── 初始化 ───────────────────────────────────────────────────────────────

// 与 Python 版 ChatOpenAI 对应，也与 quick-demo.js 一致：使用 omlx 本地服务
const llm = new ChatOpenAI({
    model: process.env.LLM_MODEL_ID || 'gemma-4-26b-a4b-it-4bit',
    apiKey: 'omlx',
    configuration: {
        baseURL: 'http://localhost:8000/v1',
    },
    temperature: 0.7,
});

// 初始化 Tavily 客户端
const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

// ─── 定义状态结构 ──────────────────────────────────────────────────────────
// Python 使用 TypedDict + Annotated[list, add_messages]
// JS 使用 Annotation.Root + reducer 实现消息追加

const SearchState = Annotation.Root({
    messages: Annotation({
        reducer: (left, right) => {
            if (Array.isArray(right)) return left.concat(right);
            return left.concat([right]);
        },
        default: () => [],
    }),
    userQuery: Annotation({ default: () => '' }),
    searchQuery: Annotation({ default: () => '' }),
    searchResults: Annotation({ default: () => '' }),
    finalAnswer: Annotation({ default: () => '' }),
    step: Annotation({ default: () => 'start' }),
});

// ─── LLM 调用封装 ──────────────────────────────────────────────────────────

/**
 * 调用 LLM，接收 LangChain SystemMessage 列表，返回纯文本。
 * @param {SystemMessage[]} messages
 * @returns {Promise<string>}
 */
async function llmInvoke(messages) {
    const response = await llm.invoke(messages);
    return response.content;
}

// ─── 节点函数 ──────────────────────────────────────────────────────────────

/**
 * 步骤1：理解用户查询并生成搜索关键词
 */
async function understandQueryNode(state) {
    // 获取最新的用户消息
    let userMessage = '';
    for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i] instanceof HumanMessage) {
            userMessage = state.messages[i].content;
            break;
        }
    }

    const understandPrompt = `分析用户的查询："${userMessage}"

请完成两个任务：
1. 简洁总结用户想要了解什么
2. 生成最适合搜索的关键词（中英文均可，要精准）

格式：
理解：[用户需求总结]
搜索词：[最佳搜索关键词]`;

    const responseText = await llmInvoke([new SystemMessage(understandPrompt)]);

    // 提取搜索关键词
    let searchQuery = userMessage; // 默认使用原始查询
    if (responseText.includes('搜索词：')) {
        searchQuery = responseText.split('搜索词：')[1].trim();
    } else if (responseText.includes('搜索关键词：')) {
        searchQuery = responseText.split('搜索关键词：')[1].trim();
    }

    return {
        userQuery: responseText,
        searchQuery,
        step: 'understood',
        messages: [new AIMessage(`我理解您的需求：${responseText}`)],
    };
}

/**
 * 步骤2：使用 Tavily API 进行真实搜索
 */
async function tavilySearchNode(state) {
    const searchQuery = state.searchQuery;

    try {
        console.log(`🔍 正在搜索: ${searchQuery}`);

        // 调用 Tavily 搜索 API
        const response = await tavilyClient.search(searchQuery, {
            searchDepth: 'basic',
            includeAnswer: true,
            includeRawContent: false,
            maxResults: 5,
        });

        // 处理搜索结果
        let searchResults = '';

        // 优先使用 Tavily 的综合答案
        if (response.answer) {
            searchResults = `综合答案：\n${response.answer}\n\n`;
        }

        // 添加具体的搜索结果
        if (response.results && response.results.length > 0) {
            searchResults += '相关信息：\n';
            const topResults = response.results.slice(0, 3);
            topResults.forEach((result, i) => {
                const title = result.title || '';
                const content = result.content || '';
                const url = result.url || '';
                searchResults += `${i + 1}. ${title}\n${content}\n来源：${url}\n\n`;
            });
        }

        if (!searchResults) {
            searchResults = '抱歉，没有找到相关信息。';
        }

        return {
            searchResults,
            step: 'searched',
            messages: [new AIMessage('✅ 搜索完成！找到了相关信息，正在为您整理答案...')],
        };
    } catch (e) {
        const errorMsg = `搜索时发生错误: ${e.message}`;
        console.log(`❌ ${errorMsg}`);

        return {
            searchResults: `搜索失败：${errorMsg}`,
            step: 'search_failed',
            messages: [new AIMessage('❌ 搜索遇到问题，我将基于已有知识为您回答')],
        };
    }
}

/**
 * 步骤3：基于搜索结果生成最终答案
 */
async function generateAnswerNode(state) {
    // 检查是否有搜索结果
    if (state.step === 'search_failed') {
        // 如果搜索失败，基于 LLM 知识回答
        const fallbackPrompt = `搜索API暂时不可用，请基于您的知识回答用户的问题：

用户问题：${state.userQuery}

请提供一个有用的回答，并说明这是基于已有知识的回答。`;

        const responseText = await llmInvoke([new SystemMessage(fallbackPrompt)]);

        return {
            finalAnswer: responseText,
            step: 'completed',
            messages: [new AIMessage(responseText)],
        };
    }

    // 基于搜索结果生成答案
    const answerPrompt = `基于以下搜索结果为用户提供完整、准确的答案：

用户问题：${state.userQuery}

搜索结果：
${state.searchResults}

请要求：
1. 综合搜索结果，提供准确、有用的回答
2. 如果是技术问题，提供具体的解决方案或代码
3. 引用重要信息的来源
4. 回答要结构清晰、易于理解
5. 如果搜索结果不够完整，请说明并提供补充建议`;

    const responseText = await llmInvoke([new SystemMessage(answerPrompt)]);

    return {
        finalAnswer: responseText,
        step: 'completed',
        messages: [new AIMessage(responseText)],
    };
}

// ─── 构建搜索工作流 ────────────────────────────────────────────────────────

function createSearchAssistant() {
    const workflow = new StateGraph(SearchState);

    // 添加三个节点
    workflow.addNode('understand', understandQueryNode);
    workflow.addNode('search', tavilySearchNode);
    workflow.addNode('answer', generateAnswerNode);

    // 设置线性流程
    workflow.addEdge('__start__', 'understand');
    workflow.addEdge('understand', 'search');
    workflow.addEdge('search', 'answer');
    workflow.addEdge('answer', '__end__');

    // 编译图（使用 MemorySaver 作为 checkpointer）
    const memory = new MemorySaver();
    const app = workflow.compile({ checkpointer: memory });

    return app;
}

// ─── 主函数 ────────────────────────────────────────────────────────────────

async function main() {
    // 检查 API 密钥
    if (!process.env.TAVILY_API_KEY) {
        console.log('❌ 错误：请在 .env 文件中配置 TAVILY_API_KEY');
        return;
    }

    const app = createSearchAssistant();

    console.log('🔍 智能搜索助手启动！');
    console.log('我会使用 Tavily API为您搜索最新、最准确的信息');
    console.log('支持各种问题：新闻、技术、知识问答等');
    console.log("(输入 'quit' 退出)\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    let sessionCount = 0;

    const askQuestion = () => {
        rl.question('🤔 您想了解什么: ', async (userInput) => {
            const input = userInput.trim();

            if (['quit', 'q', '退出', 'exit'].includes(input.toLowerCase())) {
                console.log('感谢使用！再见！👋');
                rl.close();
                return;
            }

            if (!input) {
                askQuestion();
                return;
            }

            sessionCount += 1;
            const config = { configurable: { thread_id: `search-session-${sessionCount}` } };

            // 初始状态
            const initialState = {
                messages: [new HumanMessage(input)],
                userQuery: '',
                searchQuery: '',
                searchResults: '',
                finalAnswer: '',
                step: 'start',
            };

            try {
                console.log('\n' + '='.repeat(60));

                // 执行工作流（stream 模式，获取每个节点的更新）
                const stream = await app.stream(initialState, config);

                for await (const output of stream) {
                    for (const [nodeName, nodeOutput] of Object.entries(output)) {
                        if (nodeOutput.messages && nodeOutput.messages.length > 0) {
                            const latestMessage = nodeOutput.messages[nodeOutput.messages.length - 1];
                            if (latestMessage instanceof AIMessage) {
                                if (nodeName === 'understand') {
                                    console.log(`🧠 理解阶段: ${latestMessage.content}`);
                                } else if (nodeName === 'search') {
                                    console.log(`🔍 搜索阶段: ${latestMessage.content}`);
                                } else if (nodeName === 'answer') {
                                    console.log(`\n💡 最终回答:\n${latestMessage.content}`);
                                }
                            }
                        }
                    }
                }

                console.log('\n' + '='.repeat(60) + '\n');
            } catch (e) {
                console.log(`❌ 发生错误: ${e}`);
                console.log('请重新输入您的问题。\n');
            }

            askQuestion();
        });
    };

    askQuestion();
}

main();