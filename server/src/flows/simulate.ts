/**
 * simulate：Icarus Verilog 编译（iverilog）+ 运行（vvp），产出 VCD 波形。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic, SimulateOptions, SimulateResult } from '@webeda/shared';
import { config } from '../config';
import { FlowError, type Flow } from '../jobs/context';
import { IDENT_RE, checkTopName, fileExists, throwIfCancelled, tryAddArtifact } from './common';
import { PathMapper, finalizeDiagnostics, hasError, parseIverilogOutput, parseVvpOutput } from './diagnostics';
import { isSafeRelativePath, parseCompileFlags, parseRunFlags } from './flags';
import { findTopCandidates, scanFiles, unsafePathRefs } from './verilogScan';

export const AUTO_DUMP_FILE = '_webeda_dump.v';
export const AUTO_DUMP_MODULE = '_webeda_dump';
const SIM_OUT = 'sim.vvp';
const STANDARDS: Record<NonNullable<SimulateOptions['standard']>, string> = {
  '1995': '-g1995',
  '2001': '-g2001',
  '2005': '-g2005',
  '2012': '-g2012',
};

/** 自动注入的波形模块 */
export function autoDumpSource(roots: string[], vcd = 'dump.vcd'): string {
  const lines = [`// 由 WebEDA 自动生成：源码中没有 $dumpfile 时记录全部信号`, `module ${AUTO_DUMP_MODULE};`, '  initial begin', `    $dumpfile("${vcd}");`];
  for (const r of roots) lines.push(`    $dumpvars(0, ${r});`);
  lines.push('  end', 'endmodule', '');
  return lines.join('\n');
}

function clampTimeout(sec: number | undefined): number {
  const v = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : config.limits.defaultTimeoutSec;
  return Math.min(Math.max(1, Math.round(v)), config.limits.maxTimeoutSec);
}

