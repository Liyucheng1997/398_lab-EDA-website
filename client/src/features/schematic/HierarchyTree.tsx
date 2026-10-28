import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Box, ChevronRight, Network } from 'lucide-react';
import type { HierarchyNode } from '@webeda/shared';
import { ancestorsOf, countNodes, defaultExpanded, findPaths, isSelected, MAX_ROWS, visibleRows, type TreeRow } from './hierarchy';
import './schematic.css';

export interface HierarchyTreeProps {
  root: HierarchyNode | null;
  /** 选中项：实例路径（如 "top.u_core"）或模块名（该模块的所有实例都高亮） */
  selected?: string;
  onSelect?(node: HierarchyNode, path: string): void;
  className?: string;
  /** 没有层次信息时的提示 */
  emptyText?: string;
}

/** 模块层次树（类 Vivado Sources 窗口的 Hierarchy 视图）：实例名 + 模块名，可折叠 */
export function HierarchyTree({ root, selected, onSelect, className, emptyText = '运行 RTL 分析后显示模块层次' }: HierarchyTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(root));
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 新的层次数据：重置展开状态
  useEffect(() => {
    setExpanded(defaultExpanded(root));
    setFocusPath(null);
  }, [root]);

  // 选中项变化时展开其祖先，保证可见
  useEffect(() => {
    if (!root || !selected) return;
    const paths = findPaths(root, selected, 20);
    if (!paths.length) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of paths)
        for (const a of ancestorsOf(p))
          if (!next.has(a)) {
            next.add(a);
            changed = true;
          }
      return changed ? next : prev;
    });
  }, [root, selected]);

  const rows = useMemo(() => visibleRows(root, expanded), [root, expanded]);
  const total = useMemo(() => countNodes(root, MAX_ROWS + 1), [root]);

  const toggle = (path: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const want = open ?? !next.has(path);
      if (want) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const choose = (row: TreeRow) => {
    setFocusPath(row.path);
    onSelect?.(row.node, row.path);
  };

  const focusIdx = Math.max(
    0,
    rows.findIndex((r) => r.path === focusPath),
  );

  // 键盘焦点所在行滚入视野
  useEffect(() => {
    if (!focusPath || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusPath, focusIdx]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const row = rows[focusIdx];
    switch (e.key) {
      case 'ArrowDown':
        setFocusPath(rows[Math.min(rows.length - 1, focusIdx + 1)].path);
        break;
      case 'ArrowUp':
        setFocusPath(rows[Math.max(0, focusIdx - 1)].path);
        break;
      case 'Home':
        setFocusPath(rows[0].path);
        break;
      case 'End':
        setFocusPath(rows[rows.length - 1].path);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) toggle(row.path, true);
        else if (row.expanded && rows[focusIdx + 1]) setFocusPath(rows[focusIdx + 1].path);
        break;
      case 'ArrowLeft':
        if (row.expanded) toggle(row.path, false);
        else if (row.parentPath) setFocusPath(row.parentPath);
        break;
      case 'Enter':
      case ' ':
        choose(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (!root) {
    return (
      <div className={`sch-tree sch-tree-empty${className ? ' ' + className : ''}`}>
        <Network size={28} strokeWidth={1.4} />
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className={`sch-tree${className ? ' ' + className : ''}`}
      role="tree"
      aria-label="模块层次"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={rows[focusIdx] ? `sch-tree-${focusIdx}` : undefined}
    >
      {rows.map((row, i) => {
        const sel = isSelected(row, selected);
        const isTop = row.depth === 0;
        return (
          <div
            key={row.path}
            id={`sch-tree-${i}`}
            data-idx={i}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={sel}
            className={`sch-tree-row${sel ? ' is-selected' : ''}${focusPath === row.path ? ' is-focus' : ''}`}
            style={{ paddingLeft: 6 + Math.min(row.depth, 24) * 14 }}
            onClick={() => choose(row)}
            title={`${row.path}（${row.node.module}）`}
          >
            <button
              className={`sch-tree-caret${row.expanded ? ' is-open' : ''}`}
              tabIndex={-1}
              aria-hidden={!row.hasChildren}
              style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                toggle(row.path);
                setFocusPath(row.path);
              }}
            >
              <ChevronRight size={13} strokeWidth={1.75} />
            </button>
            <Box size={14} strokeWidth={1.75} className="sch-tree-ico" />
            {isTop ? (
              <span className="sch-tree-inst">{row.node.module}</span>
            ) : (
              <>
                <span className="sch-tree-inst">{row.node.instance}</span>
                <span className="sch-tree-mod">{row.node.module}</span>
              </>
            )}
            {isTop && <span className="sch-tree-tag">顶层</span>}
          </div>
        );
      })}
      {total > MAX_ROWS && <div className="sch-tree-more muted">层次过大，仅显示前 {MAX_ROWS} 个节点</div>}
    </div>
  );
}
