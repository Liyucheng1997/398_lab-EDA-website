import { describe, expect, it } from 'vitest';
import type { HierarchyNode } from '@webeda/shared';
import { ancestorsOf, countNodes, defaultExpanded, findPaths, isSelected, MAX_ROWS, visibleRows } from './hierarchy';

const n = (module: string, instance: string, children: HierarchyNode[] = []): HierarchyNode => ({ module, instance, children });

const tree = n('top', 'top', [n('core', 'u_core', [n('alu', 'u_alu'), n('regfile', 'u_rf')]), n('uart', 'u_uart'), n('uart', 'u_uart')]);

describe('visibleRows', () => {
  it('lists only expanded branches, depth first, with unique paths', () => {
    const rows = visibleRows(tree, new Set(['top']));
    expect(rows.map((r) => r.path)).toEqual(['top', 'top.u_core', 'top.u_uart', 'top.u_uart#1']);
    expect(rows[1]).toMatchObject({ depth: 1, hasChildren: true, expanded: false, parentPath: 'top' });
    const all = visibleRows(tree, new Set(['top', 'top.u_core']));
    expect(all.map((r) => r.path)).toEqual(['top', 'top.u_core', 'top.u_core.u_alu', 'top.u_core.u_rf', 'top.u_uart', 'top.u_uart#1']);
  });
  it('handles null and malformed nodes', () => {
    expect(visibleRows(null, new Set())).toEqual([]);
    const bad = { module: 'x', instance: '' } as unknown as HierarchyNode;
    expect(visibleRows(bad, new Set(['x']))).toHaveLength(1);
  });
  it('caps very large trees', () => {
    const wide = n('top', 'top', Array.from({ length: MAX_ROWS + 50 }, (_, i) => n('leaf', `u${i}`)));
    expect(visibleRows(wide, new Set(['top']))).toHaveLength(MAX_ROWS);
  });
  it('survives cyclic data', () => {
    const a = n('a', 'a');
    a.children.push(a);
    const exp = defaultExpanded(a);
    expect(visibleRows(a, exp).length).toBeLessThanOrEqual(MAX_ROWS);
    expect(countNodes(a)).toBeLessThan(100);
  });
});

describe('defaultExpanded', () => {
  it('expands everything for small trees', () => {
    expect([...defaultExpanded(tree)].sort()).toEqual(['top', 'top.u_core']);
  });
  it('expands only the first levels for big trees', () => {
    const big = n('top', 'top', Array.from({ length: 300 }, (_, i) => n('m', `u${i}`, [n('leaf', 'x')])));
    const e = defaultExpanded(big, 1, 200);
    expect(e.has('top')).toBe(true);
    expect(e.has('top.u0')).toBe(false);
  });
});

describe('selection helpers', () => {
  it('matches by path or module name', () => {
    const rows = visibleRows(tree, new Set(['top']));
    expect(rows.filter((r) => isSelected(r, 'uart'))).toHaveLength(2);
    expect(rows.filter((r) => isSelected(r, 'top.u_core'))).toHaveLength(1);
    expect(rows.filter((r) => isSelected(r, undefined))).toHaveLength(0);
  });
  it('finds paths and ancestors', () => {
    expect(findPaths(tree, 'alu')).toEqual(['top.u_core.u_alu']);
    expect(findPaths(tree, 'uart')).toEqual(['top.u_uart', 'top.u_uart#1']);
    expect(ancestorsOf('top.u_core.u_alu')).toEqual(['top', 'top.u_core']);
    expect(ancestorsOf('top')).toEqual([]);
  });
});
