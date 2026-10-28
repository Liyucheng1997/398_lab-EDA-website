import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Cable, Cpu, Maximize, Pin, Search, TriangleAlert, X, ZoomIn, ZoomOut } from 'lucide-react';
import { getDevice, type PlacementInfo } from '@webeda/shared';
import { cssVar, useTheme } from '../../lib/theme';
import {
  buildDeviceModel,
  categoryOf,
  slotRect,
  TILE_DSP,
  TILE_EMPTY,
  TILE_IO,
  TILE_KIND_LABEL,
  TILE_LOGIC,
  TILE_RAM,
  tileRow,
  hitTile,
  typeLabel,
  withAlpha,
  type CellCategory,
  type DeviceModel,
  type TileData,
  type TileKind,
} from './deviceModel';
import { centerOn, fitTransform, toContent, type ViewTransform } from './geometry';
import { usePanZoom } from './usePanZoom';
import './schematic.css';

export interface DeviceViewProps {
  placement: PlacementInfo | null;
  loading?: boolean;
  className?: string;
  /** 没有布局数据时的提示 */
  emptyText?: string;
  /** 外部错误（如实现失败） */
  error?: string | null;
  /** 需要高亮的单元名（如时序路径上的单元） */
  highlightCells?: string[];
  /** 选中（固定）tile 时回调 */
  onSelectTile?: (tile: { x: number; y: number; cells: PlacementInfo['cells'] } | null) => void;
}

interface Palette {
  bg: string;
  text: string;
  text3: string;
  primary: string;
  primarySoft: string;
  tile: Record<TileKind, string | null>;
  cat: Record<CellCategory, string>;
  wire: string;
  wireHi: string;
}

/** 分类的绘制形状：PLL / GB 用圆点，其余方块 */
const ROUND: Partial<Record<CellCategory, boolean>> = { PLL: true, GB: true };
const CAT_LABEL: Record<CellCategory, string> = {
  logic: '逻辑',
  IO: 'IO',
  RAM: 'RAM',
  DSP: 'DSP',
  PLL: 'PLL',
  GB: '全局缓冲',
  OTHER: '其他',
};

function readPalette(): Palette {
  const text = cssVar('--text') || '#1d1d1f';
  const primary = cssVar('--primary') || '#0071e3';
  return {
    bg: cssVar('--panel') || '#fff',
    text,
    text3: cssVar('--text-3') || '#86868b',
    primary,
    primarySoft: withAlpha(primary, 0.18),
    tile: {
      [TILE_EMPTY]: null,
      [TILE_LOGIC]: withAlpha(text, 0.055),
      [TILE_IO]: withAlpha(text, 0.11),
      [TILE_RAM]: withAlpha(text, 0.15),
      [TILE_DSP]: withAlpha(text, 0.2),
    },
    cat: {
      logic: primary,
      IO: withAlpha(text, 0.8),
      RAM: withAlpha(text, 0.58),
      DSP: withAlpha(text, 0.4),
      PLL: withAlpha(text, 0.8),
      GB: withAlpha(text, 0.5),
      OTHER: withAlpha(text, 0.26),
    },
    wire: withAlpha(primary, 0.3),
    wireHi: withAlpha(primary, 0.95),
  };
}

const MIN_K = 0.5;
const MAX_K = 160;
const TOOLTIP_MAX = 10;

function key(m: DeviceModel, x: number, y: number) {
  return y * m.width + x;
}

