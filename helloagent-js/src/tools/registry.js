export class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._functions = new Map();
  }

  registerTool(tool, autoExpand = true) {
    if (autoExpand && tool.expandable) {
      const expanded = tool.getExpandedTools();
      if (expanded) {
        for (const subTool of expanded) {
          if (this._tools.has(subTool.name)) {
            console.warn(`⚠️ 警告：工具 '${subTool.name}' 已存在，将被覆盖。`);
          }
          this._tools.set(subTool.name, subTool);
        }
        console.log(`✅ 工具 '${tool.name}' 已展开为 ${expanded.length} 个独立工具`);
        return;
      }
    }

    if (this._tools.has(tool.name)) {
      console.warn(`⚠️ 警告：工具 '${tool.name}' 已存在，将被覆盖。`);
    }
    this._tools.set(tool.name, tool);
    console.log(`✅ 工具 '${tool.name}' 已注册。`);
  }

  registerFunction(name, description, func) {
    if (this._functions.has(name)) {
      console.warn(`⚠️ 警告：工具 '${name}' 已存在，将被覆盖。`);
    }
    this._functions.set(name, { description, func });
    console.log(`✅ 工具 '${name}' 已注册。`);
  }

  unregister(name) {
    if (this._tools.has(name)) {
      this._tools.delete(name);
      console.log(`🗑️ 工具 '${name}' 已注销。`);
    } else if (this._functions.has(name)) {
      this._functions.delete(name);
      console.log(`🗑️ 工具 '${name}' 已注销。`);
    } else {
      console.warn(`⚠️ 工具 '${name}' 不存在。`);
    }
  }

  getTool(name) {
    return this._tools.get(name) || null;
  }

  getFunction(name) {
    const info = this._functions.get(name);
    return info ? info.func : null;
  }

  async executeTool(name, inputText) {
    if (this._tools.has(name)) {
      const tool = this._tools.get(name);
      try {
        return await tool.run({ input: inputText });
      } catch (e) {
        return `错误：执行工具 '${name}' 时发生异常: ${e.message}`;
      }
    }
    if (this._functions.has(name)) {
      const func = this._functions.get(name).func;
      try {
        return await func(inputText);
      } catch (e) {
        return `错误：执行工具 '${name}' 时发生异常: ${e.message}`;
      }
    }
    return `错误：未找到名为 '${name}' 的工具。`;
  }

  getToolsDescription() {
    const descriptions = [];
    for (const tool of this._tools.values()) {
      descriptions.push(`- ${tool.name}: ${tool.description}`);
    }
    for (const [name, info] of this._functions) {
      descriptions.push(`- ${name}: ${info.description}`);
    }
    return descriptions.length > 0 ? descriptions.join('\n') : '暂无可用工具';
  }

  listTools() {
    return [...this._tools.keys(), ...this._functions.keys()];
  }

  getAllTools() {
    return [...this._tools.values()];
  }

  clear() {
    this._tools.clear();
    this._functions.clear();
    console.log('🧹 所有工具已清空。');
  }
}

export const globalRegistry = new ToolRegistry();