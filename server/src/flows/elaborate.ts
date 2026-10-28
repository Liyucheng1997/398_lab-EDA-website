/**
 * elaborate：Yosys 读入设计并做 RTL 级处理（hierarchy / proc / opt_clean），生成层次树与 netlistsvg 原理图。
 */
import type { Diagnostic, ElaborateOptions, ElaborateResult } from '@webeda/shared';
import type { Flow } from '../jobs/context';
import {
  checkTopName,
  guessSynthTop,
  hierarchyCommand,
  readDesign,
  readVerilogCommands,
  requireSynthSources,
  runYosys,
  scanDesign,
  tryAddArtifact,
} from './common';
import { finalizeDiagnostics } from './diagnostics';
import { buildHierarchy, moduleCellCount, moduleDisplayNames, modulesBfs, singleModuleNetlist } from './hierarchy';
import { renderSchematics, type SchematicJob } from './schematic';
import { findTopModule, safeFileStem } from './yosysJson';

/** 除顶层外最多再画多少个子模块 */
export const MAX_SUBMODULE_SCHEMATICS = 15;
/** 单个模块超过这么多单元就不画（netlistsvg 布局会非常慢） */
export const MAX_RTL_SCHEMATIC_CELLS = 1500;

export const elaborate: Flow<'elaborate'> = async (ctx, req) => {
  const opts: ElaborateOptions = req.options ?? {};
  const diagnostics: Diagnostic[] = [];
  const sources = requireSynthSources(ctx.files);
  const scan = scanDesign(ctx.files, sources);
  const userTop = checkTopName(opts.top);
  const top = userTop ?? guessSynthTop(scan);
  const flatten = opts.flatten === true;

  const cmds = [
    ...readVerilogCommands(sources),
    hierarchyCommand(top),
    // 输出悬空的子模块实例也要保留在 RTL 视图中（否则 opt_clean 会删掉它们）
    'setattr -set keep 1 c:* t:$* %d',
    'proc',
    'opt_clean',
  ];
  if (flatten) cmds.push('write_json rtl_hier.json', 'flatten', 'opt_clean');
  cmds.push('write_json rtl.json');

  ctx.stage('elaborate');
  const y = await runYosys(ctx, cmds);
  diagnostics.push(...y.diagnostics);
  const design = y.ok ? await readDesign(ctx, 'rtl.json') : undefined;
  if (!design) {
    if (y.ok) diagnostics.push({ severity: 'error', tool: 'webeda', message: 'Yosys 没有生成 rtl.json' });
    return {
      kind: 'elaborate',
      diagnostics: finalizeDiagnostics(diagnostics),
      artifacts: ctx.artifacts,
      durationMs: 0,
      top: top ?? '',
      hierarchy: { module: top ?? '', instance: top ?? '', children: [] },
      schematics: {},
    };
  }
  await tryAddArtifact(ctx, diagnostics, 'rtl.json', 'json', 'RTL 网表（Yosys JSON）');

  const hierDesign = (flatten ? await readDesign(ctx, 'rtl_hier.json') : undefined) ?? design;
  const rawTop = findTopModule(design, top) ?? '';
  const hierTop = findTopModule(hierDesign, rawTop) ?? rawTop;
  const names = moduleDisplayNames(hierDesign);
  const { root, truncated } = buildHierarchy(hierDesign, hierTop, names);
  if (truncated) diagnostics.push({ severity: 'info', tool: 'webeda', message: '模块层次过大，层次树只显示了部分实例' });
  const prettyTop = names.get(hierTop) ?? hierTop;

  // —— 要画的模块：顶层 + 用户关心的模块 + 广度优先的子模块
  const designNames = moduleDisplayNames(design);
  let order = flatten ? [rawTop] : modulesBfs(design, rawTop);
  const wanted = opts.module?.trim();
  if (wanted && !flatten) {
    const hit = order.find((m) => m === wanted || designNames.get(m) === wanted || designNames.get(m)?.startsWith(`${wanted}(`));
    if (hit) order = [rawTop, hit, ...order.filter((m) => m !== rawTop && m !== hit)];
    else diagnostics.push({ severity: 'info', tool: 'webeda', message: `设计中没有模块 ${wanted}，只生成顶层及子模块的原理图` });
  } else if (wanted && flatten && wanted !== designNames.get(rawTop)) {
    diagnostics.push({ severity: 'info', tool: 'webeda', message: '已展平层次，只生成顶层原理图' });
  }
  if (order.length > MAX_SUBMODULE_SCHEMATICS + 1) {
    diagnostics.push({
      severity: 'info',
      tool: 'webeda',
      message: `设计共有 ${order.length} 个模块，只生成顶层与前 ${MAX_SUBMODULE_SCHEMATICS} 个子模块的原理图`,
    });
    order = order.slice(0, MAX_SUBMODULE_SCHEMATICS + 1);
  }

  const jobs: (SchematicJob & { module: string })[] = [];
  const usedNames = new Set<string>();
  for (const raw of order) {
    const pretty = designNames.get(raw) ?? raw;
    const cells = moduleCellCount(design, raw);
    if (cells > MAX_RTL_SCHEMATIC_CELLS) {
      diagnostics.push({ severity: 'info', tool: 'webeda', message: `模块 ${pretty} 有 ${cells} 个单元（> ${MAX_RTL_SCHEMATIC_CELLS}），跳过原理图生成` });
      continue;
    }
    const mod = design.modules[raw];
    if (!cells && !Object.keys(mod?.ports ?? {}).length) continue;
    let stem = `schematic_${safeFileStem(pretty)}`;
    for (let i = 2; usedNames.has(stem.toLowerCase()); i++) stem = `schematic_${safeFileStem(pretty)}_${i}`;
    usedNames.add(stem.toLowerCase());
    jobs.push({
      module: pretty,
      label: pretty,
      netlist: singleModuleNetlist(design, raw),
      artifact: `${stem}.svg`,
      artifactLabel: `RTL 原理图：${pretty}`,
    });
  }
  ctx.stage('schematic');
  const rendered = await renderSchematics(ctx, jobs, diagnostics);
  const schematics: Record<string, string> = {};
  for (const j of jobs) {
    const a = rendered.get(j);
    if (a) schematics[j.module] = a;
  }

  return {
    kind: 'elaborate',
    diagnostics: finalizeDiagnostics(diagnostics),
    artifacts: ctx.artifacts,
    durationMs: 0,
    top: prettyTop,
    hierarchy: root,
    schematics,
  };
};
