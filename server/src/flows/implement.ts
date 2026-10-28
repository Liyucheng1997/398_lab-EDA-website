/**
 * implement：综合（synth_ice40 / synth_ecp5）→ nextpnr 布局布线 → icepack / ecppack 比特流。
 */
import type { Diagnostic, ImplementOptions, ImplementResult, TimingReport } from '@webeda/shared';
import { getDevice } from '@webeda/shared';
import { FlowError, type Flow } from '../jobs/context';
import {
  checkTopName,
  fileExists,
  guessSynthTop,
  readDesign,
  readJson,
  readVerilogCommands,
  requireSynthSources,
  runYosys,
  scanDesign,
  throwIfCancelled,
  tryAddArtifact,
} from './common';
import { PathMapper, finalizeDiagnostics, parseNextpnrOutput, parsePackerOutput } from './diagnostics';
import { parsePlacement } from './placement';
import { emptyUtilization, synthCommand } from './synthesize';
import { parseTimingReport, type NextpnrReport } from './timing';
import { buildUtilization, mergePnrUtilization } from './utilization';
import { findTopModule, prettyModuleName } from './yosysJson';

const DEFAULT_FREQ_MHZ = 12;

export const implement: Flow<'implement'> = async (ctx, req) => {
  const opts: Partial<ImplementOptions> = req.options ?? {};
  const device = getDevice(opts.device);
  if (!device) throw new FlowError(`未知器件：${opts.device ?? '（未指定）'}`);
  if (!device.pnr || (device.family !== 'ice40' && device.family !== 'ecp5')) {
    throw new FlowError(
      `${device.name} 暂不支持布局布线：开源工具链 nextpnr 目前只支持 Lattice iCE40 与 ECP5。Xilinx 7 系列与 Gowin 器件在这里只能做综合与资源估算，请改用“综合”。`,
    );
  }
  const family = device.family;
  const freq = opts.freqMHz ?? DEFAULT_FREQ_MHZ;
  if (typeof freq !== 'number' || !Number.isFinite(freq) || freq <= 0 || freq > 1000) {
    throw new FlowError(`目标时钟频率不合法：${String(opts.freqMHz)}（应在 0~1000 MHz 之间）`);
  }
  if (opts.seed !== undefined && (!Number.isInteger(opts.seed) || opts.seed < 0 || opts.seed > 2 ** 31 - 1)) {
    throw new FlowError(`随机种子必须是非负整数：${String(opts.seed)}`);
  }

  const diagnostics: Diagnostic[] = [];
  const mapper = new PathMapper(ctx.files, ctx.workDir);
  const ext = device.constraintExt; // '.pcf' | '.lpf'
  const flag = ext.slice(1);

  // —— 约束文件
  let constraint: string | undefined;
  if (opts.constraintFile) {
    const f = ctx.files.find((x) => x.name === opts.constraintFile);
    if (!f) throw new FlowError(`约束文件 ${opts.constraintFile} 不在工程文件中`);
    if (!f.name.toLowerCase().endsWith(ext)) {
      throw new FlowError(`${device.name} 需要 ${ext} 格式的约束文件，${f.name} 不匹配`);
    }
    constraint = f.name;
  } else {
    const cands = ctx.files.filter((f) => f.role === 'constraint' && f.name.toLowerCase().endsWith(ext));
    if (cands.length === 1) {
      constraint = cands[0].name;
      diagnostics.push({ severity: 'info', tool: 'webeda', message: `未指定约束文件，自动使用 ${constraint}` });
    } else {
      diagnostics.push({
        severity: 'info',
        tool: 'webeda',
        message: cands.length
          ? `有多个 ${ext} 约束文件，未指定使用哪一个：引脚将由 nextpnr 自动分配`
          : `没有 ${ext} 约束文件：引脚将由 nextpnr 自动分配，生成的比特流无法直接用于实际板卡`,
      });
    }
  }

  const stages: ImplementResult['stages'] = [];
  const emptyTiming: TimingReport = { clocks: [], criticalPaths: [] };
  const sources = requireSynthSources(ctx.files);
  const scan = scanDesign(ctx.files, sources);
  const top = checkTopName(opts.top) ?? guessSynthTop(scan);
  let utilization = emptyUtilization(family, device);
  let resultTop = top ?? '';

  const finish = (extra: Partial<ImplementResult> = {}): ImplementResult => ({
    kind: 'implement',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    top: resultTop,
    device: device.id,
    utilization,
    timing: emptyTiming,
    stages,
    ...extra,
  });

  // —— 1. 综合
  ctx.stage('synth');
  let t0 = Date.now();
  const cmds = [...readVerilogCommands(sources)];
  if (!top) cmds.push('hierarchy -check -auto-top');
  cmds.push(synthCommand(family, top, undefined, device, 'synth.json'), 'tee -q -o stat.txt stat');
  const y = await runYosys(ctx, cmds);
  diagnostics.push(...y.diagnostics);
  const design = y.ok ? await readDesign(ctx, 'synth.json') : undefined;
  stages.push({ name: 'synth', durationMs: Date.now() - t0, ok: !!design });
  if (!design) {
    if (y.ok) diagnostics.push({ severity: 'error', tool: 'webeda', message: 'Yosys 没有生成 synth.json' });
    return finish();
  }
  const rawTop = findTopModule(design, top) ?? top ?? '';
  resultTop = prettyModuleName(rawTop);
  utilization = buildUtilization(family, design, device, rawTop);
  await tryAddArtifact(ctx, diagnostics, 'synth.json', 'json', '综合后网表（Yosys JSON）');
  await tryAddArtifact(ctx, diagnostics, 'stat.txt', 'text', '资源统计（yosys stat）');

  // —— 2. 布局布线
  ctx.stage('pnr');
  t0 = Date.now();
  const out = family === 'ice40' ? 'out.asc' : 'out.config';
  const args = [
    ...device.nextpnrArgs,
    '--json',
    'synth.json',
    ...(constraint ? [`--${flag}`, constraint] : []),
    `--${flag}-allow-unconstrained`,
    '--freq',
    String(freq),
    '--timing-allow-fail',
    '--report',
    'report.json',
    '--write',
    'routed.json',
    family === 'ice40' ? '--asc' : '--textcfg',
    out,
  ];
  if (opts.seed !== undefined) args.push('--seed', String(opts.seed));
  const pnr = await ctx.run(family === 'ice40' ? 'nextpnr-ice40' : 'nextpnr-ecp5', args);
  throwIfCancelled(ctx, pnr);
  diagnostics.push(...parseNextpnrOutput(pnr.stdout + '\n' + pnr.stderr, mapper));
  const routed = pnr.code === 0 && !pnr.timedOut ? await readDesign(ctx, 'routed.json') : undefined;
  const pnrOk = !!routed && (await fileExists(ctx, out));
  stages.push({ name: 'pnr', durationMs: Date.now() - t0, ok: pnrOk });
  if (!pnrOk) {
    if (pnr.timedOut) diagnostics.push({ severity: 'error', tool: 'nextpnr', message: 'nextpnr 运行超时，已中止' });
    else if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', tool: 'nextpnr', message: `nextpnr 布局布线失败（退出码 ${pnr.code ?? '未知'}），请查看日志` });
    }
    return finish();
  }

  const report = await readJson<NextpnrReport>(ctx, 'report.json');
  const timing = parseTimingReport(report, freq);
  utilization = { ...utilization, rows: mergePnrUtilization(utilization.rows, family, report?.utilization) };
  for (const c of timing.clocks) {
    if (!c.passed) {
      diagnostics.push({
        severity: 'warning',
        tool: 'nextpnr',
        message: `时序未满足：${c.clock} 达到 ${c.achievedMHz} MHz < 约束 ${c.constraintMHz} MHz（WNS ${c.slackNs} ns）`,
      });
    }
  }
  if (report) await tryAddArtifact(ctx, diagnostics, 'report.json', 'json', '时序与资源报告（nextpnr）');
  await tryAddArtifact(ctx, diagnostics, 'routed.json', 'json', '布线后网表（nextpnr）');
  await tryAddArtifact(ctx, diagnostics, out, 'text', family === 'ice40' ? 'IceStorm ASCII 配置（.asc）' : 'Trellis 文本配置（.config）');

  let placement: string | undefined;
  try {
    const info = parsePlacement(routed!, device.id, family);
    await ctx.writeArtifact('placement.json', JSON.stringify(info), 'json', '布局信息（器件视图）');
    placement = 'placement.json';
  } catch (e) {
    diagnostics.push({ severity: 'warning', tool: 'webeda', message: `布局信息生成失败：${(e as Error).message}` });
  }

  // —— 3. 比特流
  let bitstream: string | undefined;
  if (opts.bitstream !== false) {
    ctx.stage('bitstream');
    t0 = Date.now();
    const tool = family === 'ice40' ? 'icepack' : 'ecppack';
    const bit = family === 'ice40' ? 'out.bin' : 'out.bit';
    const packArgs = family === 'ice40' ? [out, bit] : [...(device.packArgs ?? []), out, bit];
    const pk = await ctx.run(tool, packArgs);
    throwIfCancelled(ctx, pk);
    const packDiags = parsePackerOutput(tool, pk.stdout + '\n' + pk.stderr);
    diagnostics.push(...packDiags);
    const ok = pk.code === 0 && !pk.timedOut && (await fileExists(ctx, bit));
    if (ok) {
      if (await tryAddArtifact(ctx, diagnostics, bit, 'bitstream', `比特流（${device.partNumber}）`)) bitstream = bit;
    } else if (!packDiags.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', tool, message: pk.timedOut ? `${tool} 超时` : `${tool} 生成比特流失败（退出码 ${pk.code ?? '未知'}）` });
    }
    stages.push({ name: 'bitstream', durationMs: Date.now() - t0, ok: !!bitstream });
  }

  const result = finish({ timing });
  if (placement) result.placement = placement;
  if (bitstream) result.bitstream = bitstream;
  return result;
};
