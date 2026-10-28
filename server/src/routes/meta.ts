import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ExampleSummary, ToolInfo } from '@webeda/shared';
import { EXAMPLES } from '../examples';
import { findIverilogBin, runProcess } from '../tools/exec';
import { SERVER_ROOT } from '../config';

export const metaRouter = Router();

let toolCache: ToolInfo[] | null = null;

/** 读取已安装包的版本。不能 require.resolve('<pkg>/package.json')：@yowasp/* 的 exports 字段没有导出它，所以沿 node_modules 向上查找 */
function pkgVersion(name: string): string | null {
  for (let dir = SERVER_ROOT; ; dir = path.dirname(dir)) {
    const p = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')).version ?? null;
    } catch {
      /* 继续向上 */
    }
    if (path.dirname(dir) === dir) return null;
  }
}

export async function getTools(): Promise<ToolInfo[]> {
  if (toolCache) return toolCache;
  const bin = findIverilogBin();
  let ivVersion: string | null = null;
  if (bin) {
    const r = await runProcess(path.join(bin, process.platform === 'win32' ? 'iverilog.exe' : 'iverilog'), ['-V'], {
      cwd: SERVER_ROOT,
      timeoutMs: 10000,
    });
    ivVersion = /version\s+([^\s]+)/i.exec(r.stdout + r.stderr)?.[1] ?? null;
  }
  const yosys = pkgVersion('@yowasp/yosys');
  const ice40 = pkgVersion('@yowasp/nextpnr-ice40');
  const ecp5 = pkgVersion('@yowasp/nextpnr-ecp5');
  const nsvg = pkgVersion('netlistsvg');
  toolCache = [
    { id: 'iverilog', name: 'Icarus Verilog', version: ivVersion, available: !!bin, runtime: 'native' },
    { id: 'yosys', name: 'Yosys', version: yosys, available: !!yosys, runtime: 'wasm' },
    { id: 'nextpnr-ice40', name: 'nextpnr-ice40', version: ice40, available: !!ice40, runtime: 'wasm' },
    { id: 'icepack', name: 'IceStorm icepack', version: ice40, available: !!ice40, runtime: 'wasm' },
    { id: 'nextpnr-ecp5', name: 'nextpnr-ecp5', version: ecp5, available: !!ecp5, runtime: 'wasm' },
    { id: 'ecppack', name: 'Trellis ecppack', version: ecp5, available: !!ecp5, runtime: 'wasm' },
    { id: 'netlistsvg', name: 'netlistsvg', version: nsvg, available: !!nsvg, runtime: 'js' },
  ];
  return toolCache;
}

metaRouter.get('/tools', async (_req, res) => {
  res.json(await getTools());
});

metaRouter.get('/examples', (_req, res) => {
  const list: ExampleSummary[] = EXAMPLES.map(({ id, title, description, category, scope, board }) => ({
    id,
    title,
    description,
    category,
    scope,
    board,
  }));
  res.json(list);
});

metaRouter.get('/examples/:id', (req, res) => {
  const ex = EXAMPLES.find((e) => e.id === req.params.id);
  if (!ex) return void res.status(404).json({ error: '示例不存在' });
  res.json(ex);
});
