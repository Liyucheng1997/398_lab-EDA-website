/**
 * flow 共用的小工具：选择源文件、拼 Yosys 脚本、运行 Yosys 并解析诊断、读取工作目录中的 JSON。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic, SourceFile } from '@webeda/shared';
import { FlowError, type JobContext } from '../jobs/context';
import { isHdl } from '../jobs/files';
import type { RunResult } from '../tools/exec';
import { PathMapper, parseYosysOutput, stripAnsi } from './diagnostics';
import { findTopCandidates, scanFiles, type ScanResult } from './verilogScan';
import type { YosysDesign } from './yosysJson';

export const IDENT_RE = /^[A-Za-z_][\w$]*$/;

/** 综合类 flow 的输入：design 角色文件；没有时退回到所有非测试平台的 HDL 文件 */
export function synthSources(files: SourceFile[]): SourceFile[] {
  const design = files.filter((f) => f.role === 'design');
  if (design.length) return design;
  return files.filter((f) => isHdl(f) && f.role !== 'testbench' && f.role !== 'include');
}

export function requireSynthSources(files: SourceFile[]): SourceFile[] {
  const src = synthSources(files);
  if (!src.length) {
    throw new FlowError('没有可综合的设计文件', [
      { severity: 'error', tool: 'webeda', message: '没有找到设计（design）角色的 Verilog/SystemVerilog 文件；测试平台文件不参与综合。' },
    ]);
  }
  return src;
}

/** 扫描设计文件 + include 文件（include 中也可能有模块与实例化） */
export function scanDesign(files: SourceFile[], sources: SourceFile[]): ScanResult {
  const inc = files.filter((f) => f.role === 'include' && !sources.includes(f));
  return scanFiles([...sources, ...inc].map((f) => ({ name: f.name, content: f.content, role: f.role })));
}

/** 校验用户给的顶层名 */
export function checkTopName(top: string | undefined): string | undefined {
  const t = top?.trim();
  if (!t) return undefined;
  if (!IDENT_RE.test(t)) throw new FlowError(`顶层模块名不合法：${t}`, [{ severity: 'error', tool: 'webeda', message: `顶层模块名不合法：${t}` }]);
  return t;
}

/** 综合类 flow 的顶层：用户指定 → 扫描得到唯一候选 → 交给 Yosys -auto-top（返回 undefined） */
export function guessSynthTop(scan: ScanResult): string | undefined {
  const c = findTopCandidates(scan, false);
  return c.length === 1 ? c[0] : undefined;
}

