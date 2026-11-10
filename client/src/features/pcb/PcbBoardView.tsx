// 电路板视图：SVG 绘制两层铜、焊盘、过孔、丝印、飞线与 DRC 标记，支持平移缩放与按网络高亮。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { PcbDesign, PcbDrcReport } from '@webeda/shared';
import { fitTransform, type ViewTransform } from '../schematic/geometry';
import { usePanZoom } from '../schematic/usePanZoom';
import { VIOLATION_LABELS, padRadius } from './model';
import './pcb.css';

export interface PcbBoardViewProps {
  design: PcbDesign;
  drc?: PcbDrcReport | null;
  /** 高亮的网络 */
  activeNet?: string | null;
  onPickNet?: (net: string | null) => void;
}

type LayerKey = 'fcu' | 'bcu' | 'silk' | 'rats';
const LAYER_BUTTONS: { key: LayerKey; label: string }[] = [
  { key: 'fcu', label: '顶层' },
  { key: 'bcu', label: '底层' },
  { key: 'silk', label: '丝印' },
  { key: 'rats', label: '飞线' },
];

const MIN_K = 1.5;
const MAX_K = 400;
const ICON = { size: 15, strokeWidth: 1.75 } as const;

export function PcbBoardView({ design, drc, activeNet, onPickNet }: PcbBoardViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const autoFit = useRef(true);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ fcu: true, bcu: true, silk: true, rats: true });

  const apply = useCallback((t: ViewTransform) => {
    gRef.current?.setAttribute('transform', `translate(${t.x} ${t.y}) scale(${t.k})`);
  }, []);

  const pickRef = useRef({ activeNet, onPickNet });
  pickRef.current = { activeNet, onPickNet };

  const fitRef = useRef(() => {});
  const { setTransform, zoomBy } = usePanZoom(rootRef, {
    minK: MIN_K,
    maxK: MAX_K,
    onTransform: apply,
    onUserInteract: () => {
      autoFit.current = false;
    },
    onFit: () => fitRef.current(),
    onTap: (e) => {
      const net = (e.target as Element | null)?.closest?.('[data-net]')?.getAttribute('data-net') ?? null;
      const { activeNet: current, onPickNet: pick } = pickRef.current;
      pick?.(net && net !== current ? net : null);
    },
  });

  const fit = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    autoFit.current = true;
    setTransform(fitTransform(design.width, design.height, el.clientWidth, el.clientHeight, 36, MIN_K, MAX_K));
  }, [design.width, design.height, setTransform]);
  fitRef.current = fit;

  // 板子尺寸变化时重新适配；容器尺寸变化时，只要用户没动过视图就保持适配
  useLayoutEffect(() => {
    fit();
  }, [fit]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (autoFit.current) fitRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cu = (net: string | undefined, extra = '') => `pcbv-cu${extra}${activeNet && net === activeNet ? ' is-active' : ''}`;

  const markers = useMemo(() => (drc?.violations ?? []).filter((v) => v.type !== 'unconnected' && v.x !== undefined && v.y !== undefined), [drc]);

  return (
    <div className="pcbv" ref={rootRef} tabIndex={0} aria-label={`电路板 ${design.name}`}>
      <svg className="pcbv-svg" width="100%" height="100%" role="img">
        <g ref={gRef} className={activeNet ? 'pcbv-g has-active' : 'pcbv-g'}>
          <rect className="pcbv-board" width={design.width} height={design.height} rx={0.6} />

          {layers.bcu &&
            design.traces.map((t, i) =>
              t.layer === 'B.Cu' ? (
                <polyline key={`b${i}`} className={cu(t.net, ' pcbv-bcu')} data-net={t.net} points={t.points.map((p) => p.join(',')).join(' ')} strokeWidth={t.width}>
                  <title>{`${t.net} · 底层 · ${t.width} mm`}</title>
                </polyline>
              ) : null,
            )}
          {layers.fcu &&
            design.traces.map((t, i) =>
              t.layer === 'F.Cu' ? (
                <polyline key={`f${i}`} className={cu(t.net, ' pcbv-fcu')} data-net={t.net} points={t.points.map((p) => p.join(',')).join(' ')} strokeWidth={t.width}>
                  <title>{`${t.net} · 顶层 · ${t.width} mm`}</title>
                </polyline>
              ) : null,
            )}

          {design.components.map((c) => (
            <g key={c.ref}>
              {layers.silk && <rect className="pcbv-body" x={c.body.x1} y={c.body.y1} width={c.body.x2 - c.body.x1} height={c.body.y2 - c.body.y1} />}
              {c.pads.map((p) => (
                <g key={p.num} className={cu(p.net, ' pcbv-pad')} data-net={p.net}>
                  <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={padRadius(p)} />
                  {p.drill && <circle className="pcbv-drill" cx={p.x} cy={p.y} r={p.drill / 2} />}
                  <title>{`${c.ref}.${p.num}${p.net ? ` · ${p.net}` : ' · 未连接'}${c.value ? `\n${c.value} (${c.footprint})` : `\n${c.footprint}`}`}</title>
                </g>
              ))}
            </g>
          ))}

          {design.vias.map((v, i) => (
            <g key={i} className={cu(v.net, ' pcbv-pad')} data-net={v.net}>
              <circle cx={v.x} cy={v.y} r={v.diameter / 2} />
              <circle className="pcbv-drill" cx={v.x} cy={v.y} r={v.drill / 2} />
              <title>{`过孔 · ${v.net}`}</title>
            </g>
          ))}

          {design.holes.map((h, i) => (
            <circle key={i} className="pcbv-hole" cx={h.x} cy={h.y} r={h.diameter / 2} />
          ))}

          {layers.silk && (
            <g className="pcbv-silk">
              {design.components.map((c) => (
                <text key={c.ref} x={c.body.x1} y={c.body.y1 - 0.25} fontSize={0.9}>
                  {c.ref}
                </text>
              ))}
              {design.texts.map((t, i) => (
                <text key={i} x={t.x} y={t.y} fontSize={t.size} textAnchor="middle" dominantBaseline="middle">
                  {t.text}
                </text>
              ))}
            </g>
          )}

          {layers.rats && drc?.ratsnest.map((r, i) => <line key={i} className="pcbv-rat" x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />)}

          {markers.map((v, i) => (
            <circle key={i} className="pcbv-mark" cx={v.x} cy={v.y} r={0.7}>
              <title>{`${VIOLATION_LABELS[v.type]}\n${v.message}`}</title>
            </circle>
          ))}
        </g>
      </svg>

      <div className="pcbv-toolbar" data-panzoom-ignore>
        {LAYER_BUTTONS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`pcbv-layer pcbv-layer-${b.key}${layers[b.key] ? ' active' : ''}`}
            aria-pressed={layers[b.key]}
            onClick={() => setLayers((l) => ({ ...l, [b.key]: !l[b.key] }))}
          >
            <i />
            {b.label}
          </button>
        ))}
        <span className="pcbv-sep" />
        <button type="button" className="icon-btn" title="缩小" aria-label="缩小" onClick={() => zoomBy(0.8)}>
          <Minus {...ICON} />
        </button>
        <button type="button" className="icon-btn" title="放大" aria-label="放大" onClick={() => zoomBy(1.25)}>
          <Plus {...ICON} />
        </button>
        <button type="button" className="icon-btn" title="适应窗口（0）" aria-label="适应窗口" onClick={fit}>
          <Maximize {...ICON} />
        </button>
      </div>
    </div>
  );
}
