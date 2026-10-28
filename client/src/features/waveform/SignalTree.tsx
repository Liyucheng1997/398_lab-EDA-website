// 左侧信号树：作用域层次、过滤、单击选中 / 双击或拖动添加、整作用域添加。虚拟化渲染。

import { ChevronDown, ChevronRight, Plus, Box, Braces, PanelLeftClose, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { VcdData, VcdScope } from './vcd';

export const DND_VARS = 'application/x-webeda-wave-vars';

const ROW = 26;

type Item =
  | { kind: 'scope'; scope: VcdScope; depth: number; open: boolean; count: number }
  | { kind: 'var'; index: number; depth: number };

interface Props {
  data: VcdData;
  filter: string;
  onFilterChange: (s: string) => void;
  added: Set<string>;
  onAdd: (varIndices: number[]) => void;
  onClose?: () => void;
}

function countVars(s: VcdScope): number {
  return s.vars.length + s.scopes.reduce((a, c) => a + countVars(c), 0);
}

export function SignalTree({ data, filter, onFilterChange, added, onAdd, onClose }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(data.root.scopes.map((s) => s.path)));
  const [focus, setFocus] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  // 新的波形数据：重置展开状态（保留仍存在的作用域）
  useEffect(() => {
    setOpen((prev) => {
      const next = new Set<string>(data.root.scopes.map((s) => s.path));
      const walk = (s: VcdScope) => {
        if (prev.has(s.path)) next.add(s.path);
        s.scopes.forEach(walk);
      };
      data.root.scopes.forEach(walk);
      return next;
    });
  }, [data]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const q = filter.trim().toLowerCase();

  const items = useMemo(() => {
    const out: Item[] = [];
    if (q) {
      // 过滤模式：只保留匹配的信号及其祖先作用域，全部展开
      const walk = (s: VcdScope, depth: number): Item[] => {
        const sub: Item[] = [];
        for (const c of s.scopes) sub.push(...walk(c, depth + 1));
        const vs = s.vars.filter((i) => data.vars[i].path.toLowerCase().includes(q));
        const own: Item[] = vs.map((i) => ({ kind: 'var', index: i, depth: depth + 1 }));
        if (!sub.length && !own.length) return [];
        return [{ kind: 'scope', scope: s, depth, open: true, count: vs.length }, ...own, ...sub];
      };
      for (const s of data.root.scopes) out.push(...walk(s, 0));
      for (const i of data.root.vars) if (data.vars[i].path.toLowerCase().includes(q)) out.push({ kind: 'var', index: i, depth: 0 });
      return out;
    }
    const walk = (s: VcdScope, depth: number) => {
      const isOpen = open.has(s.path);
      out.push({ kind: 'scope', scope: s, depth, open: isOpen, count: countVars(s) });
      if (!isOpen) return;
      for (const i of s.vars) out.push({ kind: 'var', index: i, depth: depth + 1 });
      for (const c of s.scopes) walk(c, depth + 1);
    };
    for (const s of data.root.scopes) walk(s, 0);
    for (const i of data.root.vars) out.push({ kind: 'var', index: i, depth: 0 });
    return out;
  }, [data, open, q]);

  const matchCount = useMemo(() => (q ? items.filter((i) => i.kind === 'var').length : 0), [items, q]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const scopeVars = (s: VcdScope) => (q ? s.vars.filter((i) => data.vars[i].path.toLowerCase().includes(q)) : s.vars);

  const onDragStart = (e: DragEvent, indices: number[]) => {
    if (!indices.length) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DND_VARS, JSON.stringify(indices));
    e.dataTransfer.setData('text/plain', indices.map((i) => data.vars[i].path).join('\n'));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const keyOf = (it: Item) => (it.kind === 'scope' ? `s:${it.scope.path}` : `v:${it.index}`);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!items.length) return;
    const idx = items.findIndex((it) => keyOf(it) === focus);
    const move = (to: number) => {
      const i = Math.max(0, Math.min(items.length - 1, to));
      setFocus(keyOf(items[i]));
      const el = listRef.current;
      if (el) {
        const y = i * ROW;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight;
      }
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      move(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      move(idx < 0 ? 0 : idx - 1);
    } else if (idx >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const it = items[idx];
      e.preventDefault();
      e.stopPropagation();
      if (it.kind === 'scope' && !q && it.open !== (e.key === 'ArrowRight')) toggle(it.scope.path);
    } else if (idx >= 0 && e.key === 'Enter') {
      const it = items[idx];
      e.preventDefault();
      e.stopPropagation();
      onAdd(it.kind === 'var' ? [it.index] : scopeVars(it.scope));
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 6);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewH) / ROW) + 6);
  const visible = items.slice(first, last);

  return (
    <div className="wv-tree-inner">
      <div className="wv-tree-head">
        <span className="wv-tree-title">信号</span>
        {q ? <span className="badge">{matchCount}</span> : <span className="badge">{data.vars.length}</span>}
        <span className="spacer" />
        {q && (
          <button className="icon-btn wv-sm-btn" title="清除过滤" onClick={() => onFilterChange('')}>
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
        {onClose && (
          <button className="icon-btn wv-sm-btn" title="隐藏信号树" onClick={onClose}>
            <PanelLeftClose size={15} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div
        ref={listRef}
        className="wv-tree-list"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {items.length === 0 ? (
          <div className="wv-tree-empty">{q ? '没有匹配的信号' : 'VCD 中没有信号'}</div>
        ) : (
          <div style={{ height: items.length * ROW, position: 'relative' }}>
            {visible.map((it, k) => {
              const i = first + k;
              const key = keyOf(it);
              const style = { top: i * ROW, paddingLeft: 8 + it.depth * 14 };
              if (it.kind === 'scope') {
                const s = it.scope;
                const vars = scopeVars(s);
                return (
                  <div
                    key={key}
                    className={`wv-tree-row wv-tree-scope${focus === key ? ' focus' : ''}`}
                    style={style}
                    title={`${s.type} ${s.path}`}
                    draggable={vars.length > 0}
                    onDragStart={(e) => onDragStart(e, vars)}
                    onClick={() => {
                      setFocus(key);
                      if (!q) toggle(s.path);
                    }}
                  >
                    <span className="wv-tree-chev">
                      {it.open ? <ChevronDown size={13} strokeWidth={1.75} /> : <ChevronRight size={13} strokeWidth={1.75} />}
                    </span>
                    {s.type === 'module' ? (
                      <Box size={13} strokeWidth={1.75} className="wv-tree-ico" />
                    ) : (
                      <Braces size={13} strokeWidth={1.75} className="wv-tree-ico" />
                    )}
                    <span className="wv-tree-name">{s.name}</span>
                    {s.type !== 'module' && <span className="wv-tree-meta">{s.type}</span>}
                    <span className="spacer" />
                    {vars.length > 0 && (
                      <button
                        className="wv-tree-add"
                        title={`添加此作用域的 ${vars.length} 个信号`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdd(vars);
                        }}
                      >
                        <Plus size={13} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                );
              }
              const v = data.vars[it.index];
              const isAdded = added.has(v.path);
              return (
                <div
                  key={key}
                  className={`wv-tree-row wv-tree-var${focus === key ? ' focus' : ''}${isAdded ? ' added' : ''}`}
                  style={style}
                  title={`${v.path}${v.range}  ·  ${v.type} ${v.width} 位${isAdded ? '（已添加）' : ''}\n双击或拖到右侧添加`}
                  draggable
                  onDragStart={(e) => onDragStart(e, [it.index])}
                  onClick={() => setFocus(key)}
                  onDoubleClick={() => onAdd([it.index])}
                >
                  <span className="wv-tree-chev" />
                  <i className={`wv-tree-dot${isAdded ? ' on' : ''}`} />
                  <span className="wv-tree-name">{v.name}</span>
                  {v.range && <span className="wv-tree-range">{v.range}</span>}
                  <span className="spacer" />
                  <span className="wv-tree-meta">{v.type}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
