/**
 * 内置示例与工程模板的端到端验证脚本。
 *
 *   npx tsx server/src/examples/verify.ts [--only id1,id2] [--jobs 4] [--skip-pnr] [--keep]
 *
 * 对每个示例：
 *   1. Icarus Verilog（iverilog -g2012 + vvp）编译并运行测试平台：
 *      编译无 warning / sorry / error，运行输出含 PASS、不含 FAIL / ERROR，并生成非空 dump.vcd；
 *   2. Yosys 读入设计文件并 elaborate（Playground 示例，保证 RTL 原理图可用）；
 * 对每个 Studio 模板另外：
 *   3. Yosys 按器件系列综合（synth_ice40 / synth_ecp5 / synth_xilinx / synth_gowin）；
 *   4. 虚拟开发板构建：chparam 覆盖 gatesimParams 后做通用综合；
 *   5. iCE40 / ECP5：nextpnr 布局布线（使用模板的约束文件）+ icepack / ecppack 生成比特流；
 * 对每块板卡：
 *   6. 由 generateConstraints(board) 生成完整约束，配合一个用到全部引脚的合成顶层，
 *      iCE40 / ECP5 板卡跑通 nextpnr（其余系列只做综合）。
 * 最后打印结果表，有任何失败则退出码为 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BoardInfo, DeviceFamily, DeviceInfo, Example, SourceFile } from '@webeda/shared';
import { BOARDS, generateConstraints, getBoard, getDevice } from '@webeda/shared';
import { runTool, type ToolName } from '../tools/exec';
import { EXAMPLES } from './index';
import { signalBase } from './load';

/* ───────────────────────── 命令行参数 ───────────────────────── */

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const ONLY = argValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const JOBS = Math.max(1, Number(argValue('--jobs') ?? Math.min(4, Math.max(1, os.cpus().length - 1))));
const SKIP_PNR = argv.includes('--skip-pnr');
const KEEP = argv.includes('--keep');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'webeda-verify-'));
const TOOL_TIMEOUT = 15 * 60 * 1000;

/* ───────────────────────── 结果记录 ───────────────────────── */

interface Row {
  subject: string;
  step: string;
  ok: boolean;
  detail: string;
  ms: number;
}
const rows: Row[] = [];

class CheckError extends Error {}

function fail(msg: string): never {
  throw new CheckError(msg);
}

/** 只保留最后若干行，便于在表格下方给出失败原因 */
function tail(text: string, n = 25): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(-n).join('\n');
}

