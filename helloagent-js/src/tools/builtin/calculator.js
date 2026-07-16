import { Tool, ToolParameter } from '../base.js';

const MATH_FUNCTIONS = {
  abs: Math.abs,
  round: Math.round,
  max: Math.max,
  min: Math.min,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  exp: Math.exp,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
};

const MATH_CONSTANTS = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ('+-*/(),'.includes(c)) { tokens.push(c); i++; continue; }
    if (c >= '0' && c <= '9' || c === '.') {
      let num = '';
      while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.')) {
        num += expr[i]; i++;
      }
      tokens.push(parseFloat(num));
      continue;
    }
    if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c === '_') {
      let name = '';
      while (i < expr.length && (expr[i] >= 'a' && expr[i] <= 'z' || expr[i] >= 'A' && expr[i] <= 'Z' || expr[i] === '_' || expr[i] >= '0' && expr[i] <= '9')) {
        name += expr[i]; i++;
      }
      tokens.push(name);
      continue;
    }
    throw new Error(`不支持的表达式类型: ${c}`);
  }
  return tokens;
}

function parseExpression(tokens, pos) {
  let [result, newPos] = parseTerm(tokens, pos);
  while (newPos < tokens.length && (tokens[newPos] === '+' || tokens[newPos] === '-')) {
    const op = tokens[newPos];
    const [right, nextPos] = parseTerm(tokens, newPos + 1);
    result = op === '+' ? result + right : result - right;
    newPos = nextPos;
  }
  return [result, newPos];
}

function parseTerm(tokens, pos) {
  let [result, newPos] = parseFactor(tokens, pos);
  while (newPos < tokens.length && (tokens[newPos] === '*' || tokens[newPos] === '/')) {
    const op = tokens[newPos];
    const [right, nextPos] = parseFactor(tokens, newPos + 1);
    result = op === '*' ? result * right : result / right;
    newPos = nextPos;
  }
  return [result, newPos];
}

function parseFactor(tokens, pos) {
  let [base, newPos] = parseUnary(tokens, pos);
  while (newPos < tokens.length && tokens[newPos] === '(') {
    throw new Error('不支持连续调用');
  }
  return [base, newPos];
}

function parseUnary(tokens, pos) {
  if (pos < tokens.length && tokens[pos] === '-') {
    const [val, nextPos] = parseUnary(tokens, pos + 1);
    return [-val, nextPos];
  }
  return parsePrimary(tokens, pos);
}

function parsePrimary(tokens, pos) {
  if (pos >= tokens.length) throw new Error('表达式不完整');
  const token = tokens[pos];
  if (typeof token === 'number') return [token, pos + 1];
  if (token === '(') {
    const [val, nextPos] = parseExpression(tokens, pos + 1);
    if (nextPos >= tokens.length || tokens[nextPos] !== ')') throw new Error('缺少右括号');
    return [val, nextPos + 1];
  }
  if (typeof token === 'string') {
    if (pos + 1 < tokens.length && tokens[pos + 1] === '(') {
      const fn = MATH_FUNCTIONS[token];
      if (!fn) throw new Error(`不支持的函数: ${token}`);
      const [arg, afterParen] = parseExpression(tokens, pos + 2);
      if (afterParen >= tokens.length || tokens[afterParen] !== ')') throw new Error('缺少右括号');
      const args = Array.isArray(arg) ? arg : [arg];
      return [fn(...args), afterParen + 1];
    }
    if (token in MATH_CONSTANTS) return [MATH_CONSTANTS[token], pos + 1];
    throw new Error(`未定义的变量: ${token}`);
  }
  throw new Error(`不支持的表达式类型: ${token}`);
}

function safeEval(expression) {
  const tokens = tokenize(expression);
  const [result] = parseExpression(tokens, 0);
  return result;
}

export class CalculatorTool extends Tool {
  constructor() {
    super({
      name: 'python_calculator',
      description: '执行数学计算。支持基本运算、数学函数等。例如：2+3*4, sqrt(16), sin(pi/2)等。',
    });
  }

  async run(parameters) {
    const expression = parameters.input || parameters.expression || '';
    if (!expression) return '错误：计算表达式不能为空';

    console.log(`🧮 正在计算: ${expression}`);
    try {
      const result = safeEval(expression);
      const resultStr = String(result);
      console.log(`✅ 计算结果: ${resultStr}`);
      return resultStr;
    } catch (e) {
      const errMsg = `计算失败: ${e.message}`;
      console.error(`❌ ${errMsg}`);
      return errMsg;
    }
  }

  getParameters() {
    return [
      new ToolParameter({
        name: 'input',
        type: 'string',
        description: '要计算的数学表达式，支持基本运算和数学函数',
        required: true,
      }),
    ];
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
}

export function calculate(expression) {
  const tool = new CalculatorTool();
  return tool.run({ input: expression });
}