/** 器件视图（类 Vivado Device 窗口）：画出 FPGA tile 网格与已占用的逻辑单元 */
export function DeviceView({
  placement,
  loading = false,
  className,
  emptyText = '运行实现后显示器件视图',
  error,
  highlightCells,
  onSelectTile,
}: DeviceViewProps) {
  const [theme] = useTheme();
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const paletteRef = useRef<Palette | null>(null);
  const rafRef = useRef(0);
  const autoFit = useRef(true);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);

  const [hover, setHover] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [pinned, setPinned] = useState<{ x: number; y: number } | null>(null);
  const [showWires, setShowWires] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [query, setQuery] = useState('');
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const searchPos = useRef<{ q: string; i: number }>({ q: '', i: -1 });

  const model = useMemo(() => (placement ? buildDeviceModel(placement) : null), [placement]);
  const wires = placement?.wires ?? [];
  const device = placement ? getDevice(placement.device) : undefined;

  const highlightSet = useMemo(() => new Set(highlightCells ?? []), [highlightCells]);

  /** 选中 tile 相关的网络：用于加亮连线 */
  const pinnedNets = useMemo(() => {
    const s = new Set<string>();
    if (!pinned || !wires.length) return s;
    for (const w of wires) {
      if ((Math.round(w.x1) === pinned.x && Math.round(w.y1) === pinned.y) || (Math.round(w.x2) === pinned.x && Math.round(w.y2) === pinned.y)) s.add(w.net);
    }
    return s;
  }, [pinned, wires]);

  // 状态放进 ref，供 rAF 绘制读取，避免闭包过期
  const stateRef = useRef({ model, wires, showWires, pinned, pinnedNets, highlightSet });
  stateRef.current = { model, wires, showWires, pinned, pinnedNets, highlightSet };

  /* ───────── 绘制 ───────── */

  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || w <= 0 || h <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pal = (paletteRef.current ??= readPalette());
    const { model: m, wires: ws, showWires: sw, pinned: pin, pinnedNets: pn, highlightSet: hs } = stateRef.current;
    const t = tRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!m) return;

    const k = t.k;
    const col0 = Math.max(0, Math.floor(-t.x / k));
    const col1 = Math.min(m.width - 1, Math.ceil((w - t.x) / k));
    const row0 = Math.max(0, Math.floor(-t.y / k));
    const row1 = Math.min(m.height - 1, Math.ceil((h - t.y) / k));
    const gap = k >= 6 ? Math.max(1, k * 0.07) : k >= 3 ? 0.5 : 0;
    const radius = k >= 16 ? Math.min(6, k * 0.12) : 0;
    const canRound = typeof ctx.roundRect === 'function';
    const detail = k >= 7;

    // 1) tile 底色（按类型批量填充，减少状态切换）
    for (const kind of [TILE_LOGIC, TILE_IO, TILE_RAM, TILE_DSP] as TileKind[]) {
      const color = pal.tile[kind];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let row = row0; row <= row1; row++) {
        const y = m.originBottom ? m.height - 1 - row : row;
        for (let col = col0; col <= col1; col++) {
          if (m.kinds[key(m, col, y)] !== kind) continue;
          const sx = t.x + col * k + gap / 2;
          const sy = t.y + row * k + gap / 2;
          if (radius && canRound) ctx.roundRect(sx, sy, k - gap, k - gap, radius);
          else ctx.rect(sx, sy, k - gap, k - gap);
        }
      }
      ctx.fill();
    }

    // 2) 已占用的 BEL
    const drawTile = (tile: TileData, col: number, row: number) => {
      const ox = t.x + col * k;
      const oy = t.y + row * k;
      if (!detail) {
        // 缩得很小时整格着色（取第一个单元的分类）
        const cat = categoryOf(tile.cells[0].type);
        ctx.fillStyle = pal.cat[cat];
        ctx.fillRect(ox + gap / 2, oy + gap / 2, Math.max(1, k - gap), Math.max(1, k - gap));
        return;
      }
      for (const c of tile.cells) {
        const cat = categoryOf(c.type);
        const r = slotRect(c.z, tile.slots, k);
        ctx.fillStyle = pal.cat[cat];
        if (ROUND[cat]) {
          ctx.beginPath();
          ctx.arc(ox + r.x + r.size / 2, oy + r.y + r.size / 2, r.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (r.size >= 6 && canRound) {
          ctx.beginPath();
          ctx.roundRect(ox + r.x, oy + r.y, r.size, r.size, Math.min(3, r.size * 0.2));
          ctx.fill();
        } else {
          ctx.fillRect(ox + r.x, oy + r.y, r.size, r.size);
        }
        if (hs.size && hs.has(c.name)) {
          ctx.strokeStyle = pal.text;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(ox + r.x - 1.5, oy + r.y - 1.5, r.size + 3, r.size + 3);
        }
      }
    };
    const visibleTiles = (col1 - col0 + 1) * (row1 - row0 + 1);
    if (visibleTiles < m.tiles.size) {
      for (let row = row0; row <= row1; row++) {
        const y = m.originBottom ? m.height - 1 - row : row;
        for (let col = col0; col <= col1; col++) {
          const tile = m.tiles.get(key(m, col, y));
          if (tile) drawTile(tile, col, row);
        }
      }
    } else {
      for (const tile of m.tiles.values()) {
        const row = tileRow(m, tile.y);
        if (tile.x < col0 || tile.x > col1 || row < row0 || row > row1) continue;
        drawTile(tile, tile.x, row);
      }
    }

    // 3) 连线
    if (sw && ws.length) {
      const cx = (x: number) => t.x + (x + 0.5) * k;
      const cy = (y: number) => t.y + (tileRow(m, y) + 0.5) * k;
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.wire;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const wr of ws) {
        if (pn.has(wr.net)) continue;
        ctx.moveTo(cx(wr.x1), cy(wr.y1));
        ctx.lineTo(cx(wr.x2), cy(wr.y2));
      }
      ctx.stroke();
      if (pn.size) {
        ctx.strokeStyle = pal.wireHi;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        for (const wr of ws) {
          if (!pn.has(wr.net)) continue;
          ctx.moveTo(cx(wr.x1), cy(wr.y1));
          ctx.lineTo(cx(wr.x2), cy(wr.y2));
        }
        ctx.stroke();
      }
    }

    // 4) 坐标（放大时）
    if (k >= 44) {
      ctx.fillStyle = pal.text3;
      ctx.font = `${Math.min(11, k * 0.16)}px ${cssVar('--mono') || 'monospace'}`;
      ctx.textBaseline = 'top';
      for (let row = row0; row <= row1; row++) {
        const y = m.originBottom ? m.height - 1 - row : row;
        for (let col = col0; col <= col1; col++) {
          if (m.kinds[key(m, col, y)] === TILE_EMPTY) continue;
          ctx.fillText(`${col},${y}`, t.x + col * k + gap + 2, t.y + row * k + gap + 1);
        }
      }
    }

    // 5) 悬停与固定选择
    const outline = (pos: { x: number; y: number }, color: string, lw: number) => {
      const row = tileRow(m, pos.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      const sx = t.x + pos.x * k + gap / 2 - lw / 2;
      const sy = t.y + row * k + gap / 2 - lw / 2;
      const size = Math.max(2, k - gap + lw);
      ctx.beginPath();
      if (radius && canRound) ctx.roundRect(sx, sy, size, size, radius + lw / 2);
      else ctx.rect(sx, sy, size, size);
      ctx.stroke();
    };
    const hv = hoverRef.current;
    if (hv && (!pin || hv.x !== pin.x || hv.y !== pin.y)) outline(hv, pal.text3, 1);
    if (pin) outline(pin, pal.primary, 2);
    // tRef 来自 usePanZoom，稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const zoomPctRef = useRef(100);
  const { tRef, setTransform, zoomBy } = usePanZoom(viewportRef, {
    minK: MIN_K,
    maxK: MAX_K,
    onTransform: (t: ViewTransform) => {
      requestDraw();
      const pct = Math.round(t.k * 10) / 10;
      if (pct !== zoomPctRef.current) {
        zoomPctRef.current = pct;
        setZoomPct(pct);
      }
      if (hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
      }
    },
    onUserInteract: () => {
      autoFit.current = false;
    },
    onTap: (e) => {
      const tile = tileAt(e.clientX, e.clientY);
      const m = stateRef.current.model;
      if (tile && m && m.tiles.has(key(m, tile.x, tile.y))) setPinned(tile);
      else setPinned(null);
      viewportRef.current?.focus({ preventScroll: true });
    },
    onHover: (e) => {
      const tile = e ? tileAt(e.clientX, e.clientY) : null;
      const prev = hoverRef.current;
      if (tile?.x === prev?.x && tile?.y === prev?.y) {
        if (tile && e) setHover((h) => (h ? { ...h, ...localPos(e) } : h));
        return;
      }
      hoverRef.current = tile;
      setHover(tile && e ? { ...tile, ...localPos(e) } : null);
      requestDraw();
    },
    onFit: () => fit(),
    onActualSize: () => fit(),
  });

  const localPos = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const tileAt = (clientX: number, clientY: number) => {
    const m = stateRef.current.model;
    const vp = viewportRef.current;
    if (!m || !vp) return null;
    const r = vp.getBoundingClientRect();
    const c = toContent(tRef.current, clientX - r.left, clientY - r.top);
    const hit = hitTile(m, c.x, c.y);
    if (!hit || m.kinds[key(m, hit.x, hit.y)] === TILE_EMPTY) return null;
    return hit;
  };

  const fit = useCallback(() => {
    const m = stateRef.current.model;
    const { w, h } = sizeRef.current;
    if (!m || w <= 0 || h <= 0) return;
    autoFit.current = true;
    setTransform(fitTransform(m.width, m.height, w, h, 16, MIN_K, MAX_K));
  }, [setTransform]);

  // 画布尺寸（devicePixelRatio 感知）
  useEffect(() => {
    const vp = viewportRef.current;
    const canvas = canvasRef.current;
    if (!vp || !canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (autoFit.current) fit();
      draw();
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(vp);
    // 浏览器缩放 / 拖到不同 DPI 屏幕
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      resize();
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', onDpr);
    return () => {
      ro?.disconnect();
      mq?.removeEventListener('change', onDpr);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [draw, fit]);

  // 新数据：适配并清除选择
  useEffect(() => {
    setPinned(null);
    hoverRef.current = null;
    setHover(null);
    searchPos.current = { q: '', i: -1 };
    setSearchMsg(null);
    autoFit.current = true;
    fit();
    requestDraw();
  }, [model, fit, requestDraw]);

  // 主题切换：重新读取颜色
  useEffect(() => {
    paletteRef.current = null;
    requestDraw();
  }, [theme, requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [showWires, pinned, pinnedNets, highlightSet, requestDraw]);

  const pinnedTile = pinned && model ? model.tiles.get(key(model, pinned.x, pinned.y)) ?? null : null;
  const onSelectTileRef = useRef(onSelectTile);
  onSelectTileRef.current = onSelectTile;
  useEffect(() => {
    onSelectTileRef.current?.(pinnedTile ? { x: pinnedTile.x, y: pinnedTile.y, cells: pinnedTile.cells } : null);
  }, [pinnedTile]);

  /* ───────── 搜索单元 ───────── */

  const runSearch = (dir: 1 | -1) => {
    const m = model;
    const q = query.trim().toLowerCase();
    if (!m || !q) return;
    const all: TileData[] = [];
    for (const t of m.tiles.values()) if (t.cells.some((c) => c.name.toLowerCase().includes(q))) all.push(t);
    if (!all.length) {
      setSearchMsg('无结果');
      return;
    }
    all.sort((a, b) => a.y - b.y || a.x - b.x);
    const prev = searchPos.current;
    const i = prev.q === q ? (prev.i + dir + all.length) % all.length : 0;
    searchPos.current = { q, i };
    setSearchMsg(`${i + 1}/${all.length}`);
    const tile = all[i];
    setPinned({ x: tile.x, y: tile.y });
    const { w, h } = sizeRef.current;
    const t = tRef.current;
    autoFit.current = false;
    setTransform(centerOn({ ...t, k: Math.max(t.k, 28) }, tile.x + 0.5, tileRow(m, tile.y) + 0.5, w, h));
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      setQuery('');
      setSearchMsg(null);
    }
  };

  /* ───────── 渲染 ───────── */

  const pal = useMemo(() => (typeof document !== 'undefined' ? readPalette() : null), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoverTile = hover && model ? model.tiles.get(key(model, hover.x, hover.y)) ?? null : null;
  const hoverKind = hover && model ? model.kinds[key(model, hover.x, hover.y)] : null;
  const vpW = sizeRef.current.w;
  const vpH = sizeRef.current.h;

  let overlay: ReactNode = null;
  if (error && !loading) {
    overlay = (
      <div className="sch-state">
        <TriangleAlert size={30} strokeWidth={1.4} className="sch-state-err" />
        <span>{error}</span>
      </div>
    );
  } else if (loading && !model) {
    overlay = (
      <div className="sch-state">
        <div className="spinner" />
        <span>正在布局布线…</span>
      </div>
    );
  } else if (!model) {
    overlay = (
      <div className="sch-state">
        <Cpu size={34} strokeWidth={1.4} />
        <span>{emptyText}</span>
      </div>
    );
  } else if (model.totalCells === 0) {
    overlay = (
      <div className="sch-state sch-state-float">
        <span>布局结果中没有已放置的单元</span>
      </div>
    );
  }

  const logicTotal = model ? model.tileTotals[TILE_LOGIC] : 0;
  const logicUsed = model ? model.tileUsed[TILE_LOGIC] : 0;
  const logicPct = logicTotal ? (logicUsed / logicTotal) * 100 : 0;

  return (
    <div className={`sch-viewer sch-dev${className ? ' ' + className : ''}`}>
      <div className="sch-toolbar">
        <div className="sch-title" title={device?.partNumber ?? placement?.device}>
          <Cpu size={15} strokeWidth={1.75} className="sch-title-ico" />
          <span>{device ? device.name : placement?.device ?? '器件视图'}</span>
          {model && (
            <span className="sch-subtitle tabular">
              {model.width}×{model.height} tile
            </span>
          )}
        </div>
        <div className={`sch-search${query ? ' has-query' : ''}`}>
          <Search size={14} strokeWidth={1.75} className="sch-search-ico" />
          <input
            className="sch-search-input"
            placeholder="查找单元（回车）"
            value={query}
            disabled={!model || model.totalCells === 0}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchMsg(null);
            }}
            onKeyDown={onSearchKey}
            aria-label="查找已放置的单元"
            spellCheck={false}
          />
          {searchMsg && <span className="sch-search-count tabular">{searchMsg}</span>}
          {query && (
            <button
              className="icon-btn sch-mini"
              onClick={() => {
                setQuery('');
                setSearchMsg(null);
              }}
              title="清除"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <div className="sch-spacer" />
        <div className="sch-group">
          <button
            className={`icon-btn${showWires && wires.length ? ' active' : ''}`}
            onClick={() => setShowWires((v) => !v)}
            disabled={!wires.length}
            title={wires.length ? (showWires ? '隐藏连线' : '显示连线') : '无布线数据'}
            aria-pressed={showWires}
          >
            <Cable size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="sch-sep" />
        <div className="sch-group">
          <button className="icon-btn" onClick={() => zoomBy(0.8)} disabled={!model} title="缩小 (-)">
            <ZoomOut size={16} strokeWidth={1.75} />
          </button>
          <span className="sch-zoom sch-zoom-static tabular" title="每个 tile 的像素尺寸">
            {zoomPct >= 10 ? Math.round(zoomPct) : zoomPct.toFixed(1)} px
          </span>
          <button className="icon-btn" onClick={() => zoomBy(1.25)} disabled={!model} title="放大 (+)">
            <ZoomIn size={16} strokeWidth={1.75} />
          </button>
          <button className="icon-btn" onClick={fit} disabled={!model} title="适配窗口 (0)">
            <Maximize size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="sch-dev-body">
        <div
          ref={viewportRef}
          className={`sch-viewport sch-dev-viewport${model ? ' is-ready' : ''}${hover && hoverTile ? ' is-pointing' : ''}`}
          tabIndex={0}
          role="application"
          aria-label="器件视图：拖动平移，Ctrl+滚轮缩放，单击 tile 固定选择"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPinned(null);
          }}
        >
          <canvas ref={canvasRef} className="sch-dev-canvas" />
          {overlay}
          {loading && model && (
            <div className="sch-busy" data-panzoom-ignore>
              <div className="spinner sch-spinner-sm" />
              正在更新…
            </div>
          )}
          {hover && model && hoverKind != null && (!pinned || pinned.x !== hover.x || pinned.y !== hover.y) && (
            <div
              className="sch-tip"
              style={{
                left: Math.min(hover.sx + 14, Math.max(8, vpW - 250)),
                top: hover.sy + 16 + 200 > vpH ? undefined : hover.sy + 16,
                bottom: hover.sy + 16 + 200 > vpH ? Math.max(8, vpH - hover.sy + 10) : undefined,
              }}
            >
              <div className="sch-tip-head">
                <span className="tabular">
                  X{hover.x} Y{hover.y}
                </span>
                <span className="muted">{TILE_KIND_LABEL[hoverKind as TileKind]} tile</span>
              </div>
              {hoverTile ? (
                <CellList tile={hoverTile} max={TOOLTIP_MAX} />
              ) : (
                <div className="sch-tip-empty muted">未占用</div>
              )}
            </div>
          )}
        </div>
        {pinnedTile && (
          <aside className="sch-dev-detail" data-panzoom-ignore>
            <div className="sch-dev-detail-head">
              <Pin size={14} strokeWidth={1.75} className="sch-title-ico" />
              <span className="tabular">
                X{pinnedTile.x} Y{pinnedTile.y}
              </span>
              <span className="muted">· {pinnedTile.cells.length} 个单元</span>
              <span className="sch-spacer" />
              <button className="icon-btn sch-mini" onClick={() => setPinned(null)} title="取消固定 (Esc)">
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
            <div className="sch-dev-detail-body">
              <CellList tile={pinnedTile} max={Infinity} />
              {pinnedNets.size > 0 && <div className="sch-dev-detail-foot muted">已加亮 {pinnedNets.size} 个相关网络的连线</div>}
            </div>
          </aside>
        )}
      </div>

      {model && pal && (
        <div className="sch-dev-legend">
          {model.typeCounts.map((tc) => (
            <span key={tc.type} className="sch-legend-item" title={`${CAT_LABEL[tc.category]}：${tc.count}`}>
              <i
                className={`sch-swatch${ROUND[tc.category] ? ' is-round' : ''}`}
                style={{ background: pal.cat[tc.category] }}
              />
              {typeLabel(tc.type)}
              <b className="tabular">{tc.count}</b>
            </span>
          ))}
          {model.typeCounts.length === 0 && <span className="muted">无已放置单元</span>}
          <span className="sch-spacer" />
          {logicTotal > 0 && (
            <span className="sch-legend-util" title="至少放置了一个单元的逻辑 tile 占全部逻辑 tile 的比例">
              逻辑 tile
              <span className="meter sch-legend-meter">
                <i style={{ width: `${Math.min(100, logicPct)}%` }} />
              </span>
              <b className="tabular">
                {logicUsed}/{logicTotal}
              </b>
              <span className="muted tabular">{logicPct < 1 && logicUsed > 0 ? '<1' : Math.round(logicPct)}%</span>
            </span>
          )}
          {model.tileTotals[TILE_IO] > 0 && (
            <span className="sch-legend-item muted tabular" title="已用 IO tile / 全部 IO tile">
              IO tile {model.tileUsed[TILE_IO]}/{model.tileTotals[TILE_IO]}
            </span>
          )}
          {model.outOfRange > 0 && (
            <span className="sch-legend-item muted" title="坐标超出网格或格式不正确，未绘制">
              {model.outOfRange} 个单元坐标无效
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CellList({ tile, max }: { tile: TileData; max: number }) {
  const shown = tile.cells.slice(0, max);
  return (
    <ul className="sch-cell-list">
      {shown.map((c, i) => (
        <li key={`${c.name}-${c.z}-${i}`}>
          <span className="sch-cell-name sch-mono" title={c.name}>
            {c.name || '(未命名)'}
          </span>
          <span className="sch-cell-type">{c.type}</span>
          <span className="sch-cell-pos muted tabular">
            {c.x},{c.y},{c.z}
          </span>
        </li>
      ))}
      {tile.cells.length > shown.length && <li className="muted">…还有 {tile.cells.length - shown.length} 个</li>}
    </ul>
  );
}