export const simulate: Flow<'simulate'> = async (ctx, req) => {
  const opts: SimulateOptions = req.options ?? {};
  const diagnostics: Diagnostic[] = [];
  const mapper = new PathMapper(ctx.files, ctx.workDir);
  const finish = (extra: Partial<SimulateResult> = {}): SimulateResult => ({
    kind: 'simulate',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    exitCode: null,
    timedOut: false,
    ...extra,
  });
  const webeda = (severity: Diagnostic['severity'], message: string, file?: string, line?: number) => {
    const d: Diagnostic = { severity, message, tool: 'webeda' };
    if (file) d.file = file;
    if (file && line) d.line = line;
    diagnostics.push(d);
  };

  // —— 源文件：设计在前，测试平台在后；include 文件不单独编译
  const design = ctx.files.filter((f) => f.role === 'design');
  const tb = ctx.files.filter((f) => f.role === 'testbench');
  const sources = [...design, ...tb];
  if (!sources.length) {
    throw new FlowError('没有可仿真的源文件', [
      { severity: 'error', tool: 'webeda', message: '没有找到设计或测试平台角色的 Verilog/SystemVerilog 文件' },
    ]);
  }
  if (sources.some((f) => f.name === AUTO_DUMP_FILE)) {
    throw new FlowError(`文件名 ${AUTO_DUMP_FILE} 为 WebEDA 保留名，请重命名`);
  }

  const std = opts.standard ?? '2012';
  if (!STANDARDS[std]) throw new FlowError(`不支持的语言标准：${String(std)}`);
  const top = checkTopName(opts.top);

  const cflags = parseCompileFlags(opts.compileFlags);
  const rflags = parseRunFlags(opts.runFlags);
  for (const e of cflags.errors) webeda('error', `编译参数：${e}`);
  for (const e of rflags.errors) webeda('error', `运行参数：${e}`);
  if (hasError(diagnostics)) return finish();

  // —— 扫描源码：顶层候选、$dumpfile、越界路径
  const includes = ctx.files.filter((f) => f.role === 'include');
  const scan = scanFiles([...sources, ...includes].map((f) => ({ name: f.name, content: f.content, role: f.role })));
  for (const ref of unsafePathRefs(scan)) {
    webeda('error', `${ref.call} 使用了工作目录之外的路径 "${ref.path}"：只能使用相对路径（文件需一并上传）`, ref.file, ref.line);
  }
  if (hasError(diagnostics)) return finish();

  const args = [STANDARDS[std], '-o', SIM_OUT, '-I.', ...cflags.args];
  if (top && !cflags.tops.includes(top)) args.push('-s', top);
  const fileArgs = sources.map((f) => f.name);

  const autoDump = opts.autoDump !== false && !scan.hasDumpfile;
  if (autoDump) {
    const explicit = top ? [top, ...cflags.tops] : cflags.tops;
    const roots = (explicit.length ? explicit : findTopCandidates(scan, true)).filter((r) => IDENT_RE.test(r));
    const uniqueRoots = [...new Set(roots)];
    if (uniqueRoots.length) {
      await fs.writeFile(path.join(ctx.workDir, AUTO_DUMP_FILE), autoDumpSource(uniqueRoots));
      fileArgs.push(AUTO_DUMP_FILE);
      // 一旦出现 -s，iverilog 只把列出的模块当作根，所以候选顶层也要显式列出
      if (!explicit.length) for (const r of uniqueRoots) args.push('-s', r);
      args.push('-s', AUTO_DUMP_MODULE);
      ctx.log('info', `自动记录波形：$dumpvars(0, ${uniqueRoots.join(', ')}) → dump.vcd\n`);
    } else {
      webeda('info', '未能确定仿真顶层模块，未自动生成波形；可在设置中指定顶层，或在测试平台中调用 $dumpfile/$dumpvars');
    }
  }

  // —— 编译
  ctx.stage('compile');
  const comp = await ctx.run('iverilog', [...args, ...fileArgs], { timeoutSec: Math.min(config.limits.toolTimeoutSec, 120) });
  throwIfCancelled(ctx, comp);
  const compiled = comp.code === 0 && !comp.timedOut && (await fileExists(ctx, SIM_OUT));
  diagnostics.push(...parseIverilogOutput(comp.stdout + '\n' + comp.stderr, mapper, !compiled, [AUTO_DUMP_FILE]));
  if (!compiled) {
    if (comp.timedOut) webeda('error', 'iverilog 编译超时');
    else if (!hasError(diagnostics)) webeda('error', `iverilog 编译失败（退出码 ${comp.code ?? '未知'}），请查看日志`);
    return finish();
  }

  // —— 运行
  ctx.stage('run');
  const timeoutSec = clampTimeout(opts.timeoutSec);
  const run = await ctx.run('vvp', ['-n', SIM_OUT, ...rflags.args], { timeoutSec });
  throwIfCancelled(ctx, run);
  diagnostics.push(...parseVvpOutput(run.stdout + '\n' + run.stderr, mapper));
  if (run.timedOut) {
    webeda('warning', `仿真运行超过 ${timeoutSec} 秒已被中止。请确认测试平台最终会调用 $finish（例如 initial begin #1000 $finish; end）。`);
  } else if (run.code !== 0 && !hasError(diagnostics)) {
    webeda('error', `仿真异常结束（vvp 退出码 ${run.code ?? '未知'}）`);
  }

  // —— 波形
  const candidates: string[] = autoDump ? ['dump.vcd'] : [];
  for (const d of scan.dumpfiles) {
    if (!isSafeRelativePath(d)) continue;
    const n = d.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (!candidates.includes(n)) candidates.push(n);
  }
  const found: string[] = [];
  for (const c of candidates) if (await fileExists(ctx, c)) found.push(c);
  if (!found.length && scan.hasDumpfile) {
    // $dumpfile 参数不是字面量：在工作目录根下找新生成的 .vcd
    const entries = await fs.readdir(ctx.workDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isFile() && /\.vcd$/i.test(e.name)) found.push(e.name);
  }
  let vcd: string | undefined;
  for (const f of found) {
    if (await tryAddArtifact(ctx, diagnostics, f, 'vcd', run.timedOut ? '仿真波形（超时，不完整）' : '仿真波形')) vcd ??= f;
  }
  if (!vcd && !run.timedOut && opts.autoDump !== false && scan.hasDumpfile && !found.length) {
    webeda('info', '源码调用了 $dumpfile，但没有生成波形文件（可能没有执行到 $dumpvars）');
  }

  const res = finish({ exitCode: run.code, timedOut: run.timedOut });
  if (vcd) res.vcd = vcd;
  return res;
};
