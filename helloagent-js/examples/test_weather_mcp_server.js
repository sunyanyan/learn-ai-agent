#!/usr/bin/env node
/**
 * 测试天气查询 MCP 服务器（JS 版）
 *
 * 对应 Python 教程：15_test_weather_mcp_server.py
 * 通过 stdio 传输连接到 weather_mcp_server.js，依次测试三个工具：
 *   1. get_server_info  — 获取服务器信息
 *   2. list_supported_cities — 列出支持的城市
 *   3. get_weather (北京)     — 查询实时天气
 *   4. get_weather (深圳)     — 查询实时天气
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { MCPClient } from '../src/protocols/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, 'weather_mcp_server.js');

async function testWeatherServer() {
  const client = new MCPClient({ serverSource: ['node', serverScript] });

  try {
    await client.connect();

    const info = JSON.parse((await client.callTool('get_server_info', {}))[0]?.text || '{}');
    console.log(`服务器: ${info.name} v${info.version}`);

    const cities = JSON.parse((await client.callTool('list_supported_cities', {}))[0]?.text || '{}');
    console.log(`支持城市: ${cities.count} 个 → ${cities.cities.join('、')}`);

    const bjWeather = JSON.parse((await client.callTool('get_weather', { city: '北京' }))[0]?.text || '{}');
    if (!bjWeather.error) {
      console.log(`\n北京天气: ${bjWeather.temperature}°C, ${bjWeather.condition}`);
    } else {
      console.log(`\n北京天气查询失败: ${bjWeather.error}`);
    }

    const szWeather = JSON.parse((await client.callTool('get_weather', { city: '深圳' }))[0]?.text || '{}');
    if (!szWeather.error) {
      console.log(`深圳天气: ${szWeather.temperature}°C, ${szWeather.condition}`);
    } else {
      console.log(`深圳天气查询失败: ${szWeather.error}`);
    }

    console.log('\n✅ 所有测试完成！');
  } catch (e) {
    console.error(`❌ 测试失败: ${e.message}`);
  } finally {
    await client.disconnect();
  }
}

testWeatherServer().catch(console.error);