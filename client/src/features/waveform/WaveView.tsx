// 波形查看器主体：工具栏 + 信号树 + 名称列 + 值列 + Canvas 波形区。
// 视图（可见时间范围）保存在 ref 中，平移/缩放只触发 rAF 重绘，不触发 React 渲染。

import {
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  ListPlus,
  ListX,
  Maximize2,
  PanelLeft,
  Search,
  StepBack,
  StepForward,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTheme } from '../../lib/theme';
import { toast } from '../../ui/toast';
import { RADIXES, isRadix, type Radix } from './format';
import { loadPersisted, savePersisted } from './persist';
import { drawRuler, drawWaves, measureCharWidth, readPalette, type Palette, type RenderRow } from './render';
import { SignalTree, DND_VARS } from './SignalTree';
import { computeTicks, formatTime, fsPerUnit } from './ticks';
import {
  autoSignals,
  buildPathIndex,
  buildRows,
  canAnalog,
  canExpand,
  insertionTraceIndex,
  moveTraces,
  resolvePath,
  rowIndexAt,
  visibleRange,
  type Row,
  type Trace,
} from './traces';
import type { VcdData } from './vcd';
import { nextEdge, prevEdge, upperBound, valueAtText, valueStateAt, indexAt } from './waves';

const DND_ROWS = 'application/x-webeda-wave-rows';
const RULER_H = 30;
const MAX_ADD = 2000;
const COLS_KEY = 'webeda.wave.cols';

export interface WaveViewProps {
  data: VcdData;
  vcdText: string | null;
  busy: boolean;
  busyLabel?: string;
  persistKey?: string;
  initialSignals?: string[];
  fileName?: string;
}

interface ViewState {
  start: number;
  end: number;
  fit: boolean;
}

type Drag =
  | { kind: 'scrub'; id: number }
  | { kind: 'pan'; id: number; x0: number; start: number; end: number; moved: boolean; click: 'marker' | 'menu' | 'cursor'; y: number; cx: number; cy: number }
  | { kind: 'ruler'; id: number; t0: number; x0: number; moved: boolean }
  | { kind: 'thumb'; id: number; x0: number; start: number; end: number }
  | null;

function loadCols(): { names: number; values: number } {
  try {
    const o = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as { names?: unknown; values?: unknown } | null;
    if (o && typeof o.names === 'number' && typeof o.values === 'number') return { names: o.names, values: o.values };
  } catch {
    /* ignore */
  }
  return { names: 180, values: 110 };
}

