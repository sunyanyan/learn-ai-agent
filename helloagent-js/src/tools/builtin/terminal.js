import { exec } from 'child_process';
import { resolve, join, relative } from 'path';
import { existsSync, statSync } from 'fs';
import { Tool, ToolParameter } from '../base.js';

const ALLOWED_COMMANDS = new Set([
  'ls', 'dir', 'tree', 'cat', 'type', 'head', 'tail', 'less', 'more',
  'find', 'where', 'grep', 'egrep', 'fgrep', 'findstr',
  'wc', 'sort', 'uniq', 'cut', 'awk', 'sed',
  'pwd', 'cd', 'file', 'stat', 'du', 'df',
  'echo', 'which', 'whereis',
  'python', 'python3', 'node', 'bash', 'sh', 'powershell', 'cmd',
]);

export class TerminalTool extends Tool {
  constructor({
    workspace = '.',
    timeout = 30,
    maxOutputSize = 10 * 1024 * 1024,
    allowCd = true,
    osType = 'auto',
  } = {}) {
    super({
      name: 'terminal',
      description: '跨平台命令行工具 - 执行安全的文件系统、文本处理和代码执行命令',
    });
    this.workspace = resolve(workspace);
    this.timeout = timeout;
    this.maxOutputSize = maxOutputSize;
    this.allowCd = allowCd;
    this.osType = osType === 'auto' ? this._detectOs() : osType.toLowerCase();
    this.currentDir = this.workspace;
  }

  _detectOs() {
    const plat = process.platform;
    if (plat === 'win32') return 'windows';
    if (plat === 'darwin') return 'mac';
    return 'linux';
  }

  async run(parameters) {
    if (!this.validateParameters(parameters)) return '❌ 参数验证失败';
    const command = (parameters.command || '').trim();
    if (!command) return '❌ 命令不能为空';

    const parts = command.split(/\s+/);
    if (parts.length === 0) return '❌ 命令不能为空';

    const baseCommand = parts[0];
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      return `❌ 不允许的命令: ${baseCommand}\n允许的命令: ${[...ALLOWED_COMMANDS].sort().join(', ')}`;
    }

    if (baseCommand === 'cd') return this._handleCd(parts);
    return await this._executeCommand(command);
  }

  getParameters() {
    return [
      new ToolParameter({
        name: 'command',
        type: 'string',
        description: `要执行的命令（白名单: ${[...ALLOWED_COMMANDS].sort().slice(0, 10).join(', ')}...）`,
        required: true,
      }),
    ];
  }

  _handleCd(parts) {
    if (!this.allowCd) return '❌ cd 命令已禁用';
    if (parts.length < 2) return `当前目录: ${this.currentDir}`;

    const target = parts[1];
    let newDir;
    if (target === '..') newDir = resolve(this.currentDir, '..');
    else if (target === '.') newDir = this.currentDir;
    else if (target === '~') newDir = this.workspace;
    else newDir = resolve(this.currentDir, target);

    const rel = relative(this.workspace, newDir);
    if (rel.startsWith('..')) return `❌ 不允许访问工作目录外的路径: ${newDir}`;

    if (!existsSync(newDir)) return `❌ 目录不存在: ${newDir}`;
    if (!statSync(newDir).isDirectory()) return `❌ 不是目录: ${newDir}`;

    this.currentDir = newDir;
    return `✅ 切换到目录: ${this.currentDir}`;
  }

  _executeCommand(command) {
    return new Promise((resolve) => {
      exec(command, {
        cwd: this.currentDir,
        timeout: this.timeout * 1000,
        maxBuffer: this.maxOutputSize,
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        let output = stdout || '';
        if (stderr) output += `\n[stderr]\n${stderr}`;
        if (output.length > this.maxOutputSize) {
          output = output.slice(0, this.maxOutputSize) + `\n\n⚠️ 输出被截断`;
        }
        if (error && error.code !== 0) {
          output = `⚠️ 命令返回码: ${error.code}\n\n${output}`;
        }
        resolve(output || '✅ 命令执行成功（无输出）');
      });
    });
  }

  getCurrentDir() {
    return this.currentDir;
  }

  resetDir() {
    this.currentDir = this.workspace;
  }

  getOsType() {
    return this.osType;
  }
}