/**
 * Yosys JSON → 模块层次树；以及为 netlistsvg 准备单模块网表。
 */
import type { HierarchyNode } from '@webeda/shared';
import { designModules, isRealCell, prettyModuleName, type YosysDesign } from './yosysJson';

/** 层次树节点数上限（超过后截断，避免巨大的生成阵列撑爆前端） */
export const MAX_HIERARCHY_NODES = 2000;

/** Yosys 原始模块名 → 唯一的可读名 */
export function moduleDisplayNames(design: YosysDesign): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const raw of Object.keys(design.modules)) {
    let pretty = prettyModuleName(raw);
    if (taken.has(pretty)) pretty = raw;
    taken.add(pretty);
    map.set(raw, pretty);
  }
  return map;
}

/** 实例名可读化：Yosys 把用户实例名存成 "u0"，自动生成的以 '$' 开头 */
function prettyInstance(name: string): string {
  return name.startsWith('\\') ? name.slice(1) : name;
}

export function buildHierarchy(design: YosysDesign, top: string, names = moduleDisplayNames(design)): { root: HierarchyNode; truncated: boolean } {
  const userMods = new Set(designModules(design));
  let count = 0;
  let truncated = false;
  const build = (mod: string, instance: string, path: Set<string>): HierarchyNode => {
    count++;
    const node: HierarchyNode = { module: names.get(mod) ?? mod, instance, children: [] };
    if (path.has(mod)) return node;
    const next = new Set(path).add(mod);
    const cells = Object.entries(design.modules[mod]?.cells ?? {})
      .filter(([, c]) => userMods.has(c.type))
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
    for (const [inst, c] of cells) {
      if (count >= MAX_HIERARCHY_NODES) {
        truncated = true;
        break;
      }
      node.children.push(build(c.type, prettyInstance(inst), next));
    }
    return node;
  };
  const root = build(top, names.get(top) ?? top, new Set());
  return { root, truncated };
}

/** 从顶层出发的广度优先模块列表（原始名，去重） */
export function modulesBfs(design: YosysDesign, top: string): string[] {
  const userMods = new Set(designModules(design));
  const out: string[] = [];
  const seen = new Set<string>([top]);
  const queue = [top];
  while (queue.length) {
    const m = queue.shift()!;
    out.push(m);
    for (const c of Object.values(design.modules[m]?.cells ?? {})) {
      if (userMods.has(c.type) && !seen.has(c.type)) {
        seen.add(c.type);
        queue.push(c.type);
      }
    }
  }
  return out;
}

const TOP_ATTR = '00000000000000000000000000000001';

/** 只含一个模块（标为 top）的网表，供 netlistsvg 渲染；去掉 $scopeinfo 这类无端口的元数据单元 */
export function singleModuleNetlist(design: YosysDesign, module: string): YosysDesign {
  const mod = design.modules[module];
  const cells: NonNullable<typeof mod.cells> = {};
  for (const [name, c] of Object.entries(mod.cells ?? {})) {
    if (!isRealCell(c) || !c.connections || !Object.keys(c.connections).length) continue;
    const cell = { ...c };
    // netlistsvg 需要 port_directions；缺失时按常见输出端口名推断
    if (!cell.port_directions) {
      const dirs: Record<string, 'input' | 'output'> = {};
      for (const p of Object.keys(c.connections)) dirs[p] = /^(Y|Q|QN|O|OUT|CO|COUT|DO\w*|Z)$/i.test(p) ? 'output' : 'input';
      cell.port_directions = dirs;
    }
    cells[name] = cell;
  }
  const netnames: NonNullable<typeof mod.netnames> = {};
  for (const [name, n] of Object.entries(mod.netnames ?? {})) netnames[name] = { hide_name: n.hide_name, bits: n.bits, attributes: {} };
  return {
    modules: {
      [module]: {
        attributes: { ...(mod.attributes ?? {}), top: TOP_ATTR },
        ports: mod.ports ?? {},
        cells,
        netnames,
      },
    },
  };
}

export function moduleCellCount(design: YosysDesign, module: string): number {
  let n = 0;
  for (const c of Object.values(design.modules[module]?.cells ?? {})) if (isRealCell(c)) n++;
  return n;
}