/** setPointerCapture 在指针已结束等情况下会抛错；捕获失败不影响交互 */
function capturePointer(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export function WaveView({ data, vcdText, busy, busyLabel, persistKey, initialSignals, fileName }: WaveViewProps) {
  const [theme] = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const waveColRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const pathIndex = useMemo(() => buildPathIndex(data), [data]);
  const fsUnit = useMemo(() => fsPerUnit(data.timescale), [data]);
  const full = useMemo(() => {
    const start = Number.isFinite(data.startTime) ? Math.min(data.startTime, 0) : 0;
    const end = Math.max(data.endTime, start + 1);
    return { start, end, span: end - start };
  }, [data]);

  const uidRef = useRef(0);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [defaultRadix, setDefaultRadix] = useState<Radix>(() => loadPersisted(persistKey)?.defaultRadix ?? 'hex');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [marker, setMarker] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [treePref, setTreePref] = useState<boolean | null>(null);
  const [compact, setCompact] = useState(false);
  const [cols, setCols] = useState(loadCols);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(300);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [dropY, setDropY] = useState<number | null>(null);
  const [zoomInfo, setZoomInfo] = useState({ canIn: true, canOut: true });

  const viewRef = useRef<ViewState>({ start: full.start, end: full.end, fit: true });
  const viewInitRef = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rulerSelRef = useRef<[number, number] | null>(null);
  const dragRef = useRef<Drag>(null);
  const paletteRef = useRef<Palette | null>(null);
  const charWRef = useRef(7.2);
  const rafRef = useRef(0);
  const viewSaveTimer = useRef(0);

  const treeOpen = treePref ?? !compact;
  const namesW = compact ? Math.min(cols.names, 130) : cols.names;
  const valuesW = compact ? Math.min(cols.values, 76) : cols.values;

  const { rows, total } = useMemo(() => buildRows(data, pathIndex, traces), [data, pathIndex, traces]);
  const addedPaths = useMemo(() => new Set(traces.map((t) => t.path)), [traces]);

  // 最新状态（供 rAF 绘制与原生事件处理读取）
  const live = useRef({ rows, selected, cursor, marker, traces, full, fsUnit, data });
  live.current = { rows, selected, cursor, marker, traces, full, fsUnit, data };

  // ------------------------------------------------------------------------
  // 视图

  const minSpan = Math.min(2, full.span);
  const maxSpan = full.span * 2;

  const clampView = useCallback(
    (start: number, end: number): [number, number] => {
      let span = end - start;
      if (!(span > 0) || !Number.isFinite(span)) span = full.span;
      span = Math.max(Math.min(2, full.span), Math.min(full.span * 2, span));
      const mid = (start + end) / 2;
      let s = Number.isFinite(mid) ? mid - span / 2 : full.start;
      const lo = full.start - span / 2;
      const hi = full.end - span / 2;
      s = Math.max(lo, Math.min(hi, s));
      return [s, s + span];
    },
    [full],
  );

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);

  const updateZoomInfo = useCallback(() => {
    const v = viewRef.current;
    const span = v.end - v.start;
    const canIn = span > Math.min(2, full.span) * 1.0001;
    const canOut = span < full.span * 2 * 0.9999;
    setZoomInfo((z) => (z.canIn === canIn && z.canOut === canOut ? z : { canIn, canOut }));
  }, [full]);

  const defaultRadixRef = useRef(defaultRadix);
  defaultRadixRef.current = defaultRadix;

  const persistNow = useCallback(() => {
    if (!persistKey) return;
    const l = live.current;
    const v = viewRef.current;
    savePersisted(persistKey, {
      v: 1,
      traces: l.traces.map((t) => ({ path: t.path, radix: t.radix, analog: t.analog, expanded: t.expanded })),
      view: { start: v.start, end: v.end, fit: v.fit },
      defaultRadix: defaultRadixRef.current,
    });
  }, [persistKey]);
  const setView = useCallback(
    (start: number, end: number, fit = false) => {
      const [s, e] = clampView(start, end);
      viewRef.current = { start: s, end: e, fit };
      scheduleDraw();
      updateZoomInfo();
      window.clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = window.setTimeout(persistNow, 400);
    },
    [clampView, scheduleDraw, updateZoomInfo, persistNow],
  );

  const fit = useCallback(() => {
    setView(full.start, full.end + full.span * 0.02, true);
  }, [full, setView]);

  const zoomAt = useCallback(
    (factor: number, anchor?: number) => {
      const v = viewRef.current;
      const span = v.end - v.start;
      let a = anchor;
      if (a === undefined) {
        const c = live.current.cursor;
        a = c !== null && c >= v.start && c <= v.end ? c : (v.start + v.end) / 2;
      }
      const ns = Math.max(minSpan, Math.min(maxSpan, span / factor));
      const start = a - ((a - v.start) * ns) / span;
      setView(start, start + ns);
    },
    [minSpan, maxSpan, setView],
  );

  const panPx = useCallback(
    (px: number) => {
      const v = viewRef.current;
      const w = sizeRef.current.w || 1;
      const dt = (px / w) * (v.end - v.start);
      setView(v.start + dt, v.end + dt);
    },
    [setView],
  );

  const ensureVisible = useCallback(
    (t: number) => {
      const v = viewRef.current;
      const span = v.end - v.start;
      if (t < v.start + span * 0.04 || t > v.end - span * 0.04) setView(t - span / 2, t + span / 2);
    },
    [setView],
  );

  // ------------------------------------------------------------------------
  // 新数据：恢复信号与视图

  const tracesRef = useRef(traces);
  tracesRef.current = traces;

  useLayoutEffect(() => {
    const persisted = loadPersisted(persistKey);
    const mk = (path: string, radix?: Radix, analog = false, expanded = false): Trace => ({
      uid: ++uidRef.current,
      path,
      radix: radix ?? defaultRadixRef.current,
      analog,
      expanded,
    });
    let next: Trace[] = tracesRef.current.filter((t) => pathIndex.has(t.path));
    if (!next.length && persisted?.traces.length) {
      next = persisted.traces.filter((t) => pathIndex.has(t.path)).map((t) => mk(t.path, t.radix, t.analog, t.expanded));
    }
    if (!next.length && initialSignals?.length) {
      const seen = new Set<string>();
      for (const name of initialSignals) {
        const vi = resolvePath(pathIndex, data, name);
        if (vi === undefined) continue;
        const p = data.vars[vi].path;
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(mk(p));
      }
    }
    if (!next.length) next = autoSignals(data).map((vi) => mk(data.vars[vi].path));
    setTraces(next);

    // 视图：保留用户的缩放，除非它处于"适应窗口"状态或与新的时间范围不相称
    const usable = (v: { start: number; end: number; fit: boolean } | undefined) =>
      !!v && !v.fit && v.end - v.start <= full.span * 1.05 && v.end > full.start && v.start < full.end;
    const prevView = viewInitRef.current ? viewRef.current : persisted?.view;
    viewInitRef.current = true;
    if (prevView && usable(prevView)) setView(prevView.start, prevView.end);
    else fit();
    setCursor((c) => (c !== null && c >= full.start && c <= full.end ? c : null));
    setMarker((m) => (m !== null && m >= full.start && m <= full.end ? m : null));
  }, [data]);

  // 信号列表变化：立即保存
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    persistNow();
  }, [traces, defaultRadix, persistNow]);

  useEffect(
    () => () => {
      window.clearTimeout(viewSaveTimer.current);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  // ------------------------------------------------------------------------
  // 绘制

  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const canvas = canvasRef.current;
    const ruler = rulerRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || !ruler || w <= 0 || h <= 0) return;
    const pal = paletteRef.current ?? (paletteRef.current = readPalette());
    const dpr = window.devicePixelRatio || 1;
    const l = live.current;
    const v = viewRef.current;
    const span = v.end - v.start;
    const scale = w / span;
    const ticks = computeTicks(v.start, v.end, w, l.fsUnit);

    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = scrollRef.current?.scrollTop ?? 0;
    const [a, b] = visibleRange(l.rows, st, h, 1);
    const renderRows: RenderRow[] = [];
    for (let i = a; i <= b; i++) {
      const r = l.rows[i];
      if (!r) continue;
      renderRows.push({
        key: r.key,
        top: r.top,
        height: r.height,
        wave: r.wave,
        mode: r.mode,
        radix: r.trace.radix,
        selected: l.selected.has(r.key),
      });
    }
    drawWaves(ctx, {
      width: w,
      height: h,
      scrollTop: st,
      rows: renderRows,
      view: { start: v.start, scale },
      endTime: l.full.end,
      ticks,
      cursor: l.cursor,
      marker: l.marker,
      palette: pal,
      charW: charWRef.current,
    });

    const rw = Math.round(w * dpr);
    const rh = Math.round(RULER_H * dpr);
    if (ruler.width !== rw || ruler.height !== rh) {
      ruler.width = rw;
      ruler.height = rh;
      ruler.style.width = `${w}px`;
      ruler.style.height = `${RULER_H}px`;
    }
    const rctx = ruler.getContext('2d');
    if (rctx) {
      rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRuler(rctx, {
        width: w,
        height: RULER_H,
        view: { start: v.start, scale },
        ticks,
        fsUnit: l.fsUnit,
        cursor: l.cursor,
        marker: l.marker,
        cursorLabel: l.cursor !== null ? formatTime(l.cursor, l.fsUnit) : null,
        markerLabel: l.marker !== null ? formatTime(l.marker, l.fsUnit) : null,
        selection: rulerSelRef.current,
        palette: pal,
      });
    }

    // 水平滚动条
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (track && thumb) {
      const tw = track.clientWidth;
      const lo = Math.min(l.full.start, v.start);
      const hi = Math.max(l.full.end, v.end);
      const all = hi - lo;
      const covers = span >= all * 0.999;
      thumb.style.display = covers ? 'none' : 'block';
      if (!covers) {
        const tWidth = Math.max(24, (span / all) * tw);
        const left = ((v.start - lo) / Math.max(all - span, 1e-12)) * (tw - tWidth);
        thumb.style.width = `${tWidth}px`;
        thumb.style.transform = `translateX(${Math.max(0, Math.min(tw - tWidth, left))}px)`;
      }
    }
  };

  // 每次渲染后重绘（rAF 合并）
  useEffect(() => {
    scheduleDraw();
  });

  // 主题切换：重新读取颜色
  useEffect(() => {
    paletteRef.current = readPalette();
    const c = canvasRef.current?.getContext('2d');
    if (c) charWRef.current = measureCharWidth(c, paletteRef.current.mono);
    scheduleDraw();
  }, [theme, scheduleDraw]);

  // 尺寸
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const col = waveColRef.current;
    const root = rootRef.current;
    if (!sc || !col || !root) return;
    const measure = () => {
      const w = Math.max(0, Math.floor(col.clientWidth));
      const h = Math.max(0, Math.floor(sc.clientHeight));
      sizeRef.current = { w, h };
      setViewH(h);
      setCompact(root.clientWidth < 760);
      drawRef.current();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    ro.observe(col);
    ro.observe(root);
    measure();
    // devicePixelRatio 变化（浏览器缩放 / 拖到另一块屏幕）
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      drawRef.current();
      mq?.removeEventListener('change', onDpr);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', onDpr);
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
    };
  }, []);

  // ------------------------------------------------------------------------
  // 坐标换算

  const timeAtClientX = (clientX: number): number => {
    const col = waveColRef.current;
    const v = viewRef.current;
    if (!col) return v.start;
    const rect = col.getBoundingClientRect();
    const w = sizeRef.current.w || rect.width || 1;
    return v.start + ((clientX - rect.left) / w) * (v.end - v.start);
  };

  const rowAtClientY = (clientY: number): Row | null => {
    const content = contentRef.current;
    if (!content) return null;
    const y = clientY - content.getBoundingClientRect().top;
    const i = rowIndexAt(live.current.rows, y);
    return i >= 0 ? live.current.rows[i] : null;
  };

  /** 吸附：靠近（≤ 6px）所在行的跳变时吸附过去，否则取整到时间单位 */
  const snapTime = (t: number, row: Row | null): number => {
    const v = viewRef.current;
    const scale = (sizeRef.current.w || 1) / (v.end - v.start);
    let best = Math.round(t);
    if (row) {
      const times = row.wave.times;
      const i = upperBound(times, t);
      let bd = Infinity;
      for (const k of [i - 1, i]) {
        if (k < 0 || k >= times.length) continue;
        const d = Math.abs(times[k] - t) * scale;
        if (d <= 6 && d < bd) {
          bd = d;
          best = times[k];
        }
      }
    }
    return Math.max(full.start, Math.min(full.end, best));
  };

  // ------------------------------------------------------------------------
  // 选择与信号操作

  const selectRow = (key: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const keys = live.current.rows.map((r) => r.key);
    if (e.shiftKey && anchorRef.current && keys.includes(anchorRef.current)) {
      const a = keys.indexOf(anchorRef.current);
      const b = keys.indexOf(key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(keys.slice(lo, hi + 1)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      });
      anchorRef.current = key;
      return;
    }
    setSelected(new Set([key]));
    anchorRef.current = key;
  };

  const addVars = useCallback(
    (indices: number[], at?: number) => {
      const present = new Set(tracesRef.current.map((t) => t.path));
      const paths: string[] = [];
      for (const i of indices) {
        const v = data.vars[i];
        if (!v || present.has(v.path)) continue;
        present.add(v.path);
        paths.push(v.path);
      }
      if (!paths.length) {
        if (indices.length) toast(indices.length === 1 ? '该信号已在列表中' : '这些信号都已在列表中');
        return;
      }
      let list = paths;
      if (paths.length > MAX_ADD) {
        list = paths.slice(0, MAX_ADD);
        toast(`信号过多，只添加了前 ${MAX_ADD} 个`, 'error');
      }
      const created = list.map<Trace>((p) => ({ uid: ++uidRef.current, path: p, radix: defaultRadixRef.current, analog: false, expanded: false }));
      setTraces((prev) => {
        const pos = at === undefined ? prev.length : Math.max(0, Math.min(prev.length, at));
        return [...prev.slice(0, pos), ...created, ...prev.slice(pos)];
      });
      setSelected(new Set(created.map((t) => `t${t.uid}`)));
      anchorRef.current = created.length ? `t${created[0].uid}` : null;
      if (at === undefined) {
        // 滚动到新加的信号
        requestAnimationFrame(() => {
          const sc = scrollRef.current;
          if (sc) sc.scrollTop = sc.scrollHeight;
        });
      }
    },
    [data],
  );

  const selectedTraceUids = (includeBitParents: boolean): Set<number> => {
    const out = new Set<number>();
    for (const r of live.current.rows) {
      if (!live.current.selected.has(r.key)) continue;
      if (r.bit === null || includeBitParents) out.add(r.trace.uid);
    }
    return out;
  };

  const removeTraces = (uids: Set<number>) => {
    if (!uids.size) return;
    setTraces((prev) => prev.filter((t) => !uids.has(t.uid)));
    setSelected(new Set());
  };

  const updateTraces = (uids: Set<number>, fn: (t: Trace) => Trace) => {
    setTraces((prev) => prev.map((t) => (uids.has(t.uid) ? fn(t) : t)));
  };

  const applyRadix = (radix: Radix) => {
    const uids = selectedTraceUids(true);
    if (uids.size) updateTraces(uids, (t) => ({ ...t, radix }));
    else {
      setDefaultRadix(radix);
      setTraces((prev) => prev.map((t) => ({ ...t, radix })));
    }
  };

  const addAll = () => addVars(data.vars.map((_, i) => i));
  const clearAll = () => {
    setTraces([]);
    setSelected(new Set());
  };

  // ------------------------------------------------------------------------
  // 光标 / 跳变导航

  const gotoEdge = (dir: 1 | -1) => {
    const l = live.current;
    const sel = l.rows.filter((r) => l.selected.has(r.key));
    const targets = sel.length ? sel : l.rows;
    if (!targets.length) return;
    const v = viewRef.current;
    const from = l.cursor ?? (dir > 0 ? v.start - 1e-9 : v.end + 1e-9);
    let best: number | null = null;
    for (const r of targets) {
      const t = dir > 0 ? nextEdge(r.wave, from) : prevEdge(r.wave, from);
      if (t === null) continue;
      if (best === null || (dir > 0 ? t < best : t > best)) best = t;
    }
    if (best === null) {
      toast(dir > 0 ? '后面没有跳变了' : '前面没有跳变了');
      return;
    }
    setCursor(best);
    ensureVisible(best);
  };

  const zoomToCursor = () => {
    const c = live.current.cursor;
    if (c === null) return;
    const v = viewRef.current;
    const ns = Math.max(minSpan, (v.end - v.start) / 4);
    setView(c - ns / 2, c + ns / 2);
  };

  const moveSelection = (d: 1 | -1, extend: boolean) => {
    const l = live.current;
    if (!l.rows.length) return;
    const keys = l.rows.map((r) => r.key);
    const cur = anchorRef.current && keys.includes(anchorRef.current) ? keys.indexOf(anchorRef.current) : d > 0 ? -1 : keys.length;
    const ni = Math.max(0, Math.min(keys.length - 1, cur + d));
    const key = keys[ni];
    if (extend) setSelected((prev) => new Set([...prev, key]));
    else setSelected(new Set([key]));
    anchorRef.current = key;
    const r = l.rows[ni];
    const sc = scrollRef.current;
    if (sc) {
      if (r.top < sc.scrollTop) sc.scrollTop = r.top;
      else if (r.top + r.height > sc.scrollTop + sc.clientHeight) sc.scrollTop = r.top + r.height - sc.clientHeight;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case '+':
      case '=':
        if (mod) return; // 留给浏览器缩放
        e.preventDefault();
        zoomAt(2);
        break;
      case '-':
      case '_':
        if (mod) return;
        e.preventDefault();
        zoomAt(0.5);
        break;
      case 'f':
      case 'F':
        if (mod) return;
        e.preventDefault();
        fit();
        break;
      case 'ArrowRight':
        e.preventDefault();
        gotoEdge(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        gotoEdge(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1, e.shiftKey);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        removeTraces(selectedTraceUids(false));
        break;
      case 'Escape':
        setMenu(null);
        setSelected(new Set());
        break;
      case 'Home': {
        e.preventDefault();
        const v = viewRef.current;
        setView(full.start, full.start + (v.end - v.start));
        break;
      }
      case 'End': {
        e.preventDefault();
        const v = viewRef.current;
        setView(full.end - (v.end - v.start) * 0.98, full.end + (v.end - v.start) * 0.02);
        break;
      }
      case 'a':
      case 'A':
        if (mod) {
          e.preventDefault();
          setSelected(new Set(live.current.rows.map((r) => r.key)));
        }
        break;
      default:
    }
  };

  // ------------------------------------------------------------------------
  // 滚轮（原生非被动监听，才能 preventDefault）

  const wheelRef = useRef<(e: WheelEvent, onRuler: boolean) => void>(() => {});
  wheelRef.current = (e, onRuler) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sizeRef.current.h || 400 : 1;
    const dy = e.deltaY * unit;
    const dx = e.deltaX * unit;
    const col = waveColRef.current;
    const overWave = !!col && e.clientX >= col.getBoundingClientRect().left;
    if (e.ctrlKey || e.metaKey || (onRuler && !e.shiftKey && Math.abs(dy) > Math.abs(dx))) {
      e.preventDefault();
      const factor = Math.exp(-dy * 0.0025);
      zoomAt(factor, overWave ? timeAtClientX(e.clientX) : undefined);
    } else if (e.shiftKey) {
      e.preventDefault();
      panPx(dy || dx);
    } else if (Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
      panPx(dx);
    }
  };

  useEffect(() => {
    const sc = scrollRef.current;
    const ru = rulerRef.current;
    if (!sc || !ru) return;
    const a = (e: WheelEvent) => wheelRef.current(e, false);
    const b = (e: WheelEvent) => wheelRef.current(e, true);
    sc.addEventListener('wheel', a, { passive: false });
    ru.addEventListener('wheel', b, { passive: false });
    return () => {
      sc.removeEventListener('wheel', a);
      ru.removeEventListener('wheel', b);
    };
  }, []);

  // ------------------------------------------------------------------------
  // 波形区指针交互

  const onWavePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus({ preventScroll: true });
    setMenu(null);
    const el = e.currentTarget;
    if (e.pointerType === 'touch') {
      const v = viewRef.current;
      dragRef.current = { kind: 'pan', id: e.pointerId, x0: e.clientX, start: v.start, end: v.end, moved: false, click: 'cursor', y: e.clientY, cx: e.clientX, cy: e.clientY };
      capturePointer(el, e.pointerId);
      return;
    }
    if (e.button === 0 && !e.shiftKey) {
      e.preventDefault();
      const row = rowAtClientY(e.clientY);
      if (row) selectRow(row.key, e);
      setCursor(snapTime(timeAtClientX(e.clientX), row));
      dragRef.current = { kind: 'scrub', id: e.pointerId };
      capturePointer(el, e.pointerId);
    } else if (e.button === 0 && e.shiftKey) {
      e.preventDefault();
      setMarker(snapTime(timeAtClientX(e.clientX), rowAtClientY(e.clientY)));
    } else if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      const v = viewRef.current;
      dragRef.current = {
        kind: 'pan',
        id: e.pointerId,
        x0: e.clientX,
        start: v.start,
        end: v.end,
        moved: false,
        click: e.button === 1 ? 'marker' : 'menu',
        y: e.clientY,
        cx: e.clientX,
        cy: e.clientY,
      };
      capturePointer(el, e.pointerId);
    }
  };

  const onWavePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === 'scrub') {
      setCursor(Math.max(full.start, Math.min(full.end, Math.round(timeAtClientX(e.clientX)))));
    } else if (d.kind === 'pan') {
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - d.cy) < 4) return;
      d.moved = true;
      const w = sizeRef.current.w || 1;
      const dt = (-dx / w) * (d.end - d.start);
      setView(d.start + dt, d.end + dt);
      if (e.pointerType === 'touch') {
        // 触摸：竖直方向手动滚动
        const sc = scrollRef.current;
        if (sc) sc.scrollTop -= e.clientY - d.y;
        d.y = e.clientY;
      }
    }
  };

  const onWavePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.kind === 'pan' && !d.moved) {
      const row = rowAtClientY(e.clientY);
      const t = snapTime(timeAtClientX(e.clientX), row);
      if (d.click === 'marker') setMarker(t);
      else if (d.click === 'cursor') {
        if (row) selectRow(row.key, e);
        setCursor(t);
      } else if (row) {
        if (!live.current.selected.has(row.key)) {
          setSelected(new Set([row.key]));
          anchorRef.current = row.key;
        }
        setMenu({ x: e.clientX, y: e.clientY });
      }
    }
  };

  // ------------------------------------------------------------------------
  // 标尺交互：点击放光标，拖动框选缩放

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus({ preventScroll: true });
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { kind: 'ruler', id: e.pointerId, t0: timeAtClientX(e.clientX), x0: e.clientX, moved: false };
    capturePointer(e.currentTarget, e.pointerId);
  };
  const onRulerPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'ruler' || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    rulerSelRef.current = [d.t0, timeAtClientX(e.clientX)];
    scheduleDraw();
  };
  const onRulerPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'ruler' || d.id !== e.pointerId) return;
    dragRef.current = null;
    rulerSelRef.current = null;
    if (d.moved) {
      const t1 = timeAtClientX(e.clientX);
      const a = Math.min(d.t0, t1);
      const b = Math.max(d.t0, t1);
      if (b - a > 0) setView(a, b);
    } else {
      setCursor(snapTime(d.t0, null));
    }
    scheduleDraw();
  };

  // 水平滚动条
  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const v = viewRef.current;
    dragRef.current = { kind: 'thumb', id: e.pointerId, x0: e.clientX, start: v.start, end: v.end };
    capturePointer(e.currentTarget, e.pointerId);
  };
  const onThumbPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.kind !== 'thumb' || d.id !== e.pointerId) return;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;
    const lo = Math.min(full.start, d.start);
    const hi = Math.max(full.end, d.end);
    const free = track.clientWidth - thumb.offsetWidth;
    if (free <= 0) return;
    const dt = ((e.clientX - d.x0) / free) * (hi - lo - (d.end - d.start));
    setView(d.start + dt, d.end + dt);
  };
  const onThumbPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.kind === 'thumb' && dragRef.current.id === e.pointerId) dragRef.current = null;
  };
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const r = thumb.getBoundingClientRect();
    if (e.clientX < r.left) panPx(-(sizeRef.current.w || 0) * 0.9);
    else if (e.clientX > r.right) panPx((sizeRef.current.w || 0) * 0.9);
  };

  // ------------------------------------------------------------------------
  // 拖放：从信号树添加 / 在名称列内重排

  const dropTargetIndex = (clientY: number): { index: number; y: number } => {
    const content = contentRef.current;
    const l = live.current;
    const y = content ? clientY - content.getBoundingClientRect().top : 0;
    const index = insertionTraceIndex(l.rows, l.traces, y);
    let lineY = total;
    if (index < l.traces.length) {
      const uid = l.traces[index].uid;
      const r = l.rows.find((row) => row.trace.uid === uid);
      if (r) lineY = r.top;
    }
    return { index, y: lineY };
  };

  const onDragOver = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DND_VARS) && !types.includes(DND_ROWS)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DND_ROWS) ? 'move' : 'copy';
    const { y } = dropTargetIndex(e.clientY);
    setDropY((p) => (p === y ? p : y));
  };
  const onDragLeave = (e: DragEvent) => {
    const rel = e.relatedTarget as Node | null;
    if (!rel || !e.currentTarget.contains(rel)) setDropY(null);
  };
  const onDrop = (e: DragEvent) => {
    setDropY(null);
    const vars = e.dataTransfer.getData(DND_VARS);
    const rowsData = e.dataTransfer.getData(DND_ROWS);
    if (!vars && !rowsData) return;
    e.preventDefault();
    const { index } = dropTargetIndex(e.clientY);
    try {
      if (vars) {
        const list = JSON.parse(vars) as unknown;
        if (Array.isArray(list)) addVars(list.filter((x): x is number => typeof x === 'number'), index);
      } else {
        const list = JSON.parse(rowsData) as unknown;
        if (Array.isArray(list)) {
          const uids = new Set(list.filter((x): x is number => typeof x === 'number'));
          setTraces((prev) => moveTraces(prev, uids, index));
        }
      }
    } catch {
      /* 非法数据：忽略 */
    }
  };

  const onRowDragStart = (e: DragEvent, row: Row) => {
    const uids = live.current.selected.has(row.key) ? selectedTraceUids(true) : new Set([row.trace.uid]);
    e.dataTransfer.setData(DND_ROWS, JSON.stringify([...uids]));
    e.dataTransfer.effectAllowed = 'move';
  };

  // ------------------------------------------------------------------------
  // 列宽调整

  const startColResize = (which: 'names' | 'values') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = which === 'names' ? namesW : valuesW;
    const move = (ev: PointerEvent) => {
      const w = Math.max(70, Math.min(480, w0 + ev.clientX - x0));
      setCols((c) => ({ ...c, [which]: w }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      setCols((c) => {
        try {
          localStorage.setItem(COLS_KEY, JSON.stringify(c));
        } catch {
          /* ignore */
        }
        return c;
      });
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------------------
  // 右键菜单

  const openMenu = (e: ReactMouseEvent, row: Row) => {
    e.preventDefault();
    if (!selected.has(row.key)) {
      setSelected(new Set([row.key]));
      anchorRef.current = row.key;
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };

  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null);
      return;
    }
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 300;
    setMenuPos({
      left: Math.max(4, Math.min(window.innerWidth - w - 4, menu.x)),
      top: Math.max(4, Math.min(window.innerHeight - h - 4, menu.y)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const menuTargets = useMemo(() => {
    const uids = new Set<number>();
    for (const r of rows) if (selected.has(r.key)) uids.add(r.trace.uid);
    return rows.filter((r) => r.bit === null && uids.has(r.trace.uid));
  }, [rows, selected]);

  const renderMenu = () => {
    if (!menu || !menuTargets.length) return null;
    const uids = new Set(menuTargets.map((r) => r.trace.uid));
    const vecTargets = menuTargets.filter((r) => r.wave.kind === 'vec');
    const curRadix = vecTargets[0]?.trace.radix;
    const expandable = menuTargets.filter((r) => canExpand(r.wave));
    const allExpanded = expandable.length > 0 && expandable.every((r) => r.trace.expanded);
    const analogable = menuTargets.filter((r) => canAnalog(r.wave));
    const allAnalog = analogable.length > 0 && analogable.every((r) => r.trace.analog);
    const act = (fn: () => void) => () => {
      fn();
      setMenu(null);
    };
    const title = menuTargets.length === 1 ? menuTargets[0].label : `${menuTargets.length} 个信号`;
    return (
      <div
        ref={menuRef}
        className="popover menu wv-menu"
        style={menuPos ? { left: menuPos.left, top: menuPos.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="menu-header wv-menu-title">{title}</div>
        {vecTargets.length > 0 && (
          <>
            <div className="menu-header">进制</div>
            {RADIXES.map((r) => (
              <div
                key={r.id}
                className="menu-item"
                onClick={act(() =>
                  updateTraces(
                    new Set(vecTargets.map((t) => t.trace.uid)),
                    (t) => ({ ...t, radix: r.id }),
                  ),
                )}
              >
                <span className="menu-icon">{curRadix === r.id && <Check size={14} strokeWidth={1.75} />}</span>
                <span className="menu-label">{r.label}</span>
                <span className="menu-shortcut">{r.short}</span>
              </div>
            ))}
            <div className="menu-sep" />
          </>
        )}
        {expandable.length > 0 && (
          <div
            className="menu-item"
            onClick={act(() =>
              updateTraces(
                new Set(expandable.map((r) => r.trace.uid)),
                (t) => ({ ...t, expanded: !allExpanded }),
              ),
            )}
          >
            <span className="menu-icon">
              {allExpanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
            </span>
            <span className="menu-label">{allExpanded ? '折叠位' : '展开为位'}</span>
          </div>
        )}
        {analogable.length > 0 && (
          <div
            className="menu-item"
            onClick={act(() =>
              updateTraces(
                new Set(analogable.map((r) => r.trace.uid)),
                (t) => ({ ...t, analog: !allAnalog }),
              ),
            )}
          >
            <span className="menu-icon">{allAnalog && <Check size={14} strokeWidth={1.75} />}</span>
            <span className="menu-label">模拟波形（阶梯）</span>
          </div>
        )}
        {(expandable.length > 0 || analogable.length > 0) && <div className="menu-sep" />}
        <div className="menu-item" onClick={act(() => removeTraces(uids))}>
          <span className="menu-icon">
            <X size={14} strokeWidth={1.75} />
          </span>
          <span className="menu-label">移除</span>
          <span className="menu-shortcut">Delete</span>
        </div>
      </div>
    );
  };

  // ------------------------------------------------------------------------
  // 下载

  const download = () => {
    if (!vcdText) return;
    const blob = new Blob([vcdText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'dump.vcd';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ------------------------------------------------------------------------
  // 渲染

  const [first, last] = visibleRange(rows, scrollTop, viewH, 6);
  const visibleRows = rows.slice(first, last + 1);

  const firstSelVec = rows.find((r) => selected.has(r.key) && r.bit === null && r.wave.kind === 'vec');
  const radixValue: Radix = firstSelVec ? firstSelVec.trace.radix : defaultRadix;

  const filterMatches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    data.vars.forEach((v, i) => {
      if (v.path.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [filter, data]);

  const cursorText = cursor !== null ? formatTime(cursor, fsUnit) : '—';
  const deltaText = cursor !== null && marker !== null ? formatTime(Math.abs(cursor - marker), fsUnit) : null;

  const warnTitle = data.warnings.length ? data.warnings.join('\n') : '';

  const rowStyle = (r: Row): CSSProperties => ({ top: r.top, height: r.height });

  return (
    <div ref={rootRef} className={`wv-view${compact ? ' wv-compact' : ''}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="wv-toolbar">
        <button
          className={`icon-btn${treeOpen ? ' active' : ''}`}
          title={treeOpen ? '隐藏信号树' : '显示信号树'}
          onClick={() => setTreePref(!treeOpen)}
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
        <span className="wv-tb-sep" />
        <button className="icon-btn" title="放大（+）" onClick={() => zoomAt(2)} disabled={!zoomInfo.canIn}>
          <ZoomIn size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" title="缩小（-）" onClick={() => zoomAt(0.5)} disabled={!zoomInfo.canOut}>
          <ZoomOut size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" title="适应窗口（F）" onClick={fit}>
          <Maximize2 size={15} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" title="缩放到光标" onClick={zoomToCursor} disabled={cursor === null}>
          <Crosshair size={16} strokeWidth={1.75} />
        </button>
        <span className="wv-tb-sep" />
        <button className="icon-btn" title="上一个跳变（←）" onClick={() => gotoEdge(-1)} disabled={!rows.length}>
          <StepBack size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" title="下一个跳变（→）" onClick={() => gotoEdge(1)} disabled={!rows.length}>
          <StepForward size={16} strokeWidth={1.75} />
        </button>
        <span className="wv-tb-sep" />
        <select
          className="input wv-radix"
          title={firstSelVec ? '选中信号的进制' : '所有信号的进制'}
          value={radixValue}
          onChange={(e) => isRadix(e.target.value) && applyRadix(e.target.value)}
        >
          {RADIXES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="添加全部信号" onClick={addAll} disabled={!data.vars.length}>
          <ListPlus size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" title="清空信号列表" onClick={clearAll} disabled={!traces.length}>
          <ListX size={16} strokeWidth={1.75} />
        </button>
        <label className="wv-search" title="过滤信号树；回车添加全部匹配">
          <Search size={14} strokeWidth={1.75} />
          <input
            value={filter}
            placeholder="查找信号"
            onChange={(e) => {
              setFilter(e.target.value);
              if (e.target.value && !treeOpen) setTreePref(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filterMatches.length) addVars(filterMatches);
                else toast('没有匹配的信号');
              } else if (e.key === 'Escape') setFilter('');
            }}
          />
        </label>
        <span className="wv-tb-spacer" />
        {(data.truncated || data.warnings.length > 0) && (
          <span className="wv-warn" title={warnTitle || 'VCD 不完整'}>
            <TriangleAlert size={14} strokeWidth={1.75} />
            {data.truncated ? '不完整' : `${data.warnings.length} 条警告`}
          </span>
        )}
        <span className="wv-time" title="光标位置；Shift+单击或中键放置标记以测量 Δ">
          <span>
            光标 = <b>{cursorText}</b>
          </span>
          {deltaText !== null && (
            <span>
              Δ = <b>{deltaText}</b>
            </span>
          )}
        </span>
        <button className="icon-btn" title="下载 VCD" onClick={download} disabled={!vcdText}>
          <Download size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="wv-body">
        {treeOpen && (
          <aside className="wv-tree">
            <SignalTree
              data={data}
              filter={filter}
              onFilterChange={setFilter}
              added={addedPaths}
              onAdd={(ix) => addVars(ix)}
              onClose={() => setTreePref(false)}
            />
          </aside>
        )}
        <div className="wv-main">
          <div className="wv-head">
            <div className="wv-head-cell wv-names-h" style={{ width: namesW }}>
              <span>信号</span>
              <span className="badge">{traces.length}</span>
              <div className="wv-col-resize" onPointerDown={startColResize('names')} />
            </div>
            <div className="wv-head-cell wv-values-h" style={{ width: valuesW }}>
              <span>值</span>
              <div className="wv-col-resize" onPointerDown={startColResize('values')} />
            </div>
            <div className="wv-ruler">
              <canvas
                ref={rulerRef}
                onPointerDown={onRulerPointerDown}
                onPointerMove={onRulerPointerMove}
                onPointerUp={onRulerPointerUp}
                onPointerCancel={onRulerPointerUp}
                title="单击放置光标；拖动选择范围放大；滚轮缩放"
              />
            </div>
          </div>
          <div
            ref={scrollRef}
            className="wv-scroll"
            onScroll={(e) => {
              setScrollTop(e.currentTarget.scrollTop);
              drawRef.current();
            }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div ref={contentRef} className="wv-content" style={{ height: Math.max(total, viewH) }}>
              <div className="wv-names" style={{ width: namesW }}>
                {visibleRows.map((r) => (
                  <div
                    key={r.key}
                    className={`wv-name-row${selected.has(r.key) ? ' selected' : ''}${r.bit !== null ? ' wv-bit-row' : ''}`}
                    style={rowStyle(r)}
                    title={`${r.bit !== null ? (r.v.scope ? `${r.v.scope}.${r.label}` : r.label) : r.v.path + r.v.range}  ·  ${r.v.type} ${r.bit !== null ? 1 : r.v.width} 位`}
                    draggable={r.bit === null}
                    onDragStart={(e) => onRowDragStart(e, r)}
                    onPointerDown={() => rootRef.current?.focus({ preventScroll: true })}
                    onClick={(e) => selectRow(r.key, e)}
                    onDoubleClick={() => {
                      if (r.bit === null && canExpand(r.wave)) updateTraces(new Set([r.trace.uid]), (t) => ({ ...t, expanded: !t.expanded }));
                    }}
                    onContextMenu={(e) => openMenu(e, r)}
                  >
                    {r.bit === null && canExpand(r.wave) ? (
                      <button
                        className="wv-expand"
                        title={r.trace.expanded ? '折叠位' : '展开为位'}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateTraces(new Set([r.trace.uid]), (t) => ({ ...t, expanded: !t.expanded }));
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {r.trace.expanded ? <ChevronDown size={13} strokeWidth={1.75} /> : <ChevronRight size={13} strokeWidth={1.75} />}
                      </button>
                    ) : (
                      <span className="wv-expand-pad" />
                    )}
                    <span className="wv-name-text">{r.label}</span>
                    {r.bit === null && r.wave.kind === 'vec' && !r.trace.analog && (
                      <span className="wv-radix-tag">{RADIXES.find((x) => x.id === r.trace.radix)?.short}</span>
                    )}
                    {r.trace.analog && r.bit === null && <span className="wv-radix-tag">~</span>}
                  </div>
                ))}
              </div>
              <div className="wv-values" style={{ width: valuesW }}>
                {cursor !== null &&
                  visibleRows.map((r) => {
                    const text = valueAtText(r.wave, cursor, r.trace.radix);
                    const st = valueStateAt(r.wave, indexAt(r.wave, cursor));
                    return (
                      <div
                        key={r.key}
                        className={`wv-value-row${selected.has(r.key) ? ' selected' : ''} wv-st-${st}`}
                        style={rowStyle(r)}
                        title={text}
                        onClick={(e) => selectRow(r.key, e)}
                        onContextMenu={(e) => openMenu(e, r)}
                      >
                        {text}
                      </div>
                    );
                  })}
              </div>
              <div ref={waveColRef} className="wv-wavecol">
                <div className="wv-sticky" style={{ height: viewH }}>
                  <canvas
                    ref={canvasRef}
                    className="wv-canvas"
                    onPointerDown={onWavePointerDown}
                    onPointerMove={onWavePointerMove}
                    onPointerUp={onWavePointerUp}
                    onPointerCancel={() => (dragRef.current = null)}
                    onContextMenu={(e) => e.preventDefault()}
                    onAuxClick={(e) => e.preventDefault()}
                  />
                  {rows.length === 0 && (
                    <div className="wv-hint">
                      {treeOpen ? '在左侧信号树中双击或拖入信号' : '点击左上角按钮打开信号树添加信号'}
                    </div>
                  )}
                </div>
              </div>
              {dropY !== null && <div className="wv-drop-line" style={{ top: dropY }} />}
            </div>
          </div>
          <div className="wv-hbar">
            <div style={{ width: namesW + valuesW, flex: 'none' }} />
            <div ref={trackRef} className="wv-track" onPointerDown={onTrackPointerDown}>
              <div
                ref={thumbRef}
                className="wv-thumb"
                onPointerDown={onThumbPointerDown}
                onPointerMove={onThumbPointerMove}
                onPointerUp={onThumbPointerUp}
                onPointerCancel={onThumbPointerUp}
              />
            </div>
          </div>
          {busy && (
            <div className="wv-busy">
              <span className="wv-busy-spin" />
              {busyLabel ?? '仿真中…'}
            </div>
          )}
        </div>
      </div>
      {renderMenu()}
    </div>
  );
}
