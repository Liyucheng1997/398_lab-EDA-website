/**
 * yosys：运行用户的 Yosys 脚本（类 Vivado Tcl Console），登记脚本生成的文件为产物。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, Diagnostic, YosysResult } from '@webeda/shared';
import { FlowError, type Flow } from '../jobs/context';
import { execYosys } from './common';
import { PathMapper, finalizeDiagnostics, parseYosysOutput } from './diagnostics';
import { checkYosysScript } from './yosysScript';

export const MAX_SCRIPT_BYTES = 256 * 1024;

const OUTPUT_KINDS: Record<string, Artifact['kind']> = {
  '.json': 'json',
  '.v': 'verilog',
  '.sv': 'verilog',
  '.svg': 'svg',
  '.txt': 'text',
  '.log': 'text',
  '.rpt': 'text',
  '.blif': 'text',
  '.edif': 'text',
  '.edf': 'text',
  '.edn': 'text',
  '.il': 'text',
  '.dot': 'text',
  '.aig': 'text',
  '.aag': 'text',
  '.smt2': 'text',
  '.btor': 'text',
  '.spice': 'text',
};

async function snapshot(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
    if (st) map.set(e.name, `${st.size}:${st.mtimeMs}`);
  }
  return map;
}

export const yosys: Flow<'yosys'> = async (ctx, req) => {
  const script = typeof req.options?.script === 'string' ? req.options.script : '';
  if (!script.trim()) throw new FlowError('Yosys 脚本为空');
  if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) throw new FlowError(`Yosys 脚本过大（上限 ${MAX_SCRIPT_BYTES / 1024} KB）`);

  const diagnostics: Diagnostic[] = [];
  const problems = checkYosysScript(script);
  if (problems.length) {
    for (const p of problems) diagnostics.push({ severity: 'error', tool: 'webeda', message: `脚本第 ${p.line} 行：${p.message}` });
    return { kind: 'yosys', diagnostics: finalizeDiagnostics(diagnostics), artifacts: ctx.artifacts, durationMs: 0, exitCode: -1 };
  }

  const sourceNames = new Set(ctx.files.map((f) => f.name.toLowerCase()));
  const scriptName = sourceNames.has('script.ys') ? '_webeda_script.ys' : 'script.ys';
  await fs.writeFile(path.join(ctx.workDir, scriptName), script);
  const before = await snapshot(ctx.workDir);

  ctx.stage('yosys');
  const { result: r, text, log } = await execYosys(ctx, ['-s', scriptName]);
  diagnostics.push(...parseYosysOutput(text, new PathMapper(ctx.files, ctx.workDir)));
  if (r.timedOut) diagnostics.push({ severity: 'error', tool: 'yosys', message: 'Yosys 运行超时，已中止' });
  else if (r.code !== 0 && !diagnostics.some((d) => d.severity === 'error')) {
    diagnostics.push({ severity: 'error', tool: 'yosys', message: `Yosys 异常退出（代码 ${r.code ?? '未知'}）` });
  }

  // —— 登记脚本新建/修改的输出文件（只看工作目录根）
  const after = await snapshot(ctx.workDir);
  const outputs = [...after.keys()]
    .filter((name) => {
      if (name === scriptName || name === log || sourceNames.has(name.toLowerCase())) return false;
      if (before.get(name) === after.get(name)) return false;
      return OUTPUT_KINDS[path.extname(name).toLowerCase()] !== undefined;
    })
    .sort();
  for (const name of outputs) {
    try {
      await ctx.addArtifact(name, OUTPUT_KINDS[path.extname(name).toLowerCase()], `Yosys 输出：${name}`);
    } catch (e) {
      diagnostics.push({ severity: 'warning', tool: 'webeda', message: `产物 ${name} 未登记：${(e as Error).message}` });
    }
  }
  if (outputs.length) ctx.log('info', `已登记输出文件：${outputs.join(', ')}\n`);

  const result: YosysResult = {
    kind: 'yosys',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    exitCode: r.code ?? -1,
  };
  return result;
};
