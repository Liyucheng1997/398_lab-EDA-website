import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileDown,
  ImageDown,
  Maximize,
  Search,
  TriangleAlert,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from '../../ui/toast';
import { buildExportSvg, downloadBlob, svgToPng } from './exportImage';
import {
  cellNameFromId,
  centerOn,
  fitTransform,
  matchesQuery,
  nearestSegment,
  netClassOf,
  netWidth,
  safeFileName,
  toContent,
  type Segment,
  type ViewTransform,
} from './geometry';
import { parseSvg, SvgParseError } from './sanitize';
import { usePanZoom } from './usePanZoom';
import './schematic.css';

export interface SchematicViewerProps {
  /** netlistsvg 生成的 SVG 文本；null = 暂无 */
  svg: string | null;
  loading?: boolean;
  /** 显示在工具栏上的标题，如模块名 */
  title?: string;
  /** 可切换的模块列表（层次化原理图）；选择后回调 */
  modules?: string[];
  currentModule?: string;
  onSelectModule?: (module: string) => void;
  className?: string;
  /** 没有 SVG 时的提示文字 */
  emptyText?: string;
  /** 外部错误（如生成原理图失败），优先于空状态显示 */
  error?: string | null;
  /** 选中单元/网络时回调（null = 取消选择） */
  onSelectionChange?: (sel: SchematicSelection | null) => void;
}

export type SchematicSelection =
  | { kind: 'net'; net: string; width: number; segments: number }
  | { kind: 'cell'; name: string; type: string; label: string };

interface CellEntry {
  name: string;
  el: Element;
  /** s:type，如 generic / and / dff / inputExt */
  type: string;
  /** 单元标签（nodelabel 文本）：子模块类型名或端口名 */
  label: string;
}

interface SchIndex {
  netEls: Map<string, Element[]>;
  segs: Segment[];
  segNet: string[];
  cells: CellEntry[];
  cellByEl: Map<Element, CellEntry>;
  texts: { label: string; el: Element; cell: Element | null }[];
  /** 用户坐标 → 内容坐标：content = (user - o) * s */
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

type Phase = 'empty' | 'parsing' | 'ready' | 'error';

const MIN_K = 0.02;
const MAX_K = 16;
const MAX_HIGHLIGHT = 5000;

function buildIndex(svg: SVGSVGElement, width: number, height: number, vb: { x: number; y: number; w: number; h: number }): SchIndex {
  const idx: SchIndex = {
    netEls: new Map(),
    segs: [],
    segNet: [],
    cells: [],
    cellByEl: new Map(),
    texts: [],
    sx: width / vb.w,
    sy: height / vb.h,
    ox: vb.x,
    oy: vb.y,
    width,
    height,
  };
  const all = svg.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const name = el.localName;
    const cls = el.getAttribute('class');
    const net = netClassOf(cls);
    if (net) {
      let list = idx.netEls.get(net);
      if (!list) idx.netEls.set(net, (list = []));
      list.push(el);
      if (name === 'line' && el.parentNode === svg) {
        const x1 = Number(el.getAttribute('x1'));
        const y1 = Number(el.getAttribute('y1'));
        const x2 = Number(el.getAttribute('x2'));
        const y2 = Number(el.getAttribute('y2'));
        if ([x1, y1, x2, y2].every(Number.isFinite)) {
          idx.segs.push({ x1, y1, x2, y2 });
          idx.segNet.push(net);
        }
      }
    }
    if (name === 'g') {
      const cellName = cellNameFromId(el.getAttribute('id'));
      if (cellName != null) {
        const labelEl = el.querySelector(':scope > text.nodelabel');
        const entry: CellEntry = {
          name: cellName,
          el,
          type: el.getAttributeNS('https://github.com/nturley/netlistsvg', 'type') ?? el.getAttribute('s:type') ?? '',
          label: labelEl?.textContent?.trim() ?? '',
        };
        idx.cells.push(entry);
        idx.cellByEl.set(el, entry);
      }
    } else if (name === 'text') {
      const label = el.textContent?.trim() ?? '';
      if (label) idx.texts.push({ label, el, cell: el.closest('g[id^="cell_"]') });
    }
  }
  return idx;
}

