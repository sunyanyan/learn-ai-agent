#!/usr/bin/env node
/**
 * 天气查询 MCP 服务器（JS 版）
 *
 * 对应 Python 教程：14_weather_mcp_server.py
 * 提供三个工具：get_weather / list_supported_cities / get_server_info
 * 使用 wttr.in 免费 API 获取实时天气数据，通过 stdio 传输运行。
 */

import { MCPServer } from '../src/protocols/index.js';

// ─── 城市中文→英文映射 ──────────────────────────────────────────────────────────

const CITY_MAP = {
  北京: 'Beijing',
  上海: 'Shanghai',
  广州: 'Guangzhou',
  深圳: 'Shenzhen',
  杭州: 'Hangzhou',
  成都: 'Chengdu',
  重庆: 'Chongqing',
  武汉: 'Wuhan',
  西安: "Xi'an",
  南京: 'Nanjing',
  天津: 'Tianjin',
  苏州: 'Suzhou',
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 从 wttr.in 获取天气数据（对应 Python get_weather_data）
 * @param {string} city - 中文城市名
 * @returns {Promise<Object>}
 */
async function getWeatherData(city) {
  const cityEn = CITY_MAP[city] || city;
  const url = `https://wttr.in/${encodeURIComponent(cityEn)}?format=j1`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  const current = data.current_condition[0];

  return {
    city,
    temperature: parseFloat(current.temp_C),
    feels_like: parseFloat(current.FeelsLikeC),
    humidity: parseInt(current.humidity, 10),
    condition: current.weatherDesc[0].value,
    wind_speed: Math.round(parseFloat(current.windspeedKmph) / 3.6, 1),
    visibility: parseFloat(current.visibility),
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
}

/**
 * 获取指定城市的当前天气（对应 Python get_weather）
 */
async function getWeather({ city } = {}) {
  if (!city) {
    return JSON.stringify({ error: '需要提供城市名（city）' });
  }
  try {
    const weatherData = await getWeatherData(city);
    return JSON.stringify(weatherData, null, 2);
  } catch (e) {
    return JSON.stringify({ error: e.message, city });
  }
}

/**
 * 列出所有支持的中文城市（对应 Python list_supported_cities）
 */
function listSupportedCities() {
  const cities = Object.keys(CITY_MAP);
  const result = { cities, count: cities.length };
  return JSON.stringify(result, null, 2);
}

/**
 * 获取服务器信息（对应 Python get_server_info）
 */
function getServerInfo() {
  const info = {
    name: 'Weather MCP Server',
    version: '1.0.0',
    tools: ['get_weather', 'list_supported_cities', 'get_server_info'],
  };
  return JSON.stringify(info, null, 2);
}

// ─── 创建并运行 MCP 服务器 ─────────────────────────────────────────────────────

const weatherServer = new MCPServer({
  name: 'weather-server',
  description: '真实天气查询服务',
});

weatherServer.addTool({
  name: 'get_weather',
  description: '获取指定城市的当前天气',
  func: getWeather,
});

weatherServer.addTool({
  name: 'list_supported_cities',
  description: '列出所有支持的中文城市',
  func: listSupportedCities,
});

weatherServer.addTool({
  name: 'get_server_info',
  description: '获取服务器信息',
  func: getServerInfo,
});

weatherServer.run({ transport: 'stdio' });