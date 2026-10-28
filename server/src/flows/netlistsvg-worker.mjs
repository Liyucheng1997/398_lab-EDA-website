// netlistsvg 渲染 worker：布局（elkjs）是纯 CPU 计算，放在 worker_thread 中避免阻塞服务器事件循环。
// 消息：{ id, netlist } → { id, svg } | { id, error }
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let netlistsvg;
let skin;
let loadError;
try {
  netlistsvg = require('netlistsvg');
  const pkgDir = path.dirname(require.resolve('netlistsvg/package.json'));
  skin = fs.readFileSync(path.join(pkgDir, 'lib', 'default.svg'), 'utf8');
} catch (e) {
  loadError = `无法加载 netlistsvg：${e && e.message ? e.message : e}`;
}

parentPort.on('message', async (msg) => {
  const { id, netlist } = msg;
  if (loadError) {
    parentPort.postMessage({ id, error: loadError });
    return;
  }
  try {
    const svg = await netlistsvg.render(skin, netlist);
    parentPort.postMessage({ id, svg: String(svg) });
  } catch (e) {
    parentPort.postMessage({ id, error: e && e.message ? e.message : String(e) });
  }
});
