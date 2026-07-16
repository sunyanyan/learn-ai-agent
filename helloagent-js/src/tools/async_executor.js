export class AsyncToolExecutor {
  constructor(registry, maxWorkers = 4) {
    this.registry = registry;
    this.maxWorkers = maxWorkers;
  }

  async executeToolAsync(toolName, inputData) {
    try {
      return await this.registry.executeTool(toolName, inputData);
    } catch (e) {
      return `❌ 工具 '${toolName}' 异步执行失败: ${e.message}`;
    }
  }

  async executeToolsParallel(tasks) {
    console.log(`🚀 开始并行执行 ${tasks.length} 个工具任务`);

    const promises = tasks.map(async (task, i) => {
      const toolName = task.toolName;
      const inputData = task.inputData || '';
      if (!toolName) return null;

      console.log(`📝 创建任务 ${i + 1}: ${toolName}`);
      try {
        const result = await this.executeToolAsync(toolName, inputData);
        console.log(`✅ 任务 ${i + 1} 完成: ${toolName}`);
        return {
          taskId: i,
          toolName,
          inputData,
          result,
          status: 'success',
        };
      } catch (e) {
        console.error(`❌ 任务 ${i + 1} 失败: ${toolName} - ${e.message}`);
        return {
          taskId: i,
          toolName,
          inputData,
          result: e.message,
          status: 'error',
        };
      }
    });

    const results = (await Promise.all(promises)).filter(r => r !== null);
    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`🎉 并行执行完成，成功: ${successCount}/${results.length}`);
    return results;
  }

  async executeToolsBatch(toolName, inputList) {
    const tasks = inputList.map(inputData => ({ toolName, inputData }));
    return await this.executeToolsParallel(tasks);
  }
}

export async function runParallelTools(registry, tasks, maxWorkers = 4) {
  const executor = new AsyncToolExecutor(registry, maxWorkers);
  return await executor.executeToolsParallel(tasks);
}

export async function runBatchTool(registry, toolName, inputList, maxWorkers = 4) {
  const executor = new AsyncToolExecutor(registry, maxWorkers);
  return await executor.executeToolsBatch(toolName, inputList);
}