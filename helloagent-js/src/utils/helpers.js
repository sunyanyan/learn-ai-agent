import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export function formatTime(date = null, formatStr = null) {
  const d = date || new Date();
  if (!formatStr) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return formatStr
    .replace('%Y', d.getFullYear())
    .replace('%m', String(d.getMonth() + 1).padStart(2, '0'))
    .replace('%d', String(d.getDate()).padStart(2, '0'))
    .replace('%H', String(d.getHours()).padStart(2, '0'))
    .replace('%M', String(d.getMinutes()).padStart(2, '0'))
    .replace('%S', String(d.getSeconds()).padStart(2, '0'));
}

export function validateConfig(config, requiredKeys) {
  const missing = requiredKeys.filter(key => !(key in config));
  if (missing.length > 0) {
    throw new Error(`配置缺少必需的键: ${missing.join(', ')}`);
  }
  return true;
}

export function safeImport(modulePath) {
  try {
    return import(modulePath);
  } catch (e) {
    throw new Error(`无法导入 ${modulePath}: ${e.message}`);
  }
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url);
  return join(dirname(__filename), '..', '..');
}

export function mergeObjects(obj1, obj2) {
  const result = { ...obj1 };
  for (const [key, value] of Object.entries(obj2)) {
    if (key in result && typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])
        && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = mergeObjects(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}