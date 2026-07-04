# AI Agent 核心概念速览

> 来源：[ai-agents-from-scratch](https://github.com/pguso/ai-agents-from-scratch)
> 本文为概念精简整合，对应 `quick-demo.js` 中 10 个示例

---

## 1. LLM 基础

**LLM（大语言模型）** 本质：给定上文，预测下一个 token，逐字生成回复。

- **Token**：文本的最小处理单元，≠ 词。如 "chatbot" = 2 tokens
- **Context Window**：模型的工作记忆，容量有限（2048~128K tokens），满了需裁剪旧消息
- **本地 vs 云端**：本地（隐私、免费、离线）vs 云端 API（强、快、花钱）
- **量化（Quantization）**：压缩模型精度（如 Q8、Q6、Q4），换取更小的体积和更快的速度

---

## 2. System Prompt 与 Agent 专门化

**核心公式**：`通用 LLM + System Prompt = 专门 Agent`

同一个模型，不同 system prompt = 不同角色（翻译、编码、分析师…）。

System Prompt 五要素：
1. **角色**：You are a [profession]...
2. **任务**：Your goal is to...
3. **规则**：Always do X, Never do Y
4. **输出格式**：JSON / plain text / step-by-step
5. **约束**：DO NOT include...

> 关键：详细 system prompt → 一致输出；简单 prompt → 不可预测

---

## 3. 推理 Agent

LLM 训练于文本预测而非推理，但可通过 system prompt 引导推理模式。

**LLM 的"推理"本质**：模式匹配 + 模板应用 + 统计推断，非真正的逻辑推导。

局限：
- 计算"心算"易出错（尤其大数、多步计算）
- 长上下文中容易丢失信息
- 无验证机制，错误不可见

进阶路径：纯 prompt → Chain-of-Thought（展示步骤）→ 工具增强 → ReAct 模式

---

## 4. 并行批处理

用 `Promise.all` 并行发送多个独立 LLM 请求，大幅提升吞吐。

适用场景：多用户服务、多 Agent 协作、批量分析/A-B 测试。

注意：
- 只有**独立**的任务才适合并行（有依赖的必须串行）
- 并行数受限于内存/VRAM
- 上下文空间共享：并行越多 → 每个序列可用上下文越少

---

## 5. 流式输出

LLM 逐 token 生成，streaming 暴露这个过程。

- **非流式**：等 10 秒 → 一次性返回全部
- **流式**：每生成一个 token 就返回一块 → 用户实时看到进度

好处：即时反馈、可中途打断、更好的 UX。

---

## 6. Function Calling（工具调用）

**这是 Agent 区别于普通 Chatbot 的核心能力**。

```
Agent = LLM + System Prompt + Tools
```

流程：
1. 定义工具（description + params JSON Schema + handler）
2. LLM 读取 description 决定何时调用哪个工具
3. 系统执行 handler，结果返回给 LLM
4. LLM 基于工具输出生成最终回复

> 没 Function Calling → LLM 只能"说"
> 有 Function Calling → LLM 可以"做"（获取数据、执行计算、调用 API）

---

## 7. 持久化记忆

Agent 默认**无状态**：每次对话独立，重启即遗忘。

记忆方案：将通过工具保存的信息写入文件，下次启动时注入 system prompt。

记忆类型：
- **Fact**：user_name = "Alex"
- **Preference**：favorite_food = "pizza"
- **Episodic**：2025-01-15 user asked about Python

智能去重：Agent 先比对现有记忆 → 相同则跳过 → 变了则更新 → 全新则保存。

---

## 8. ReAct 模式

**ReAct = Reasoning + Acting**，[Yao et al. 2022](https://arxiv.org/abs/2210.03629)

核心循环：
```
Thought: 我需要做什么
Action:  调用一个工具
Observation: 工具返回结果
... 重复 ...
Thought: 我已有全部信息
Answer: 最终答案
```

与纯 LLM 推理的区别：**每步用工具计算，而非心算** → 结果准确、过程透明、可调试。

---

## 9. Atom of Thought (AoT) 模式

**AoT = 最小推理单元 + 计划验证执行分离**

三阶段：
```
Phase 1: LLM 生成原子计划（JSON）
Phase 2: 系统验证计划结构
Phase 3: 系统确定性执行（不用 LLM）
```

每个 Atom = 恰好一个操作 + 显式输入 + 显式依赖，形成 DAG。

与 ReAct 对比：

| 维度 | ReAct | AoT |
|------|-------|-----|
| 规划 | 隐式（在 LLM 推理中） | 显式（JSON 结构） |
| 执行 | LLM 决定下一步 | 系统按计划执行 |
| 验证 | 无 | 执行前检查 |
| 调试 | 读文本找 | 查 Atom N |
| 回放 | 重跑整个对话 | 从任意 Atom 重跑 |

> ReAct 问："智能 agent 下一步说什么？"
> AoT 问："最小可执行计划是什么？"

---

## 10. 错误处理

Agent 编排多层不可靠步骤，失败源远多于普通应用。

错误类型：
- **ValidationError**：输入无效（不重试）
- **LLMCallError**：LLM 超时/空输出（通常可重试）
- **ToolExecutionError**：工具执行失败（视情况重试）
- **AgentWorkflowError**：多步骤编排失败（策略守卫/依赖链断）

恢复策略梯级：**超时 → 重试（指数退避 + jitter） → 降级模式 → 优雅失败**

设计原则：
- 标准化错误 code（用于监控/告警/日志聚合）
- 用户面消息与开发者日志分离
- 每次请求带 correlation id 追踪全链路
- 重试只对 transient 错误（validation 不重试）