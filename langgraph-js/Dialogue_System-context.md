# LangGraph 核心概念与 Dialogue_System.js 实现说明

> 来源：[hello-agents 第六章](https://github.com/datawhalechina/hello-agents/blob/main/code/chapter6/Langgraph/Dialogue_System.py)（JS 移植版）
> 本文为概念精简整合，对应 `Dialogue_System.js`

---

## 1. LangGraph 是什么

LangGraph 将智能体的执行流程建模为**状态机（State Machine）**，以**有向图（Directed Graph）**的形式表达。核心设计天然支持循环，使得迭代、反思、自我修正等复杂工作流变得直观。

---

## 2. 核心概念

### 2.1 State（状态）

图的"共享内存"。每个节点都能读取和写入 State，节点返回的部分更新会被 **reducer** 合并到全局状态中。

- 在 JS 中通过 `Annotation.Root({...})` 定义
- 每个字段可指定 **reducer**（合并策略）和 **default**（初始值）
- `messages` 字段使用自定义 reducer 实现消息追加，而非覆盖

### 2.2 Node（节点）

图中的一次计算步骤。每个节点是一个函数：接收当前 State，执行逻辑，返回 State 的部分更新。

- 通过 `workflow.addNode('name', fn)` 注册
- 返回值不需要包含全部字段，只需返回变化的字段
- LangGraph 会自动用 reducer 合并到全局 State

### 2.3 Edge（边）

定义节点之间的跳转关系。两种类型：

- **普通边**（`addEdge`）：固定的 A → B 跳转
- **条件边**（`addConditionalEdges`）：根据当前 State 动态决定下一个节点，可实现循环和分支

图中还有两个特殊的虚拟节点：
- `__start__`：图的入口
- `__end__`：图的出口，到达后停止执行

### 2.4 Checkpointer（检查点）

在每次节点执行后自动保存状态快照，实现：
- **中断恢复**：执行中断后可从最近的检查点继续
- **记忆持久化**：跨对话轮次保持上下文
- JS 中使用 `MemorySaver`（内存版），生产环境可换成持久化存储

### 2.5 Thread（会话）

通过 `configurable.thread_id` 标识一个独立会话。Checkpointer 按 thread_id 隔离状态，多用户互不干扰。

### 2.6 Compile & Run

- `workflow.compile()` 将图编译为可执行对象
- `app.stream(state, config)` 以流式方式逐步产出每个节点的结果
- 也可用 `app.invoke(state, config)` 一次性获取最终结果

---

## 3. Dialogue_System.js 实现说明

本系统是一个**智能搜索助手**，流程为：理解问题 → Tavily 搜索 → 生成回答（三节点线性流水线）。

### 3.1 State 定义

```
SearchState = { messages, userQuery, searchQuery, searchResults, finalAnswer, step }
```

`messages` 使用自定义 reducer 实现追加合并，其余字段为覆盖式更新。

### 3.2 三个节点

| 节点名 | 函数 | 职责 |
|---|---|---|
| `understand` | `understandQueryNode` | LLM 分析用户输入，提炼搜索关键词 |
| `search` | `tavilySearchNode` | 调用 Tavily API 执行真实搜索，保存结果 |
| `answer` | `generateAnswerNode` | 基于搜索结果（或失败回退）让 LLM 生成最终回答 |

### 3.3 边的连接

```
__start__ → understand → search → answer → __end__
```

线性流程，无条件边和循环。搜索失败时通过 `state.step === 'search_failed'` 在 answer 节点内分支处理（而非条件边）。

### 3.4 编译与运行

- `MemorySaver` 作为 checkpointer
- 每次用户提问分配一个递增的 `thread_id`
- 使用 `app.stream()` 流式执行，逐节点打印中间过程
- `readline` 循环实现交互式问答，输入 quit/exit 退出