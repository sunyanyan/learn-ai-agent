# 从零开始学习AI Agent

## 概念解释


* [三种范式的概念和优缺点 （ReAct、Plan-and-Solve、Reflection）](./context/three-paradigm.md)


## 快速上手demo（带说明）

### 基础概念与渐进式示例

基础代码来自： https://github.com/pguso/ai-agents-from-scratch，在这里做了整合和精简。

* [quick-demo-context.md](./quickDemo/quick-demo-context.md) 中为相关概念。
* [quick-demo.js](./quickDemo/quick-demo.js) 中为agent每个小步骤的示例js代码。

### 智能体经典范式构建

代码来自： https://github.com/datawhalechina/hello-agents 第四章，Python 代码已转换为 JS 版本。

* [chapter4-context.md](./quickDemo/chapter4-context.md) 中为 ReAct、Plan-and-Solve、Reflection 三种范式的概念整理。
* [chapter4-demo.js](./quickDemo/chapter4-demo.js) 中为三种范式的 JS 实现代码。

## 框架学习

### LangGraph

LangGraph 将智能体的执行流程建模为一种状态机（State Machine），并将其表示为有向图（Directed Graph）。在这种范式中，图的节点（Nodes）代表一个具体的计算步骤（如调用 LLM、执行工具），而边（Edges）则定义了从一个节点到另一个节点的跳转逻辑。这种设计的革命性之处在于它天然支持循环，使得构建能够进行迭代、反思和自我修正的复杂智能体工作流变得前所未有的直观和简单。

#### LangGraph搭建的智能问答助手

*  [LangGraph核心概念和智能问答助手实现](./langgraph-js/Dialogue_System-context.md)