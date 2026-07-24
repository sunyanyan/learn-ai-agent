# MCP 协议概念介绍

## MCP 架构

MCP 协议采用 Host、Client、Servers 三层架构设计,
假设你正在使用 Claude Desktop 询问："我桌面上有哪些文档？"

三层架构的职责：

* Host（宿主层）：Claude Desktop 作为 Host，负责接收用户提问并与 Claude 模型交互。Host 是用户直接交互的界面，它管理整个对话流程。
* Client（客户端层）：当 Claude 模型决定需要访问文件系统时，Host 中内置的 MCP Client 被激活。Client 负责与适当的 MCP Server 建立连接，发送请求并接收响应。
* Server（服务器层）：文件系统 MCP Server 被调用，执行实际的文件扫描操作，访问桌面目录，并返回找到的文档列表。

## Claude（或其他 LLM）是如何决定使用哪些工具的？

当用户提出问题时，完整的工具选择流程如下：

1. 工具发现阶段：MCP Client 连接到 Server 后，首先调用list_tools()获取所有可用工具的描述信息（包括工具名称、功能说明、参数定义）
2. 上下文构建：Client 将工具列表转换为 LLM 能理解的格式，添加到系统提示词中。例如：
    * 你可以使用以下工具：
        - read_file(path: str): 读取指定路径的文件内容
        - search_code(query: str, language: str): 在代码库中搜索
3. 模型推理：LLM 分析用户问题和可用工具，决定是否需要调用工具以及调用哪个工具。这个决策基于工具的描述和当前对话上下文
4. 工具执行：如果 LLM 决定使用工具，Client 通过 MCP Server 执行所选工具，获取结果
5. 结果整合：工具执行结果被送回给 LLM，LLM 结合结果生成最终回答

这个过程是完全自动化的，LLM 会根据工具描述的质量来决定是否使用以及如何使用工具。因此，编写清晰、准确的工具描述至关重要。

## 使用 MCP 客户端

* （1）连接到 MCP 服务器
    * MCP 客户端支持多种连接方式，最常用的是 Stdio 模式（通过标准输入输出与本地进程通信）：
* （2）发现可用工具
    * 连接成功后，第一步通常是查询服务器提供了哪些工具
* （3）调用工具
    * 调用工具时，只需提供工具名称和符合 JSON Schema 的参数
* （4）访问资源
    * 除了工具，MCP 服务器还可以提供资源（Resources）
* （5）使用提示模板
    * MCP 服务器可以提供预定义的提示模板（Prompts）

## MCP 传输方式

```python
from hello_agents.tools import MCPTool

# 1. Memory Transport - 内存传输（用于测试）
# 不指定任何参数，使用内置演示服务器
# 适用场景：单元测试、快速原型开发
mcp_tool = MCPTool()

# 2. Stdio Transport - 标准输入输出传输（本地开发）
# 使用命令列表启动本地服务器
# 适用场景：本地开发、调试、Python 脚本服务器
mcp_tool = MCPTool(server_command=["python", "examples/mcp_example_server.py"])

# 3. Stdio Transport with Args - 带参数的命令传输
# 可以传递额外参数
mcp_tool = MCPTool(server_command=["python", "examples/mcp_example_server.py", "--debug"])

# 4. Stdio Transport - 社区服务器（npx方式）
# 使用npx启动社区MCP服务器
mcp_tool = MCPTool(server_command=["npx", "-y", "@modelcontextprotocol/server-filesystem", "."])


#（5）HTTP Transport - HTTP 传输
# 适用场景：生产环境、远程服务、微服务架构

#（6）SSE Transport - Server-Sent Events 传输
# 适用场景：实时通信、流式处理、长连接

# StreamableHTTP Transport - 流式 HTTP 传输
# 适用场景：需要双向流式通信的 HTTP 场景
```

## 构建自定义 MCP 服务器

建自定义的 MCP 服务器以满足特定需求。主要动机包括以下几点：

* 封装业务逻辑：将企业内部特有的业务流程或复杂操作封装为标准化的 MCP 工具，供智能体统一调用。
* 访问私有数据：创建一个安全可控的接口或代理，用于访问内部数据库、API 或其他无法对公网暴露的私有数据源。
* 性能专项优化：针对高频调用或对响应延迟有严苛要求的应用场景，进行深度优化。
* 功能定制扩展：实现标准 MCP 服务未提供的特定功能，例如集成专有算法模型或连接特定的硬件设备。