/**
 * synthesize：Yosys 综合到目标器件族，产出资源利用率、综合后网表与（可选）原理图。
 */
import type { DeviceInfo, Diagnostic, SynthesizeOptions, SynthesizeResult, SynthTarget, UtilizationReport } from '@webeda/shared';
import { getDevice } from '@webeda/shared';
import { FlowError, type Flow } from '../jobs/context';
import {
  checkTopName,
  guessSynthTop,
  readDesign,
  readVerilogCommands,
  requireSynthSources,
  runYosys,
  scanDesign,
  tryAddArtifact,
} from './common';
import { finalizeDiagnostics } from './diagnostics';
import { singleModuleNetlist } from './hierarchy';
import { renderSchematics } from './schematic';
import { buildUtilization, resourceDevice } from './utilization';
import { countRealCells, findTopModule, prettyModuleName } from './yosysJson';

export const MAX_SYNTH_SCHEMATIC_CELLS = 3000;
const TARGETS: SynthTarget[] = ['generic', 'ice40', 'ecp5', 'xc7', 'gowin'];

const TARGET_NAMES: Record<SynthTarget, string> = {
  generic: '通用门级',
  ice40: 'Lattice iCE40',
  ecp5: 'Lattice ECP5',
  xc7: 'Xilinx 7 系列',
  gowin: 'Gowin',
};

/**
 * 综合命令。flatten 未指定时用各脚本的默认行为（generic/xc7 不展平，厂商脚本展平）。
 * @param json 直接让综合脚本写出 JSON（implement 用）
 */
export function synthCommand(target: SynthTarget, top: string | undefined, flatten: boolean | undefined, device?: DeviceInfo, json?: string): string {
  const parts: string[] = [];
  switch (target) {
    case 'generic':
      parts.push('synth');
      if (flatten === true) parts.push('-flatten');
      break;
    case 'ice40':
      parts.push('synth_ice40');
      if (flatten === false) parts.push('-noflatten');
      // UP5K 有 SB_MAC16：允许推断 DSP
      if (device && device.family === 'ice40' && (device.resources.DSP ?? 0) > 0) parts.push('-dsp');
      break;
    case 'ecp5':
      parts.push('synth_ecp5');
      if (flatten === false) parts.push('-noflatten');
      break;
    case 'xc7':
      parts.push('synth_xilinx', '-family', 'xc7');
      if (flatten === true) parts.push('-flatten');
      break;
    case 'gowin':
      parts.push('synth_gowin');
      if (flatten === false) parts.push('-noflatten');
      break;
  }
  if (top) parts.push('-top', top);
  if (json) parts.push('-json', json);
  return parts.join(' ');
}

export function emptyUtilization(target: SynthTarget, device?: DeviceInfo): UtilizationReport {
  const u: UtilizationReport = { target, rows: [], cells: {} };
  if (device) u.device = device.id;
  return u;
}

export const synthesize: Flow<'synthesize'> = async (ctx, req) => {
  const opts: Partial<SynthesizeOptions> = req.options ?? {};
  const target: SynthTarget = opts.target ?? 'generic';
  if (!TARGETS.includes(target)) throw new FlowError(`不支持的综合目标：${String(target)}`);
  const diagnostics: Diagnostic[] = [];

  if (opts.device && !getDevice(opts.device)) {
    diagnostics.push({ severity: 'warning', tool: 'webeda', message: `未知器件 ${opts.device}，资源总量按 ${TARGET_NAMES[target]} 默认器件计算` });
  }
  const { device, mismatch } = resourceDevice(target, opts.device);
  if (mismatch) {
    const d = getDevice(opts.device);
    diagnostics.push({
      severity: 'warning',
      tool: 'webeda',
      message:
        target === 'generic'
          ? `通用门级综合不对应具体器件，忽略器件 ${d?.name ?? opts.device}`
          : `器件 ${d?.name ?? opts.device} 不属于 ${TARGET_NAMES[target]}，资源总量按 ${device?.name ?? '未知器件'} 计算`,
    });
  }

  const sources = requireSynthSources(ctx.files);
  const scan = scanDesign(ctx.files, sources);
  const top = checkTopName(opts.top) ?? guessSynthTop(scan);

  const cmds = [...readVerilogCommands(sources)];
  if (!top) cmds.push('hierarchy -check -auto-top');
  cmds.push(synthCommand(target, top, opts.flatten, device), 'tee -q -o stat.txt stat', 'write_json synth.json');

  ctx.stage('synth');
  ctx.log('info', `综合目标：${TARGET_NAMES[target]}${device ? `（资源按 ${device.name} 计算）` : ''}\n`);
  const y = await runYosys(ctx, cmds);
  diagnostics.push(...y.diagnostics);
  const design = y.ok ? await readDesign(ctx, 'synth.json') : undefined;
  if (!design) {
    if (y.ok) diagnostics.push({ severity: 'error', tool: 'webeda', message: 'Yosys 没有生成 synth.json' });
    return {
      kind: 'synthesize',
      diagnostics: finalizeDiagnostics(diagnostics),
      artifacts: ctx.artifacts,
      durationMs: 0,
      top: top ?? '',
      utilization: emptyUtilization(target, device),
      netlist: '',
    };
  }
  await tryAddArtifact(ctx, diagnostics, 'synth.json', 'json', '综合后网表（Yosys JSON）');
  await tryAddArtifact(ctx, diagnostics, 'stat.txt', 'text', '资源统计（yosys stat）');

  const rawTop = findTopModule(design, top) ?? top ?? '';
  const utilization = buildUtilization(target, design, device, rawTop);

  let schematic: string | undefined;
  if (opts.schematic !== false && rawTop && design.modules[rawTop]) {
    const cells = countRealCells(design.modules[rawTop]);
    if (cells > MAX_SYNTH_SCHEMATIC_CELLS) {
      diagnostics.push({ severity: 'info', tool: 'webeda', message: `综合后有 ${cells} 个单元（> ${MAX_SYNTH_SCHEMATIC_CELLS}），跳过综合后原理图` });
    } else {
      ctx.stage('schematic');
      const job = { label: '综合后', netlist: singleModuleNetlist(design, rawTop), artifact: 'synth_schematic.svg', artifactLabel: '综合后原理图' };
      const done = await renderSchematics(ctx, [job], diagnostics);
      schematic = done.get(job);
    }
  }

  const result: SynthesizeResult = {
    kind: 'synthesize',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    top: prettyModuleName(rawTop),
    utilization,
    netlist: 'synth.json',
  };
  if (schematic) result.schematic = schematic;
  return result;
};
