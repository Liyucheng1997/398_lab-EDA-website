import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Check, CircuitBoard, Download, FilePlus2, Moon, Sparkles, Square, Sun, TriangleAlert, Wrench, X } from 'lucide-react';
import type { PcbAiStatus, PcbDesign, PcbDrcReport } from '@webeda/shared';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { PcbBoardView, VIOLATION_LABELS, bomCsv, bomRows, compareRefs, designToSvg, downloadText, pcbStats, safeBoardFileName } from '../../features/pcb';
import { StatusDot } from '../../ui/StatusDot';
import { toast } from '../../ui/toast';
import { usePcbRun, type LogItem } from './usePcbRun';
import './pcbpage.css';

const ICON = { strokeWidth: 1.75 } as const;

const SAMPLE_PROMPTS = [
  { label: 'NE555 闪灯', text: '做一块 NE555 闪灯板：5 V 排针供电，一颗 LED 约 2 Hz 闪烁，贴片元件，板子尽量小。' },
  { label: '3.3 V 稳压模块', text: 'AMS1117-3.3 稳压模块：螺钉端子输入 5–12 V，3.3 V 用 1×3 排针输出，带输入输出电容和电源指示灯，四角留 M3 安装孔。' },
  { label: 'ATmega328P 最小系统', text: 'ATmega328P（TQFP-32）最小系统板：16 MHz 晶振、复位按键、2×3 ISP 排针、串口排针、电源指示灯，所有 IO 引到两侧排针。' },
];

type InfoTab = 'bom' | 'nets' | 'drc';

