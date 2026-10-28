// 模块层次树的纯逻辑：路径、可见行展开、默认展开集合。
import type { HierarchyNode } from '@webeda/shared';

export interface TreeRow {
  node: HierarchyNode;
  /** 实例路径，如 "top.u_core.u_alu"（同级重名时追加 #序号保证唯一） */
  path: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentPath: string | null;
}

/** 防御：层次过深（递归实例化畸形数据）或节点过多时截断 */
export const MAX_DEPTH = 64;
export const MAX_ROWS = 5000;

function kids(n: HierarchyNode): HierarchyNode[] {
  return Array.isArray(n.children) ? n.children : [];
}

function childPaths(parent: string, children: HierarchyNode[]): string[] {
  const seen = new Map<string, number>();
  return children.map((c) => {
    const base = `${parent}.${c.instance || c.module || '?'}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

export function rootPath(root: HierarchyNode): string {
  return root.instance || root.module || 'top';
}

/** 按展开状态列出可见行（深度优先） */
export function visibleRows(root: HierarchyNode | null, expanded: ReadonlySet<string>): TreeRow[] {
  if (!root) return [];
  const rows: TreeRow[] = [];
  const stack: { node: HierarchyNode; path: string; depth: number; parent: string | null }[] = [
    { node: root, path: rootPath(root), depth: 0, parent: null },
  ];
  while (stack.length && rows.length < MAX_ROWS) {
    const { node, path, depth, parent } = stack.pop()!;
    const children = depth < MAX_DEPTH ? kids(node) : [];
    const isOpen = children.length > 0 && expanded.has(path);
    rows.push({ node, path, depth, hasChildren: children.length > 0, expanded: isOpen, parentPath: parent });
    if (isOpen) {
      const paths = childPaths(path, children);
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], path: paths[i], depth: depth + 1, parent: path });
    }
  }
  return rows;
}

/** 默认展开：节点不多时全部展开，否则只展开到 depth 层 */
export function defaultExpanded(root: HierarchyNode | null, depth = 1, fullLimit = 200): Set<string> {
  const out = new Set<string>();
  if (!root) return out;
  const total = countNodes(root, fullLimit + 1);
  const maxDepth = total <= fullLimit ? MAX_DEPTH : depth;
  const stack: { node: HierarchyNode; path: string; d: number }[] = [{ node: root, path: rootPath(root), d: 0 }];
  while (stack.length && out.size < MAX_ROWS) {
    const { node, path, d } = stack.pop()!;
    const children = kids(node);
    if (!children.length || d >= maxDepth) continue;
    out.add(path);
    const paths = childPaths(path, children);
    children.forEach((c, i) => stack.push({ node: c, path: paths[i], d: d + 1 }));
  }
  return out;
}

/** 节点总数（达到 limit 即停止计数） */
export function countNodes(root: HierarchyNode | null, limit = Infinity): number {
  if (!root) return 0;
  let n = 0;
  const stack: { node: HierarchyNode; d: number }[] = [{ node: root, d: 0 }];
  while (stack.length && n < limit) {
    const { node, d } = stack.pop()!;
    n++;
    if (d < MAX_DEPTH) for (const c of kids(node)) stack.push({ node: c, d: d + 1 });
  }
  return n;
}

/** 选中判断：selected 可以是实例路径，也可以是模块名（同一模块的所有实例都高亮） */
export function isSelected(row: Pick<TreeRow, 'path' | 'node'>, selected: string | undefined): boolean {
  if (!selected) return false;
  return row.path === selected || row.node.module === selected;
}

/** 选中项的所有祖先路径（用于自动展开） */
export function ancestorsOf(path: string): string[] {
  const out: string[] = [];
  let i = path.indexOf('.');
  while (i >= 0) {
    out.push(path.slice(0, i));
    i = path.indexOf('.', i + 1);
  }
  return out;
}

/** 找出与 selected 匹配（路径或模块名）的节点路径，最多 limit 个 */
export function findPaths(root: HierarchyNode | null, selected: string | undefined, limit = 50): string[] {
  const out: string[] = [];
  if (!root || !selected) return out;
  const stack: { node: HierarchyNode; path: string; d: number }[] = [{ node: root, path: rootPath(root), d: 0 }];
  let visited = 0;
  while (stack.length && out.length < limit && visited < MAX_ROWS * 4) {
    const { node, path, d } = stack.pop()!;
    visited++;
    if (path === selected || node.module === selected) out.push(path);
    const children = d < MAX_DEPTH ? kids(node) : [];
    const paths = childPaths(path, children);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], path: paths[i], d: d + 1 });
  }
  return out;
}