function toggleClass(els: Iterable<Element> | undefined, cls: string, on: boolean) {
  if (!els) return;
  for (const el of els) el.classList.toggle(cls, on);
}

const CELL_TYPE_LABEL: Record<string, string> = {
  inputExt: '输入端口',
  outputExt: '输出端口',
  constant: '常量',
  split: '总线拆分',
  join: '总线合并',
  generic: '单元',
  dff: '触发器',
  mux: '多路选择器',
};

/** 原理图查看器：显示 netlistsvg SVG，支持平移缩放、搜索、网络高亮、导出 */
export function SchematicViewer({
  svg,
  loading = false,
  title,
  modules,
  currentModule,
  onSelectModule,
  className,
  emptyText = '暂无原理图',
  error,
  onSelectionChange,
}: SchematicViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<SchIndex | null>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);
  const autoFit = useRef(true);
  const hoverNet = useRef<string | null>(null);
  const hoverCell = useRef<Element | null>(null);
  const selectedRef = useRef<{ net?: string; cell?: Element } | null>(null);
  const hitsRef = useRef<Element[]>([]);
  const hitIdxRef = useRef(0);
  const zoomPctRef = useRef(100);

  const [phase, setPhase] = useState<Phase>('empty');
  const [parseError, setParseError] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [stats, setStats] = useState<{ cells: number; nets: number; removed: number } | null>(null);
  const [selection, setSelection] = useState<SchematicSelection | null>(null);
  const [query, setQuery] = useState('');
  const [hitCount, setHitCount] = useState(0);
  const [hitIdx, setHitIdx] = useState(0);
  const [exporting, setExporting] = useState<null | 'svg' | 'png'>(null);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const applyTransform = useCallback((t: ViewTransform, interacting: boolean) => {
    const c = contentRef.current;
    if (c) {
      c.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
      c.classList.toggle('is-interacting', interacting);
    }
    const pct = Math.round(t.k * 100);
    if (pct !== zoomPctRef.current) {
      zoomPctRef.current = pct;
      setZoomPct(pct);
    }
  }, []);

  /* ───────── 命中测试 ───────── */

  const pickAt = useCallback((clientX: number, clientY: number, target: Element | null): { net?: string; cell?: CellEntry } => {
    const idx = indexRef.current;
    const vp = viewportRef.current;
    if (!idx || !vp) return {};
    const content = contentRef.current;
    if (target && content?.contains(target)) {
      const net = netClassOf(target.getAttribute('class'));
      if (net) return { net };
    }
    // 细线难点中：在 6 屏幕像素范围内找最近的连线
    const r = vp.getBoundingClientRect();
    const t = tRef.current;
    const c = toContent(t, clientX - r.left, clientY - r.top);
    const ux = c.x / idx.sx + idx.ox;
    const uy = c.y / idx.sy + idx.oy;
    const tol = 6 / (t.k * Math.min(idx.sx, idx.sy));
    const i = nearestSegment(idx.segs, ux, uy, tol);
    if (i >= 0) return { net: idx.segNet[i] };
    if (target && content?.contains(target)) {
      const g = target.closest('g[id^="cell_"]');
      const entry = g ? idx.cellByEl.get(g) : undefined;
      if (entry) return { cell: entry };
    }
    return {};
    // tRef 来自 usePanZoom，稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setHover = useCallback((net: string | null, cell: Element | null) => {
    const idx = indexRef.current;
    if (hoverNet.current !== net) {
      if (hoverNet.current) toggleClass(idx?.netEls.get(hoverNet.current), 'sch-net-hover', false);
      if (net) toggleClass(idx?.netEls.get(net), 'sch-net-hover', true);
      hoverNet.current = net;
    }
    if (hoverCell.current !== cell) {
      hoverCell.current?.classList.remove('sch-cell-hover');
      cell?.classList.add('sch-cell-hover');
      hoverCell.current = cell;
    }
    viewportRef.current?.classList.toggle('is-pointing', !!(net || cell));
  }, []);

  const clearSelection = useCallback(() => {
    const idx = indexRef.current;
    const sel = selectedRef.current;
    if (sel?.net) toggleClass(idx?.netEls.get(sel.net), 'sch-net-sel', false);
    sel?.cell?.classList.remove('sch-cell-sel');
    selectedRef.current = null;
    setSelection(null);
    onSelectionChangeRef.current?.(null);
  }, []);

  const select = useCallback(
    (pick: { net?: string; cell?: CellEntry }) => {
      const idx = indexRef.current;
      clearSelection();
      if (!idx) return;
      if (pick.net) {
        const els = idx.netEls.get(pick.net) ?? [];
        toggleClass(els, 'sch-net-sel', true);
        selectedRef.current = { net: pick.net };
        const segments = els.filter((e) => e.localName === 'line').length;
        const s: SchematicSelection = { kind: 'net', net: pick.net, width: netWidth(pick.net), segments };
        setSelection(s);
        onSelectionChangeRef.current?.(s);
      } else if (pick.cell) {
        pick.cell.el.classList.add('sch-cell-sel');
        selectedRef.current = { cell: pick.cell.el };
        const s: SchematicSelection = { kind: 'cell', name: pick.cell.name, type: pick.cell.type, label: pick.cell.label };
        setSelection(s);
        onSelectionChangeRef.current?.(s);
      }
    },
    [clearSelection],
  );

  const { tRef, setTransform, zoomBy } = usePanZoom(viewportRef, {
    minK: MIN_K,
    maxK: MAX_K,
    onTransform: applyTransform,
    onUserInteract: () => {
      autoFit.current = false;
    },
    onTap: (e) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const pick = pickAt(e.clientX, e.clientY, target);
      if (pick.net || pick.cell) select(pick);
      else clearSelection();
      viewportRef.current?.focus({ preventScroll: true });
    },
    onHover: (e) => {
      if (!e) return setHover(null, null);
      const pick = pickAt(e.clientX, e.clientY, e.target as Element | null);
      setHover(pick.net ?? null, pick.cell?.el ?? null);
    },
    onFit: () => fit(),
    onActualSize: () => actualSize(),
  });

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const idx = indexRef.current;
    if (!vp || !idx) return;
    autoFit.current = true;
    setTransform(fitTransform(idx.width, idx.height, vp.clientWidth, vp.clientHeight, 24, MIN_K, 1));
  }, [setTransform]);

  const actualSize = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    autoFit.current = false;
    const t = tRef.current;
    const c = toContent(t, vp.clientWidth / 2, vp.clientHeight / 2);
    setTransform(centerOn({ ...t, k: 1 }, c.x, c.y, vp.clientWidth, vp.clientHeight));
  }, [setTransform, tRef]);

  /* ───────── 载入 SVG ───────── */

  useLayoutEffect(() => {
    const content = contentRef.current;
    indexRef.current = null;
    svgElRef.current = null;
    hoverNet.current = null;
    hoverCell.current = null;
    selectedRef.current = null;
    hitsRef.current = [];
    setSelection(null);
    setHitCount(0);
    setHitIdx(0);
    setParseError(null);
    content?.replaceChildren();
    if (!svg) {
      setPhase('empty');
      setStats(null);
      return;
    }
    setPhase('parsing');
    let cancelled = false;
    // 让“解析中”先绘制出来再做重活（大 SVG 可达数 MB）
    const timer = window.setTimeout(() => {
      if (cancelled || !contentRef.current) return;
      try {
        const parsed = parseSvg(svg);
        const el = parsed.svg;
        el.setAttribute('width', String(parsed.width));
        el.setAttribute('height', String(parsed.height));
        el.classList.add('sch-svg');
        el.setAttribute('aria-label', title ? `${title} 原理图` : '原理图');
        el.setAttribute('role', 'img');
        contentRef.current.replaceChildren(el);
        svgElRef.current = el;
        const idx = buildIndex(el, parsed.width, parsed.height, parsed.viewBox);
        indexRef.current = idx;
        setStats({ cells: idx.cells.length, nets: idx.netEls.size, removed: parsed.report.removedElements });
        autoFit.current = true;
        const vp = viewportRef.current;
        if (vp && vp.clientWidth > 0) setTransform(fitTransform(idx.width, idx.height, vp.clientWidth, vp.clientHeight, 24, MIN_K, 1));
        setPhase('ready');
      } catch (err) {
        setParseError(err instanceof SvgParseError ? err.message : `原理图显示失败：${err instanceof Error ? err.message : String(err)}`);
        setPhase('error');
        setStats(null);
      }
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // title 只用于 aria-label，不应触发重新解析
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, setTransform]);

  // 视口尺寸变化：仍处于“自动适配”状态时重新适配
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (autoFit.current && indexRef.current && vp.clientWidth > 0 && vp.clientHeight > 0) {
        const idx = indexRef.current;
        setTransform(fitTransform(idx.width, idx.height, vp.clientWidth, vp.clientHeight, 24, MIN_K, 1));
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [setTransform]);

  /* ───────── 搜索 ───────── */

  const focusElement = useCallback(
    (el: Element) => {
      const vp = viewportRef.current;
      const content = contentRef.current;
      if (!vp || !content) return;
      const r = el.getBoundingClientRect();
      const vr = vp.getBoundingClientRect();
      let t = tRef.current;
      const c = toContent(t, r.left + r.width / 2 - vr.left, r.top + r.height / 2 - vr.top);
      if (t.k < 0.8) t = { ...t, k: 1 };
      autoFit.current = false;
      content.classList.add('sch-animate');
      setTransform(centerOn(t, c.x, c.y, vp.clientWidth, vp.clientHeight));
      window.setTimeout(() => content.classList.remove('sch-animate'), 260);
    },
    [setTransform, tRef],
  );

  useEffect(() => {
    const idx = indexRef.current;
    const clear = () => {
      for (const el of hitsRef.current) el.classList.remove('sch-hit', 'sch-hit-cur');
      hitsRef.current = [];
    };
    if (phase !== 'ready' || !idx) {
      clear();
      return;
    }
    const q = query.trim();
    const timer = window.setTimeout(
      () => {
        clear();
        if (!q) {
          setHitCount(0);
          setHitIdx(0);
          return;
        }
        const hits: Element[] = [];
        const hitCells = new Set<Element>();
        for (const c of idx.cells) {
          if (matchesQuery(c.name, q) || matchesQuery(c.label, q)) {
            hits.push(c.el);
            hitCells.add(c.el);
          }
        }
        for (const t of idx.texts) {
          if ((!t.cell || !hitCells.has(t.cell)) && matchesQuery(t.label, q)) hits.push(t.el);
        }
        // 按文档顺序排列，保证 上一个/下一个 的顺序稳定
        hits.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        for (let i = 0; i < hits.length && i < MAX_HIGHLIGHT; i++) hits[i].classList.add('sch-hit');
        hitsRef.current = hits;
        hitIdxRef.current = 0;
        setHitCount(hits.length);
        setHitIdx(0);
        if (hits.length) {
          hits[0].classList.add('sch-hit-cur');
          focusElement(hits[0]);
        }
      },
      q.length > 0 && idx.texts.length > 20000 ? 260 : 120,
    );
    return () => window.clearTimeout(timer);
  }, [query, phase, focusElement]);

  const gotoHit = useCallback(
    (delta: number) => {
      const hits = hitsRef.current;
      if (!hits.length) return;
      const i = hitIdxRef.current;
      const n = (((i + delta) % hits.length) + hits.length) % hits.length;
      hits[i]?.classList.remove('sch-hit-cur');
      hits[n].classList.add('sch-hit', 'sch-hit-cur');
      hitIdxRef.current = n;
      setHitIdx(n);
      focusElement(hits[n]);
    },
    [focusElement],
  );

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gotoHit(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      setQuery('');
      viewportRef.current?.focus({ preventScroll: true });
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const onViewerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && phase === 'ready') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (e.key === 'Escape' && e.target === viewportRef.current) {
      clearSelection();
    }
  };

  /* ───────── 双击进入子模块 ───────── */

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!modules?.length || !onSelectModule) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const g = target?.closest('g[id^="cell_"]');
    const entry = g ? indexRef.current?.cellByEl.get(g) : undefined;
    if (entry && entry.label && modules.includes(entry.label) && entry.label !== currentModule) {
      onSelectModule(entry.label);
    }
  };

  /* ───────── 导出 ───────── */

  const baseName = safeFileName(title || currentModule || 'schematic');

  const exportSvg = () => {
    const el = svgElRef.current;
    const idx = indexRef.current;
    if (!el || !idx) return;
    try {
      const text = buildExportSvg(el, idx.width, idx.height);
      downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
    } catch (err) {
      toast(`导出 SVG 失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const exportPng = async () => {
    const el = svgElRef.current;
    const idx = indexRef.current;
    if (!el || !idx || exporting) return;
    setExporting('png');
    try {
      const text = buildExportSvg(el, idx.width, idx.height);
      const blob = await svgToPng(text, idx.width, idx.height, 2);
      downloadBlob(blob, `${baseName}.png`);
    } catch (err) {
      toast(`导出 PNG 失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  /* ───────── 渲染 ───────── */

  const ready = phase === 'ready';
  const heading = title ?? currentModule ?? '原理图';
  const showModules = !!modules && modules.length > 0 && !!onSelectModule;
  const externalError = error && !loading ? error : null;

  let overlay: ReactNode = null;
  if (externalError) {
    overlay = (
      <div className="sch-state">
        <TriangleAlert size={30} strokeWidth={1.4} className="sch-state-err" />
        <span>{externalError}</span>
      </div>
    );
  } else if (loading && !ready) {
    overlay = (
      <div className="sch-state">
        <div className="spinner" />
        <span>正在生成原理图…</span>
      </div>
    );
  } else if (phase === 'parsing') {
    overlay = (
      <div className="sch-state">
        <div className="spinner" />
        <span>正在解析原理图…</span>
      </div>
    );
  } else if (phase === 'error') {
    overlay = (
      <div className="sch-state">
        <TriangleAlert size={30} strokeWidth={1.4} className="sch-state-err" />
        <span>{parseError}</span>
      </div>
    );
  } else if (phase === 'empty') {
    overlay = (
      <div className="sch-state">
        <Workflow size={34} strokeWidth={1.4} />
        <span>{emptyText}</span>
      </div>
    );
  }

  const cellModule = selection?.kind === 'cell' && modules?.includes(selection.label) && selection.label !== currentModule;

  return (
    <div className={`sch-viewer${className ? ' ' + className : ''}`} onKeyDown={onViewerKey}>
      <div className="sch-toolbar">
        <div className="sch-title" title={heading}>
          <Workflow size={15} strokeWidth={1.75} className="sch-title-ico" />
          <span>{heading}</span>
        </div>
        {showModules && (
          <select
            className="input sch-select"
            value={currentModule ?? ''}
            onChange={(e) => e.target.value && onSelectModule!(e.target.value)}
            aria-label="选择模块"
            title="选择要查看的模块"
          >
            {currentModule == null || !modules!.includes(currentModule) ? <option value="">选择模块…</option> : null}
            {modules!.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <div className={`sch-search${query ? ' has-query' : ''}`}>
          <Search size={14} strokeWidth={1.75} className="sch-search-ico" />
          <input
            ref={searchRef}
            className="sch-search-input"
            placeholder="搜索单元 / 端口"
            value={query}
            disabled={!ready}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label="搜索原理图"
            spellCheck={false}
          />
          {query && (
            <>
              <span className="sch-search-count tabular">{hitCount ? `${hitIdx + 1}/${hitCount}` : '无结果'}</span>
              <button className="icon-btn sch-mini" onClick={() => gotoHit(-1)} disabled={hitCount < 2} title="上一个 (Shift+Enter)">
                <ChevronUp size={14} strokeWidth={1.75} />
              </button>
              <button className="icon-btn sch-mini" onClick={() => gotoHit(1)} disabled={hitCount < 2} title="下一个 (Enter)">
                <ChevronDown size={14} strokeWidth={1.75} />
              </button>
              <button className="icon-btn sch-mini" onClick={() => setQuery('')} title="清除搜索">
                <X size={14} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>
        <div className="sch-spacer" />
        <div className="sch-group">
          <button className="icon-btn" onClick={() => zoomBy(0.8)} disabled={!ready} title="缩小 (-)">
            <ZoomOut size={16} strokeWidth={1.75} />
          </button>
          <button className="sch-zoom tabular" onClick={actualSize} disabled={!ready} title="实际大小 100% (1)">
            {zoomPct}%
          </button>
          <button className="icon-btn" onClick={() => zoomBy(1.25)} disabled={!ready} title="放大 (+)">
            <ZoomIn size={16} strokeWidth={1.75} />
          </button>
          <button className="icon-btn" onClick={fit} disabled={!ready} title="适配窗口 (0)">
            <Maximize size={15} strokeWidth={1.75} />
          </button>
        </div>
        <div className="sch-sep" />
        <div className="sch-group">
          <button className="icon-btn" onClick={exportSvg} disabled={!ready} title="导出 SVG">
            <FileDown size={16} strokeWidth={1.75} />
          </button>
          <button className="icon-btn" onClick={exportPng} disabled={!ready || !!exporting} title="导出 PNG（2×）">
            <ImageDown size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`sch-viewport${ready ? ' is-ready' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="原理图画布：拖动平移，Ctrl+滚轮缩放"
        onDoubleClick={onDoubleClick}
      >
        <div ref={contentRef} className={`sch-content${phase === 'error' || externalError ? ' is-hidden' : ''}`} />
        {overlay}
        {loading && ready && (
          <div className="sch-busy" data-panzoom-ignore>
            <div className="spinner sch-spinner-sm" />
            正在更新…
          </div>
        )}
      </div>

      <div className="sch-statusbar">
        <span className="sch-status-main">
          {selection?.kind === 'net' ? (
            <>
              <i className="sch-dot" />
              网络 · {selection.width} 位 · {selection.segments} 段连线
            </>
          ) : selection?.kind === 'cell' ? (
            <>
              <i className="sch-dot" />
              <b className="sch-mono">{selection.name}</b>
              <span className="muted">
                {CELL_TYPE_LABEL[selection.type] ?? selection.type}
                {selection.label && selection.label !== selection.name ? ` · ${selection.label}` : ''}
              </span>
              {cellModule && <span className="muted">· 双击进入子模块</span>}
            </>
          ) : ready ? (
            <span className="muted">单击连线高亮整个网络 · 拖动平移 · Ctrl+滚轮缩放</span>
          ) : null}
        </span>
        {stats && (
          <span className="sch-status-stats muted tabular">
            {stats.cells} 单元 · {stats.nets} 网络
          </span>
        )}
      </div>
    </div>
  );
}