/** Yosys 命令行中的文件名（含空格时加引号） */
export function yq(name: string): string {
  return /[\s;"#]/.test(name) ? `"${name}"` : name;
}

/** read_verilog 命令；-I. 让 `include 能找到工作目录根下的头文件 */
export function readVerilogCommands(sources: SourceFile[]): string[] {
  const dirs = new Set<string>(['.']);
  for (const f of sources) {
    const d = path.posix.dirname(f.name);
    if (d && d !== '.') dirs.add(d);
  }
  const inc = [...dirs].map((d) => `-I ${yq(d)}`).join(' ');
  return [`read_verilog -sv ${inc} ${sources.map((f) => yq(f.name)).join(' ')}`];
}

export function hierarchyCommand(top: string | undefined): string {
  return top ? `hierarchy -check -top ${top}` : 'hierarchy -check -auto-top';
}

export interface YosysRun {
  result: RunResult;
  diagnostics: Diagnostic[];
  ok: boolean;
}

export function throwIfCancelled(ctx: JobContext, r?: RunResult) {
  if (ctx.signal.aborted || r?.cancelled) throw new FlowError('已取消');
}

/** 日志单次回显上限：超出部分只保留在 yosys.log 产物中 */
const MAX_ECHO_BYTES = 1024 * 1024;

export function yosysLogName(ctx: JobContext): string {
  return ctx.files.some((f) => f.name.toLowerCase() === 'yosys.log') ? '_webeda_yosys.log' : 'yosys.log';
}

/**
 * 以 `-q -l yosys.log` 运行 Yosys，结束后把完整日志回显到任务日志，返回 (运行结果, 完整输出文本)。
 *
 * 为什么不直接把控制台输出实时转发：YoWASP 版 Yosys 在非安静模式下执行 ABC（synth / abc 等）时会抛出
 * WebAssembly.Exception 崩溃；-q 模式（只在控制台打印警告与错误）配合 -l 日志文件则一切正常，且日志文件不含 ANSI 颜色码。
 */
export async function execYosys(ctx: JobContext, args: string[], opts: { timeoutSec?: number } = {}): Promise<{ result: RunResult; text: string; log: string }> {
  const log = yosysLogName(ctx);
  await fs.rm(path.join(ctx.workDir, log), { force: true });
  const full = ['-q', '-l', log, ...args];
  ctx.log('info', `▶ yosys ${full.map((a) => (/[\s;]/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
  ctx.log('info', 'Yosys 运行中…（完整日志在结束后显示）\n');
  const result = await ctx.run('yosys', full, { timeoutSec: opts.timeoutSec, quiet: true });
  throwIfCancelled(ctx, result);
  let text = await fs.readFile(path.join(ctx.workDir, log), 'utf8').catch(() => '');
  if (text) {
    ctx.log('stdout', text.length > MAX_ECHO_BYTES ? `${text.slice(0, MAX_ECHO_BYTES)}\n…（日志过长，完整内容见产物 ${log}）\n` : text);
    await ctx.addArtifact(log, 'text', 'Yosys 完整日志').catch(() => undefined);
  }
  // 控制台输出（警告/错误、WASM 运行时错误）不一定都在日志文件里
  const consoleText = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
  if (consoleText && !text) ctx.log('stderr', consoleText + '\n');
  else if (consoleText) {
    const extra = consoleText.split(/\r?\n/).filter((l) => l.trim() && !text.includes(l.trim()));
    if (extra.length) ctx.log('stderr', extra.join('\n') + '\n');
  }
  text = `${text}\n${consoleText}`;
  return { result, text, log };
}

/** 运行一段 Yosys 脚本（-p，分号连接）；解析诊断，异常退出/超时时补一条错误 */
export async function runYosys(ctx: JobContext, commands: string[], opts: { timeoutSec?: number } = {}): Promise<YosysRun> {
  const { result, text } = await execYosys(ctx, ['-p', commands.join('; ')], opts);
  const mapper = new PathMapper(ctx.files, ctx.workDir);
  const diagnostics = parseYosysOutput(text, mapper);
  const ok = result.code === 0 && !result.timedOut;
  if (result.timedOut) {
    diagnostics.push({ severity: 'error', tool: 'yosys', message: `Yosys 运行超时，已中止。设计可能过大，请减小规模后重试。` });
  } else if (!ok && !diagnostics.some((d) => d.severity === 'error')) {
    diagnostics.push({ severity: 'error', tool: 'yosys', message: `Yosys 异常退出（代码 ${result.code ?? '未知'}），请查看日志` });
  }
  return { result, diagnostics, ok };
}

export async function fileExists(ctx: JobContext, name: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(ctx.workDir, name));
    return st.isFile();
  } catch {
    return false;
  }
}

export async function readJson<T>(ctx: JobContext, name: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(ctx.workDir, name), 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FlowError(`无法解析 ${name}（JSON 格式错误）`);
  }
}

export function readDesign(ctx: JobContext, name: string): Promise<YosysDesign | undefined> {
  return readJson<YosysDesign>(ctx, name).then((d) => (d && typeof d === 'object' && d.modules ? d : undefined));
}

/** 产物大小超限等问题不让整个任务失败：转成一条 warning */
export async function tryAddArtifact(
  ctx: JobContext,
  diagnostics: Diagnostic[],
  name: string,
  kind: Parameters<JobContext['addArtifact']>[1],
  label: string,
): Promise<boolean> {
  try {
    await ctx.addArtifact(name, kind, label);
    return true;
  } catch (e) {
    diagnostics.push({ severity: 'warning', tool: 'webeda', message: `产物 ${name} 未登记：${(e as Error).message}` });
    return false;
  }
}