let dirSeq = 0;
function workDir(label: string, files: SourceFile[]): string {
  const dir = path.join(ROOT, `${String(++dirSeq).padStart(3, '0')}-${label.replace(/[^\w.-]+/g, '_')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const p = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  return dir;
}

async function tool(name: ToolName, args: string[], cwd: string, stdin?: string) {
  const r = await runTool(name, args, { cwd, timeoutMs: TOOL_TIMEOUT, stdin });
  const out = r.stdout + r.stderr;
  if (r.timedOut) fail(`${name} 超时\n${tail(out)}`);
  return { code: r.code, out };
}

async function step(subject: string, stepName: string, fn: () => Promise<string>): Promise<boolean> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    rows.push({ subject, step: stepName, ok: true, detail, ms: Date.now() - t0 });
    process.stdout.write(`  ✓ ${subject} · ${stepName}  ${detail}\n`);
    return true;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    rows.push({ subject, step: stepName, ok: false, detail, ms: Date.now() - t0 });
    process.stdout.write(`  ✗ ${subject} · ${stepName}\n${detail.replace(/^/gm, '      ')}\n`);
    return false;
  }
}

/* ───────────────────────── 各项检查 ───────────────────────── */

const isHdl = (f: SourceFile) => /\.s?v$/i.test(f.name) && (f.role === 'design' || f.role === 'testbench');
const designFiles = (ex: Example) => ex.files.filter((f) => f.role === 'design' && /\.s?v$/i.test(f.name));

/** 1. Icarus 编译 + 运行 */
async function checkSimulation(ex: Example): Promise<string> {
  const dir = workDir(`${ex.id}-sim`, ex.files);
  const sources = ex.files.filter(isHdl).map((f) => f.name);
  const top = ex.simulate?.top ?? ex.project?.simTop ?? 'tb';
  const comp = await tool('iverilog', ['-g2012', '-I', '.', '-s', top, '-o', 'sim.vvp', ...sources], dir);
  if (comp.code !== 0) fail(`iverilog 编译失败（退出码 ${comp.code}）\n${tail(comp.out)}`);
  if (/warning|sorry|error/i.test(comp.out)) fail(`iverilog 编译有告警\n${tail(comp.out)}`);

  const run = await tool('vvp', ['-n', 'sim.vvp'], dir);
  if (run.code !== 0) fail(`vvp 退出码 ${run.code}\n${tail(run.out)}`);
  if (!/\bPASS\b/.test(run.out)) fail(`输出中没有 PASS\n${tail(run.out)}`);
  if (/\bFAIL\b|\bERROR\b|错误/.test(run.out)) fail(`输出中有 FAIL / ERROR\n${tail(run.out)}`);
  if (/\\[0-7]{3}/.test(run.out)) fail(`输出中有被转义的非 ASCII 字符串（Icarus 的 string 变量不支持中文）\n${tail(run.out)}`);
  const vcd = path.join(dir, 'dump.vcd');
  if (!fs.existsSync(vcd) || fs.statSync(vcd).size === 0) fail('没有生成 dump.vcd');
  const passLine = run.out.split(/\r?\n/).find((l) => /\bPASS\b/.test(l)) ?? '';
  return `${passLine.trim()}（VCD ${(fs.statSync(vcd).size / 1024).toFixed(1)} KB）`;
}

function yosysWarnings(out: string): string[] {
  return out
    .split(/\r?\n/)
    .filter((l) => /(^|\s)Warning:/.test(l))
    .map((l) => l.trim());
}

async function runYosys(dir: string, script: string): Promise<string> {
  fs.writeFileSync(path.join(dir, 'run.ys'), script);
  const r = await tool('yosys', ['-q', '-l', 'yosys.log', '-s', 'run.ys'], dir);
  const log = fs.existsSync(path.join(dir, 'yosys.log')) ? fs.readFileSync(path.join(dir, 'yosys.log'), 'utf8') : r.out;
  if (r.code !== 0 || /^ERROR:/m.test(log)) fail(`yosys 失败（退出码 ${r.code}）\n${tail(log + '\n' + r.out)}`);
  return log;
}

function readCmd(files: SourceFile[]): string {
  return `read_verilog -sv ${files.map((f) => f.name).join(' ')}`;
}

/** 2. Playground 设计的 RTL elaborate */
async function checkElaborate(ex: Example): Promise<string> {
  const dir = workDir(`${ex.id}-elab`, ex.files);
  const log = await runYosys(dir, [readCmd(designFiles(ex)), 'hierarchy -check -auto-top', 'proc', 'opt_clean', 'stat', ''].join('\n'));
  const top = /Top module:\s+\\?(\S+)/.exec(log)?.[1];
  const warns = yosysWarnings(log);
  if (warns.length) fail(`yosys 告警：\n${warns.join('\n')}`);
  return `顶层 ${top ?? '?'}`;
}

const SYNTH_CMD: Record<DeviceFamily, (top: string) => string> = {
  ice40: (top) => `synth_ice40 -top ${top} -json synth.json`,
  ecp5: (top) => `synth_ecp5 -top ${top} -json synth.json`,
  xc7: (top) => `synth_xilinx -flatten -top ${top} -family xc7`,
  gowin: (top) => `synth_gowin -top ${top} -json synth.json`,
};

function cellCount(log: string): string {
  const m = [...log.matchAll(/Number of cells:\s+(\d+)/g)].pop() ?? [...log.matchAll(/^\s+(\d+)\s+cells$/gm)].pop();
  return m ? `${m[1]} 个单元` : '';
}

/** 3. 器件系列综合；返回工作目录（P&R 复用 synth.json） */
async function checkSynth(ex: Example, dev: DeviceInfo, top: string): Promise<{ detail: string; dir: string }> {
  const dir = workDir(`${ex.id}-synth`, ex.files);
  const log = await runYosys(dir, [readCmd(designFiles(ex)), SYNTH_CMD[dev.family](top), 'stat', ''].join('\n'));
  const warns = yosysWarnings(log);
  if (warns.length) fail(`yosys 告警：\n${warns.join('\n')}`);
  if (dev.family !== 'xc7' && !fs.existsSync(path.join(dir, 'synth.json'))) fail('没有生成 synth.json');
  return { detail: `${dev.family} ${cellCount(log)}`.trim(), dir };
}

/** 4. 虚拟开发板构建：chparam + 通用综合 */
async function checkGatesim(ex: Example, top: string, params: Record<string, number>): Promise<string> {
  const dir = workDir(`${ex.id}-gatesim`, ex.files);
  const entries = Object.entries(params);
  const chparam = entries.length ? `chparam ${entries.map(([k, v]) => `-set ${k} ${v}`).join(' ')} ${top}` : '';
  const log = await runYosys(
    dir,
    [readCmd(designFiles(ex)), chparam, `synth -flatten -top ${top}`, 'stat', ''].filter(Boolean).join('\n'),
  );
  const warns = yosysWarnings(log);
  if (warns.length) fail(`yosys 告警：\n${warns.join('\n')}`);
  return `${entries.map(([k, v]) => `${k}=${v}`).join(' ')} → ${cellCount(log)}`;
}

/** 5 / 6. nextpnr + 打包 */
async function placeAndRoute(
  dir: string,
  dev: DeviceInfo,
  constraintFile: string,
  freqMHz: number,
  extra: string[] = [],
): Promise<string> {
  let r;
  if (dev.family === 'ice40') {
    r = await tool('nextpnr-ice40', [...dev.nextpnrArgs, '--json', 'synth.json', '--pcf', constraintFile, '--asc', 'out.asc', '--freq', String(freqMHz), ...extra], dir);
  } else if (dev.family === 'ecp5') {
    r = await tool('nextpnr-ecp5', [...dev.nextpnrArgs, '--json', 'synth.json', '--lpf', constraintFile, '--textcfg', 'out.config', '--freq', String(freqMHz), ...extra], dir);
  } else {
    fail(`${dev.family} 不支持布局布线`);
  }
  if (r.code !== 0) fail(`nextpnr 失败（退出码 ${r.code}）\n${tail(r.out)}`);
  if (/^(ERROR|Error):/m.test(r.out)) fail(`nextpnr 报错\n${tail(r.out)}`);
  const unmatched = r.out.split(/\r?\n/).filter((l) => /unmatched|not found|unconstrained/i.test(l));
  if (unmatched.length) fail(`约束与端口不匹配：\n${unmatched.join('\n')}`);

  const fmaxes = [...r.out.matchAll(/Max frequency for clock\s+'([^']+)':\s+([\d.]+) MHz \((PASS|FAIL)/g)];
  const last = fmaxes.at(-1);
  if (!extra.includes('--timing-allow-fail') && last && last[3] !== 'PASS') fail(`时序未满足：Fmax ${last[2]} MHz < ${freqMHz} MHz`);

  let packed: string;
  if (dev.family === 'ice40') {
    const p = await tool('icepack', ['out.asc', 'out.bin'], dir);
    if (p.code !== 0) fail(`icepack 失败\n${tail(p.out)}`);
    packed = 'out.bin';
  } else {
    const p = await tool('ecppack', [...(dev.packArgs ?? []), 'out.config', 'out.bit'], dir);
    if (p.code !== 0) fail(`ecppack 失败\n${tail(p.out)}`);
    packed = 'out.bit';
  }
  const size = fs.existsSync(path.join(dir, packed)) ? fs.statSync(path.join(dir, packed)).size : 0;
  if (!size) fail(`没有生成比特流 ${packed}`);
  return `${last ? `Fmax ${last[2]} MHz` : ''} · ${packed} ${(size / 1024).toFixed(0)} KB`;
}

/* ───────────────────────── 板卡约束：合成一个用到所有引脚的顶层 ───────────────────────── */

const INPUT_PERIPHERALS = new Set(['clock', 'button', 'switch', 'uart_rx']);

export function boardTestTop(board: BoardInfo): string {
  const ports = new Map<string, { width: number | null; input: boolean }>();
  for (const p of board.pins) {
    const base = signalBase(p.signal);
    const idx = /\[(\d+)\]$/.exec(p.signal);
    const cur = ports.get(base) ?? { width: null, input: INPUT_PERIPHERALS.has(p.peripheral) };
    if (idx) cur.width = Math.max(cur.width ?? 0, Number(idx[1]) + 1);
    ports.set(base, cur);
  }
  const clk = board.clock.signal;
  const decl: string[] = [];
  const inputs: string[] = [];
  const assigns: string[] = [];
  let bit = 0;
  for (const [name, { width, input }] of ports) {
    const range = width ? `[${width - 1}:0] ` : '';
    decl.push(`  ${input ? 'input ' : 'output'} wire ${range}${name}`);
    if (input && name !== clk) inputs.push(name);
    if (!input) {
      const w = width ?? 1;
      const bits = Array.from({ length: w }, () => `r[${bit++ % 32}]`).reverse();
      assigns.push(`  assign ${name} = {${bits.join(', ')}};`);
    }
  }
  const mix = inputs.length ? `^{${inputs.join(', ')}}` : `1'b0`;
  return [
    '// 自动生成：用到板卡全部引脚的测试顶层',
    'module board_test (',
    decl.join(',\n'),
    ');',
    '  reg [31:0] r = 32\'h1;',
    `  always @(posedge ${clk}) r <= {r[30:0], r[31] ^ r[21] ^ r[1] ^ r[0] ^ ${mix}};`,
    ...assigns,
    'endmodule',
    '',
  ].join('\n');
}

async function checkBoard(board: BoardInfo): Promise<void> {
  const dev = getDevice(board.device);
  const subject = `板卡 ${board.id}`;
  if (!dev) {
    await step(subject, '器件', async () => fail(`器件 ${board.device} 不存在`));
    return;
  }
  const constraintName = `board${dev.constraintExt}`;
  const files: SourceFile[] = [
    { name: 'board_test.v', content: boardTestTop(board), role: 'design' },
    { name: constraintName, content: generateConstraints(board), role: 'constraint' },
  ];
  // 引脚表自身的一致性
  const okTable = await step(subject, '引脚表', async () => {
    const seenPin = new Map<string, string>();
    const seenSig = new Set<string>();
    for (const p of board.pins) {
      if (seenSig.has(p.signal)) fail(`信号 ${p.signal} 重复`);
      seenSig.add(p.signal);
      if (seenPin.has(p.pin)) fail(`引脚 ${p.pin} 同时分配给 ${seenPin.get(p.pin)} 和 ${p.signal}`);
      seenPin.set(p.pin, p.signal);
    }
    const clk = board.pins.find((p) => p.signal === board.clock.signal);
    if (!clk || clk.pin !== board.clock.pin || clk.peripheral !== 'clock') fail('clock 字段与引脚表不一致');
    const count = (pred: (p: BoardInfo['pins'][number]) => boolean) => board.pins.filter(pred).length;
    const v = board.virtual;
    const leds = count((p) => p.peripheral === 'led');
    const sws = count((p) => p.peripheral === 'switch');
    const btns = count((p) => p.peripheral === 'button');
    const digits = count((p) => p.peripheral === 'digit');
    if (v.leds !== leds || v.switches !== sws || v.buttons !== btns || v.sevenSegDigits !== digits) {
      fail(`virtual 计数不符：LED ${v.leds}/${leds}，开关 ${v.switches}/${sws}，按键 ${v.buttons}/${btns}，数码管 ${v.sevenSegDigits}/${digits}`);
    }
    return `${board.pins.length} 个引脚，LED ${leds} / 开关 ${sws} / 按键 ${btns} / 数码管 ${digits}`;
  });
  if (!okTable) return;

  const fake: Example = { id: `board-${board.id}`, title: '', description: '', category: 'board', scope: 'studio', files };
  let synthDir = '';
  const okSynth = await step(subject, '综合（全部引脚）', async () => {
    const r = await checkSynth(fake, dev, 'board_test');
    synthDir = r.dir;
    return r.detail;
  });
  if (!okSynth) return;
  if (!dev.pnr) {
    rows.push({ subject, step: '约束 + P&R', ok: true, detail: `${dev.family} 仅综合（开源工具链不支持布局布线）`, ms: 0 });
    return;
  }
  if (SKIP_PNR) return;
  await step(subject, `约束 + P&R（${constraintName}）`, () =>
    placeAndRoute(synthDir, dev, constraintName, board.clock.freqMHz, ['--timing-allow-fail']),
  );
}

/* ───────────────────────── 每个示例 ───────────────────────── */

async function checkExample(ex: Example): Promise<void> {
  const subject = `${ex.scope === 'studio' ? '模板' : '示例'} ${ex.id}`;
  await step(subject, 'Icarus 仿真', () => checkSimulation(ex));

  if (ex.scope !== 'studio') {
    await step(subject, 'Yosys elaborate', () => checkElaborate(ex));
    return;
  }

  const settings = ex.project;
  if (!settings) {
    await step(subject, '工程设置', async () => fail('缺少 project 设置'));
    return;
  }
  const dev = getDevice(settings.device);
  const board = getBoard(settings.board);
  const top = settings.top;
  if (!dev || !board || !top) {
    await step(subject, '工程设置', async () => fail(`器件 ${settings.device}、板卡 ${settings.board} 或顶层 ${top} 无效`));
    return;
  }

  let synthDir = '';
  const okSynth = await step(subject, `综合 ${dev.name}`, async () => {
    const r = await checkSynth(ex, dev, top);
    synthDir = r.dir;
    return r.detail;
  });
  await step(subject, '虚拟开发板构建', () => checkGatesim(ex, top, settings.gatesimParams ?? {}));

  if (!okSynth) return;
  if (!dev.pnr) {
    rows.push({ subject, step: 'P&R + 比特流', ok: true, detail: `${dev.family} 仅综合`, ms: 0 });
    return;
  }
  if (SKIP_PNR) return;
  const cf = settings.constraintFile;
  await step(subject, `P&R + 比特流（${cf}）`, async () => {
    if (!cf || !ex.files.some((f) => f.name === cf)) fail(`约束文件 ${cf} 不在文件列表中`);
    return placeAndRoute(synthDir, dev, cf, settings.freqMHz);
  });
}

/* ───────────────────────── 调度 ───────────────────────── */

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    }),
  );
}

