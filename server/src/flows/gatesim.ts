/**
 * gatesim：Yosys 综合到通用 1 位门级网表（展平、存储器拆成触发器），转换为 GateNetlist 供浏览器虚拟开发板仿真。
 */
import type { Diagnostic, GatesimOptions, GatesimResult } from '@webeda/shared';
import { FlowError, type Flow } from '../jobs/context';
import {
  IDENT_RE,
  checkTopName,
  guessSynthTop,
  hierarchyCommand,
  readDesign,
  readVerilogCommands,
  requireSynthSources,
  runYosys,
  scanDesign,
} from './common';
import { finalizeDiagnostics } from './diagnostics';
import { convertGateNetlist } from './gateNetlist';
import { moduleParams } from './verilogScan';

/** 允许保留到网表中的触发器/锁存器类型（与 GateNetlist 的 DFF/LATCH 语义一一对应） */
export const DFF_LEGALIZE =
  'dfflegalize -cell $_DFF_?_ 01 -cell $_DFFE_??_ 01 -cell $_DFF_???_ 01 -cell $_DFFE_????_ 01 ' +
  '-cell $_SDFF_???_ 01 -cell $_SDFFE_????_ 01 -cell $_DLATCH_?_ 01';

export const GATE_SET = 'AND,NAND,OR,NOR,XOR,XNOR,ANDNOT,ORNOT,MUX';

/** 校验并整理参数覆盖；无法应用的参数给出 warning */
export function acceptParams(
  params: Record<string, unknown> | undefined,
  top: string | undefined,
  known: string[] | undefined,
  diagnostics: Diagnostic[],
): [string, number][] {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return [];
  const warn = (message: string) => diagnostics.push({ severity: 'warning', tool: 'webeda', message });
  if (!top) {
    warn('无法确定顶层模块，参数覆盖未生效；请在工程设置中指定顶层');
    return [];
  }
  const out: [string, number][] = [];
  for (const [k, v] of entries) {
    if (!IDENT_RE.test(k)) {
      warn(`参数名不合法：${k}，已忽略`);
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 2 ** 31 - 1) {
      warn(`参数 ${k} 的值必须是 0 ~ 2147483647 之间的整数（当前为 ${String(v)}），已忽略`);
    } else if (known && !known.includes(k)) {
      warn(`顶层模块 ${top} 没有参数 ${k}，已忽略`);
    } else {
      out.push([k, v]);
    }
  }
  return out;
}

export const gatesim: Flow<'gatesim'> = async (ctx, req) => {
  const opts: GatesimOptions = req.options ?? {};
  const diagnostics: Diagnostic[] = [];
  const sources = requireSynthSources(ctx.files);
  const scan = scanDesign(ctx.files, sources);
  const top = checkTopName(opts.top) ?? guessSynthTop(scan);
  const params = acceptParams(opts.params, top, top ? moduleParams(scan, top) : undefined, diagnostics);

  const cmds = [...readVerilogCommands(sources)];
  if (params.length && top) {
    cmds.push(`chparam ${params.map(([k, v]) => `-set ${k} ${v}`).join(' ')} ${top}`);
    ctx.log('info', `参数覆盖：${params.map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
  }
  cmds.push(
    hierarchyCommand(top),
    'proc',
    'flatten',
    // 仿真用的系统任务 / 断言单元在门级网表里没有意义
    'delete t:$print t:$check t:$assert t:$assume t:$cover t:$live t:$fair t:$scopeinfo',
    'opt',
    'memory -nomap',
    'memory_map',
    'opt',
    'techmap',
    'opt',
    DFF_LEGALIZE,
    `abc -g ${GATE_SET}`,
    'opt',
    'setundef -zero',
    'opt_clean',
    'write_json gate.json',
  );

  ctx.stage('synth');
  const y = await runYosys(ctx, cmds);
  diagnostics.push(...y.diagnostics);
  const design = y.ok ? await readDesign(ctx, 'gate.json') : undefined;
  if (!design) {
    if (y.ok) diagnostics.push({ severity: 'error', tool: 'webeda', message: 'Yosys 没有生成 gate.json' });
    if (diagnostics.some((d) => /cannot be legalized/.test(d.message))) {
      diagnostics.push({
        severity: 'info',
        tool: 'webeda',
        message: '虚拟开发板支持：上升/下降沿触发器（可带使能、异步复位或置位、同步复位）与锁存器；不支持同时带异步置位和异步复位、或异步加载的触发器。',
      });
    }
    return { kind: 'gatesim', diagnostics: finalizeDiagnostics(diagnostics), artifacts: ctx.artifacts, durationMs: 0, top: top ?? '', netlist: '' };
  }

  ctx.stage('convert');
  let netlist;
  try {
    netlist = convertGateNetlist(design, top);
  } catch (e) {
    if (e instanceof FlowError) {
      throw new FlowError(e.message, finalizeDiagnostics([...diagnostics, ...e.diagnostics, { severity: 'error', tool: 'webeda', message: e.message }]));
    }
    throw e;
  }
  if (netlist.combinationalLoop) {
    diagnostics.push({ severity: 'warning', tool: 'webeda', message: '设计中存在组合逻辑环路，虚拟开发板上的行为可能不稳定' });
  }
  ctx.log(
    'info',
    `门级网表：${netlist.stats.gates} 个门，${netlist.stats.flipflops} 个触发器，${netlist.stats.latches} 个锁存器，${netlist.netCount} 个线网\n`,
  );
  if (netlist.stats.latches) {
    diagnostics.push({ severity: 'info', tool: 'webeda', message: `设计推断出 ${netlist.stats.latches} 个锁存器（latch），请确认这是预期行为` });
  }
  await ctx.writeArtifact('gatesim.json', JSON.stringify(netlist), 'json', '门级网表（虚拟开发板）');

  const result: GatesimResult = {
    kind: 'gatesim',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    top: netlist.top,
    netlist: 'gatesim.json',
  };
  return result;
};