/** /pcb —— AI 电路板设计 */
export default function PcbPage() {
  const [theme, setTheme] = useTheme();
  const run = usePcbRun();
  const [status, setStatus] = useState<PcbAiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [tab, setTab] = useState<InfoTab>('bom');
  const [activeNet, setActiveNet] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'PCB · WebEDA';
    api.pcbStatus().then(setStatus, (e: Error) => setStatusError(e.message));
  }, []);

  // 日志跟随到底部
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.log]);

  // 设计变了以后，高亮的网络可能已经不存在
  useEffect(() => {
    if (activeNet && !run.design?.nets.some((n) => n.name === activeNet)) setActiveNet(null);
  }, [run.design, activeNet]);

  const stats = useMemo(() => (run.design ? pcbStats(run.design, run.drc) : null), [run.design, run.drc]);
  const available = status?.available ?? false;
  const canSubmit = available && !run.running && prompt.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    void run.start(prompt.trim(), run.design);
    setPrompt('');
  };

  const loadExample = async () => {
    try {
      run.load(await api.pcbExample());
      toast('已加载示例板（固定脚本生成，不是 AI 设计）');
    } catch (e) {
      toast(`无法加载示例板：${(e as Error).message}`, 'error');
    }
  };

  const exportAs = (kind: 'json' | 'svg' | 'bom') => {
    const d = run.design;
    setExportOpen(false);
    if (!d) return;
    const base = safeBoardFileName(d.name);
    if (kind === 'json') downloadText(`${base}.pcb.json`, JSON.stringify(d, null, 2), 'application/json');
    else if (kind === 'svg') downloadText(`${base}.svg`, designToSvg(d), 'image/svg+xml');
    else downloadText(`${base}-bom.csv`, bomCsv(d), 'text/csv;charset=utf-8');
  };

  return (
    <div className="pcb-page">
      <header className="topbar">
        <Link to="/" className="logo" aria-label="WebEDA 首页">
          <span className="logo-mark">W</span>
          <span className="logo-text">
            <b>WebEDA</b>
            <small>PCB · AI 电路板设计</small>
          </span>
        </Link>
        <span className="spacer" />
        <Link to="/playground" className="btn btn-ghost btn-sm">
          Playground
        </Link>
        <Link to="/studio" className="btn btn-ghost btn-sm">
          Studio
        </Link>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <Sun size={17} {...ICON} /> : <Moon size={17} {...ICON} />}
        </button>
      </header>

      <div className="pcb-main">
        {/* 左：需求输入 + 设计过程 */}
        <aside className="pcb-side">
          <section className="panel pcb-log">
            <div className="panel-header">
              <Sparkles size={15} {...ICON} />
              <span>设计过程</span>
              <span className="pcb-flex" />
              {run.running ? <StatusDot status="running" label="AI 正在设计" /> : status && <span className="pcb-model">{status.model} · {status.effort}</span>}
            </div>
            <div className="panel-body pcb-log-body" ref={logRef}>
              {run.log.length === 0 ? (
                <div className="empty pcb-intro">
                  <Sparkles size={34} strokeWidth={1.4} />
                  <span>用一句话描述想要的电路板。Claude 会自己完成电路设计、元件选型、布局、布线和 DRC 检查，过程中不需要你参与。</span>
                </div>
              ) : (
                run.log.map((item, i) => <LogRow key={i} item={item} />)
              )}
            </div>
            {run.usage && (
              <div className="pcb-usage">
                {run.usage.turns} 轮 · 输入 {fmtTokens(run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens)} · 输出 {fmtTokens(run.usage.outputTokens)} tokens
                {run.model && status && run.model !== status.model ? ` · 由 ${run.model} 作答` : ''}
              </div>
            )}
          </section>

          <section className="panel pcb-prompt">
            {status && !status.available && (
              <div className="pcb-notice" role="status">
                <TriangleAlert size={15} {...ICON} />
                <span>{status.reason}</span>
              </div>
            )}
            {statusError && (
              <div className="pcb-notice" role="status">
                <TriangleAlert size={15} {...ICON} />
                <span>无法连接 WebEDA 服务端：{statusError}</span>
              </div>
            )}
            <textarea
              className="pcb-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={run.design ? '描述要对当前电路板做的修改…' : '描述你想要的电路板，例如：USB 供电的 NE555 闪灯板…'}
              rows={3}
              maxLength={4000}
              disabled={run.running}
              aria-label="电路板需求"
            />
            <div className="pcb-prompt-row">
              {!run.design &&
                SAMPLE_PROMPTS.map((s) => (
                  <button key={s.label} type="button" className="chip" disabled={run.running} onClick={() => setPrompt(s.text)}>
                    {s.label}
                  </button>
                ))}
              <span className="pcb-flex" />
              {run.running ? (
                <button type="button" className="btn btn-sm" onClick={run.cancel}>
                  <Square size={12} {...ICON} />
                  停止
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={submit} title="Ctrl+Enter">
                  <ArrowUp size={14} {...ICON} />
                  {run.design ? '修改设计' : '开始设计'}
                </button>
              )}
            </div>
          </section>
        </aside>

        {/* 中：板图 */}
        <section className="panel pcb-board">
          <div className="panel-header">
            <CircuitBoard size={15} {...ICON} />
            <span className="pcb-board-name">{run.design?.name ?? '电路板'}</span>
            {run.design && stats && (
              <span className="pcb-board-meta">
                {run.design.width} × {run.design.height} mm · {stats.components} 个元件 · {stats.routedNets}/{run.design.nets.filter((n) => n.pins.length >= 2).length} 个网络连通 · {stats.vias} 个过孔
              </span>
            )}
            <span className="pcb-flex" />
            {run.drc && run.design && run.design.components.length > 0 && (
              <StatusDot status={run.drc.errors ? 'failed' : 'succeeded'} label={run.drc.errors ? `DRC ${run.drc.errors} 个错误` : 'DRC 通过'} />
            )}
            {run.design && !run.running && (
              <>
                <div className="pcb-export">
                  <button type="button" className="btn btn-sm" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
                    <Download size={13} {...ICON} />
                    导出
                  </button>
                  {exportOpen && (
                    <div className="pcb-export-menu menu" role="menu">
                      <div className="menu-item" role="menuitem" onClick={() => exportAs('svg')}>
                        <span className="menu-label">板图 SVG</span>
                      </div>
                      <div className="menu-item" role="menuitem" onClick={() => exportAs('bom')}>
                        <span className="menu-label">物料清单 CSV</span>
                      </div>
                      <div className="menu-item" role="menuitem" onClick={() => exportAs('json')}>
                        <span className="menu-label">设计数据 JSON</span>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    run.load(null);
                    setActiveNet(null);
                  }}
                  title="清空当前电路板，开始新的设计"
                >
                  <FilePlus2 size={13} {...ICON} />
                  新建
                </button>
              </>
            )}
          </div>
          <div className="panel-body pcb-board-body">
            {run.design ? (
              <PcbBoardView design={run.design} drc={run.drc} activeNet={activeNet} onPickNet={setActiveNet} />
            ) : (
              <div className="empty">
                <CircuitBoard size={34} strokeWidth={1.4} />
                <span>还没有电路板。在左侧描述需求让 AI 设计，或先看一块示例板。</span>
                <button type="button" className="btn btn-sm" onClick={loadExample}>
                  加载示例板
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 右：元件 / 网络 / DRC */}
        <aside className="panel pcb-info">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'bom'} className={`tab${tab === 'bom' ? ' active' : ''}`} onClick={() => setTab('bom')}>
              元件
              {run.design && <span className="badge">{run.design.components.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'nets'} className={`tab${tab === 'nets' ? ' active' : ''}`} onClick={() => setTab('nets')}>
              网络
              {run.design && <span className="badge">{run.design.nets.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'drc'} className={`tab${tab === 'drc' ? ' active' : ''}`} onClick={() => setTab('drc')}>
              DRC
              {run.drc && run.drc.errors > 0 && <span className="badge badge-danger">{run.drc.errors}</span>}
            </button>
          </div>
          <div className="panel-body">
            {!run.design ? (
              <div className="empty pcb-info-empty">设计完成后，这里显示物料清单、网络和规则检查结果。</div>
            ) : tab === 'bom' ? (
              <BomTable design={run.design} />
            ) : tab === 'nets' ? (
              <NetList design={run.design} drc={run.drc} activeNet={activeNet} onPick={setActiveNet} />
            ) : (
              <DrcList drc={run.drc} onPick={setActiveNet} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function LogRow({ item }: { item: LogItem }) {
  switch (item.kind) {
    case 'user':
      return <div className="pcb-msg pcb-msg-user">{item.text}</div>;
    case 'text':
      return item.text.trim() ? <div className="pcb-msg pcb-msg-ai">{item.text.trim()}</div> : null;
    case 'thinking':
      return item.text.trim() ? (
        <details className="pcb-think">
          <summary>思考过程</summary>
          <div>{item.text.trim()}</div>
        </details>
      ) : null;
    case 'tool':
      return (
        <div className={`pcb-step${item.ok ? '' : ' is-error'}`} title={item.name}>
          {item.ok ? <Wrench size={13} {...ICON} /> : <X size={13} {...ICON} />}
          <span>{item.summary}</span>
        </div>
      );
    case 'end':
      return (
        <div className={`pcb-end pcb-end-${item.status}`}>
          {item.status === 'succeeded' ? <Check size={14} {...ICON} /> : <TriangleAlert size={14} {...ICON} />}
          <span>{item.text}</span>
        </div>
      );
  }
}

function BomTable({ design }: { design: PcbDesign }) {
  const rows = useMemo(() => bomRows(design), [design]);
  if (!rows.length) return <div className="empty pcb-info-empty">还没有元件</div>;
  return (
    <table className="table pcb-bom">
      <thead>
        <tr>
          <th>位号</th>
          <th>值</th>
          <th>封装</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.refs[0]}>
            <td className="pcb-refs">{r.refs.join(' ')}</td>
            <td>{r.value || '—'}</td>
            <td className="pcb-mono">{r.footprint}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NetList(props: { design: PcbDesign; drc: PcbDrcReport | null; activeNet: string | null; onPick: (net: string | null) => void }) {
  const open = useMemo(() => new Set(props.drc?.ratsnest.map((r) => r.net)), [props.drc]);
  const nets = useMemo(() => [...props.design.nets].sort((a, b) => a.name.localeCompare(b.name)), [props.design.nets]);
  if (!nets.length) return <div className="empty pcb-info-empty">还没有网络</div>;
  return (
    <ul className="pcb-nets">
      {nets.map((n) => (
        <li key={n.name}>
          <button
            type="button"
            className={`pcb-net${props.activeNet === n.name ? ' active' : ''}`}
            aria-pressed={props.activeNet === n.name}
            onClick={() => props.onPick(props.activeNet === n.name ? null : n.name)}
          >
            <span className="pcb-net-name">
              {n.name}
              {n.class === 'power' && <span className="pcb-tag">电源</span>}
              {open.has(n.name) && <span className="pcb-tag pcb-tag-warn">未连通</span>}
            </span>
            <span className="pcb-net-pins">{[...n.pins].sort((a, b) => compareRefs(a.split('.')[0], b.split('.')[0])).join(' ')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DrcList({ drc, onPick }: { drc: PcbDrcReport | null; onPick: (net: string | null) => void }) {
  if (!drc) return <div className="empty pcb-info-empty">还没有检查结果</div>;
  if (!drc.violations.length) {
    return (
      <div className="empty pcb-info-empty">
        <Check size={30} strokeWidth={1.4} />
        <span>没有违例：所有网络连通，间距与板框检查通过。</span>
      </div>
    );
  }
  return (
    <ul className="pcb-drc">
      {drc.violations.map((v, i) => (
        <li key={i} title={v.message} onClick={() => v.nets?.[0] && onPick(v.nets[0])}>
          <span className="pcb-drc-type">{VIOLATION_LABELS[v.type]}</span>
          <span className="pcb-drc-what">{[...(v.refs ?? []), ...(v.nets ?? [])].join(' · ') || '—'}</span>
          {v.x !== undefined && (
            <span className="pcb-drc-at">
              ({v.x}, {v.y})
            </span>
          )}
        </li>
      ))}
      {drc.errors + drc.warnings > drc.violations.length && <li className="pcb-drc-more">还有 {drc.errors + drc.warnings - drc.violations.length} 条未列出</li>}
    </ul>
  );
}
