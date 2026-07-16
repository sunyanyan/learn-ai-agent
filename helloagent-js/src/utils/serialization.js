import { promises as fs } from 'fs';

export function serializeObject(obj, format = 'json') {
  if (format === 'json') {
    return JSON.stringify(obj, null, 2);
  }
  throw new Error(`不支持的序列化格式: ${format}`);
}

export function deserializeObject(data, format = 'json') {
  if (format === 'json') {
    return JSON.parse(data);
  }
  throw new Error(`不支持的反序列化格式: ${format}`);
}

export async function saveToFile(obj, filepath, format = 'json') {
  const data = serializeObject(obj, format);
  await fs.writeFile(filepath, data, 'utf-8');
}

export async function loadFromFile(filepath, format = 'json') {
  const data = await fs.readFile(filepath, 'utf-8');
  return deserializeObject(data, format);
}