function pad(s: string, w: number): string {
  // 中文字符按 2 列宽计算
  const width = [...s].reduce((acc, ch) => acc + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, w - width));
}

async function main() {
  const t0 = Date.now();
  const examples = EXAMPLES.filter((e) => !ONLY || ONLY.includes(e.id));
  const boards = BOARDS.filter((b) => !ONLY || ONLY.includes(b.id) || ONLY.includes(`board-${b.id}`));
  console.log(`WebEDA 示例验证：${examples.length} 个示例/模板，${boards.length} 块板卡，并发 ${JOBS}，工作目录 ${ROOT}\n`);

  type Task = { kind: 'example'; ex: Example } | { kind: 'board'; board: BoardInfo };
  const tasks: Task[] = [
    ...examples.map((ex) => ({ kind: 'example' as const, ex })),
    ...boards.map((board) => ({ kind: 'board' as const, board })),
  ];
  await pool(tasks, JOBS, (t) => (t.kind === 'example' ? checkExample(t.ex) : checkBoard(t.board)));

  // 结果表（按原始顺序）
  const order = new Map<string, number>();
  [...examples.map((e) => `${e.scope === 'studio' ? '模板' : '示例'} ${e.id}`), ...boards.map((b) => `板卡 ${b.id}`)].forEach((s, i) =>
    order.set(s, i),
  );
  const sorted = [...rows].sort((a, b) => (order.get(a.subject) ?? 0) - (order.get(b.subject) ?? 0));
  const w1 = Math.max(...sorted.map((r) => pad(r.subject, 0).length + 4), 10);
  console.log('\n' + '─'.repeat(110));
  console.log(`${pad('对象', w1)}${pad('步骤', 34)}结果  耗时    说明`);
  console.log('─'.repeat(110));
  for (const r of sorted) {
    const detail = r.ok ? r.detail : r.detail.split('\n')[0];
    console.log(`${pad(r.subject, w1)}${pad(r.step, 34)}${r.ok ? 'PASS' : 'FAIL'}  ${pad(`${(r.ms / 1000).toFixed(1)}s`, 8)}${detail}`);
  }
  console.log('─'.repeat(110));
  const failed = rows.filter((r) => !r.ok);
  console.log(`共 ${rows.length} 项检查，通过 ${rows.length - failed.length}，失败 ${failed.length}，用时 ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  if (failed.length || KEEP) console.log(`工作目录保留在 ${ROOT}`);
  else fs.rmSync(ROOT, { recursive: true, force: true });
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
