import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Binary,
  BookOpen,
  Cable,
  CircleAlert,
  CircuitBoard,
  Clock,
  Cpu,
  Database,
  FolderOpen,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Sun,
  Workflow,
  X,
  type LucideProps,
} from 'lucide-react';
import type { ExampleCategory, ExampleSummary, ProjectSummary, ToolInfo } from '@webeda/shared';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { StatusDot } from '../../ui/StatusDot';
import { createFluid } from './fluid';
import {
  CATEGORY_LABELS,
  RUNTIME_LABELS,
  exampleHref,
  exampleSupportsBitstream,
  exampleTarget,
  filterExamples,
  galleryFilters,
  greeting,
  projectSubtitle,
  recentProjects,
  relativeTime,
  toolSummary,
  type GalleryFilter,
} from './model';
import './home.css';

const ICON = { strokeWidth: 1.75 } as const;

const CATEGORY_ICONS: Record<ExampleCategory, ComponentType<LucideProps>> = {
  basics: BookOpen,
  combinational: Binary,
  sequential: Clock,
  fsm: Workflow,
  memory: Database,
  interface: Cable,
  verification: ShieldCheck,
  board: CircuitBoard,
};

/* ───────────────────────── 数据加载 ───────────────────────── */

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function useAsync<T>(load: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef
      .current()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/* ───────────────────────── 流体背景 ───────────────────────── */

function useFluidBackground(canvasRef: RefObject<HTMLCanvasElement | null>, targetRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const target = targetRef.current;
    if (!canvas || !target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia?.('(pointer: coarse)');
    // 减少动态效果或触屏设备上不启动（流体只响应鼠标移动，触屏上没有意义且耗电）
    if (reduce?.matches || coarse?.matches) return;

    let fluid: ReturnType<typeof createFluid> = null;
    try {
      fluid = createFluid(canvas, target);
    } catch {
      fluid = null;
    }
    if (!fluid) return;
    const handle = fluid;
    const onVisibility = () => (document.hidden ? handle.stop() : handle.start());
    const onMotionPref = () => (reduce?.matches ? handle.stop() : handle.start());
    handle.start();
    document.addEventListener('visibilitychange', onVisibility);
    reduce?.addEventListener?.('change', onMotionPref);
    canvas.dataset.active = 'true';
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      reduce?.removeEventListener?.('change', onMotionPref);
      handle.destroy();
      delete canvas.dataset.active;
    };
  }, [canvasRef, targetRef]);
}

/* ───────────────────────── 页面 ───────────────────────── */

export default function HomePage() {
  const [theme, setTheme] = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useFluidBackground(canvasRef, rootRef);

  useEffect(() => {
    const prev = document.title;
    document.title = 'WebEDA — 在线 HDL 仿真与 FPGA 设计';
    return () => {
      document.title = prev;
    };
  }, []);

  const hello = useMemo(() => greeting(new Date().getHours()), []);

  return (
    <div className="home" ref={rootRef}>
      <canvas className="home-fluid" ref={canvasRef} aria-hidden="true" />

      <header className="topbar home-topbar">
        <Link to="/" className="logo" aria-label="WebEDA 首页">
          <span className="logo-mark">W</span>
          <span className="logo-text">
            <b>WebEDA</b>
            <small>在线 HDL 仿真与 FPGA 设计</small>
          </span>
        </Link>
        <span className="spacer" />
        <nav className="home-nav" aria-label="主导航">
          <Link to="/playground" className="btn btn-ghost btn-sm">
            Playground
          </Link>
          <Link to="/studio" className="btn btn-ghost btn-sm">
            Studio
          </Link>
        </nav>
        <button
          type="button"
          className="home-round"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <Sun size={17} {...ICON} /> : <Moon size={17} {...ICON} />}
        </button>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <p className="home-hello">
            {hello} <span aria-hidden="true">👋</span>
          </p>
          <h1 className="home-title">
            在浏览器里完成
            <br />
            从代码到<span className="home-accent">比特流</span>
          </h1>
          <p className="home-lead">
            编写 Verilog / SystemVerilog，用 Icarus 仿真并查看波形；用 Yosys 与 nextpnr 综合、布局布线、生成比特流，再在虚拟开发板上运行。无需安装任何软件。
          </p>
        </section>

        <section className="home-entries" aria-label="开始">
          <EntryCard
            to="/playground"
            icon={SquareTerminal}
            tone="primary"
            name="Playground"
            desc="类 EDA Playground：写代码、仿真、看波形"
            chips={['Verilog / SystemVerilog', 'Icarus Verilog', 'VCD 波形', 'RTL 原理图']}
          />
          <EntryCard
            to="/studio"
            icon={Cpu}
            tone="ink"
            name="Studio"
            desc="类 Vivado：工程、综合、布局布线、比特流、虚拟开发板"
            chips={['Yosys 综合', 'nextpnr 布局布线', 'iCE40 / ECP5 比特流', '虚拟开发板']}
          />
        </section>

        <div className="home-split">
          <RecentProjects />
          <Toolchain />
        </div>

        <Gallery />
      </main>

      <footer className="home-footer">
        <div className="home-watermark" aria-hidden="true">
          WebEDA
        </div>
        <p>
          仿真：Icarus Verilog · 综合：Yosys · 实现：nextpnr / IceStorm / Trellis · 原理图：netlistsvg
          <br />
          Xilinx 7 系列与 Gowin 器件目前仅支持综合与资源估算。
        </p>
      </footer>
    </div>
  );
}

/* ───────────────────────── 入口卡片 ───────────────────────── */

function EntryCard(props: {
  to: string;
  icon: ComponentType<LucideProps>;
  tone: 'primary' | 'ink';
  name: string;
  desc: string;
  chips: string[];
}) {
  const Icon = props.icon;
  return (
    <Link to={props.to} className="card home-entry">
      <span className={`home-entry-ico home-tone-${props.tone}`}>
        <Icon size={26} {...ICON} />
      </span>
      <span className="home-entry-text">
        <span className="home-entry-name">{props.name}</span>
        <span className="home-entry-desc">{props.desc}</span>
        <span className="home-entry-chips">
          {props.chips.map((c) => (
            <span key={c} className="home-chip">
              {c}
            </span>
          ))}
        </span>
      </span>
      <span className="home-entry-go" aria-hidden="true">
        <ArrowRight size={18} {...ICON} />
      </span>
    </Link>
  );
}

/* ───────────────────────── 最近的工程 ───────────────────────── */

function RecentProjects() {
  const projects = useAsync<ProjectSummary[]>(api.projects);
  const list = useMemo(() => (projects.data ? recentProjects(projects.data, 5) : []), [projects.data]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="card home-panel" aria-labelledby="home-recent-title">
      <div className="home-panel-header">
        <h2 id="home-recent-title" className="home-panel-title">
          最近的工程
        </h2>
        <Link to="/studio" className="btn btn-ghost btn-sm">
          全部工程
          <ArrowUpRight size={14} {...ICON} />
        </Link>
      </div>
      <div className="home-panel-body">
        {projects.loading && !projects.data ? (
          <SkeletonRows n={3} />
        ) : projects.error ? (
          <ErrorState message={`无法加载工程列表：${projects.error}`} onRetry={projects.reload} />
        ) : list.length === 0 ? (
          <div className="empty home-empty">
            <FolderOpen size={34} strokeWidth={1.4} />
            <span>还没有 Studio 工程。从下方的板卡模板开始，或新建一个空工程。</span>
            <Link to="/studio" className="btn btn-primary btn-sm">
              新建工程
            </Link>
          </div>
        ) : (
          <ul className="home-rows">
            {list.map((p) => (
              <li key={p.id}>
                <Link to={`/studio/${encodeURIComponent(p.id)}`} className="home-row">
                  <span className="home-row-ico home-tone-ink">
                    <Cpu size={17} {...ICON} />
                  </span>
                  <span className="home-row-main">
                    <span className="home-row-name">{p.name || '未命名工程'}</span>
                    <span className="home-row-sub">{projectSubtitle(p)}</span>
                  </span>
                  <span className="home-row-time">{relativeTime(p.updatedAt, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── 工具链状态 ───────────────────────── */

function Toolchain() {
  const tools = useAsync<ToolInfo[]>(api.tools);
  const summary = tools.data ? toolSummary(tools.data) : null;

  return (
    <section className="card home-panel" aria-labelledby="home-tools-title">
      <div className="home-panel-header">
        <h2 id="home-tools-title" className="home-panel-title">
          工具链
        </h2>
        {summary && (
          <StatusDot
            status={summary.allOk ? 'succeeded' : summary.available > 0 ? 'cancelled' : 'failed'}
            label={`${summary.available}/${summary.total} 可用`}
          />
        )}
        {tools.error && (
          <button type="button" className="icon-btn" onClick={tools.reload} title="重新检测" aria-label="重新检测">
            <RefreshCw size={15} {...ICON} />
          </button>
        )}
      </div>
      <div className="home-panel-body">
        {tools.loading && !tools.data ? (
          <SkeletonRows n={4} compact />
        ) : tools.error ? (
          <ErrorState message={`无法获取工具链状态：${tools.error}`} onRetry={tools.reload} />
        ) : !tools.data?.length ? (
          <div className="empty home-empty">
            <CircleAlert size={34} strokeWidth={1.4} />
            <span>服务端没有报告任何工具</span>
          </div>
        ) : (
          <ul className="home-tools">
            {tools.data.map((t) => (
              <li key={t.id} className="home-tool">
                <span className="home-tool-name">{t.name}</span>
                <span className="home-tool-meta">
                  <span className="home-tool-ver" title={t.version ?? undefined}>
                    {t.version ?? '—'}
                  </span>
                  <span className="home-tool-rt">{RUNTIME_LABELS[t.runtime] ?? t.runtime}</span>
                </span>
                <StatusDot status={t.available ? 'succeeded' : 'failed'} label={t.available ? '可用' : '不可用'} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── 示例画廊 ───────────────────────── */

function Gallery() {
  const examples = useAsync<ExampleSummary[]>(api.examples);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const all = examples.data ?? [];
  const filters = useMemo(() => galleryFilters(all), [all]);
  const shown = useMemo(() => filterExamples(all, filter, query), [all, filter, query]);

  // 「/」聚焦搜索框（输入框内输入时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当前分类在新数据中不存在时回到「全部」
  useEffect(() => {
    if (filter !== 'all' && examples.data && !filters.some((f) => f.id === filter)) setFilter('all');
  }, [filter, filters, examples.data]);

  return (
    <section className="home-gallery" aria-labelledby="home-gallery-title">
      <div className="home-section-head">
        <div>
          <div className="home-eyebrow">EXAMPLES</div>
          <h2 id="home-gallery-title" className="home-section-title">
            示例与模板
          </h2>
        </div>
        <label className="home-search">
          <Search size={16} {...ICON} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              } else if (e.key === 'Enter' && shown.length === 1) {
                navigate(exampleHref(shown[0]));
              }
            }}
            placeholder="搜索示例，如 UART、FIFO、Basys"
            aria-label="搜索示例"
          />
          {query ? (
            <button type="button" className="home-search-x" onClick={() => setQuery('')} aria-label="清除搜索">
              <X size={14} {...ICON} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
      </div>

      {filters.length > 1 && (
        <div className="home-seg-scroll">
          <div className="seg" role="group" aria-label="按分类筛选">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                className={filter === f.id ? 'active' : undefined}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="home-seg-count">{f.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {examples.loading && !examples.data ? (
        <div className="home-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="card home-ex home-skeleton-card">
              <span className="home-skel home-skel-ico" />
              <span className="home-skel home-skel-line" />
              <span className="home-skel home-skel-line short" />
            </div>
          ))}
        </div>
      ) : examples.error ? (
        <div className="card">
          <ErrorState message={`无法加载示例：${examples.error}`} onRetry={examples.reload} />
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <div className="empty home-empty">
            <Search size={34} strokeWidth={1.4} />
            <span>{all.length ? '没有匹配的示例' : '服务端没有提供示例'}</span>
            {(query || filter !== 'all') && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        </div>
      ) : (
        <ul className="home-grid">
          {shown.map((e) => (
            <li key={e.id}>
              <ExampleCard ex={e} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExampleCard({ ex }: { ex: ExampleSummary }) {
  const Icon = CATEGORY_ICONS[ex.category] ?? BookOpen;
  const studio = ex.scope === 'studio';
  const bitstream = exampleSupportsBitstream(ex);
  return (
    <Link to={exampleHref(ex)} className="card home-ex" title={ex.description}>
      <span className="home-ex-top">
        <span className={`home-ex-ico ${studio ? 'home-tone-ink' : 'home-tone-primary'}`}>
          <Icon size={17} {...ICON} />
        </span>
        <span className="home-ex-cat">{CATEGORY_LABELS[ex.category] ?? ex.category}</span>
        {studio && bitstream !== null && <span className="home-ex-flag">{bitstream ? '比特流' : '仅综合'}</span>}
      </span>
      <span className="home-ex-title">{ex.title}</span>
      <span className="home-ex-desc">{ex.description}</span>
      <span className="home-ex-foot">
        <span>{exampleTarget(ex)}</span>
        <ArrowRight size={15} {...ICON} />
      </span>
    </Link>
  );
}

/* ───────────────────────── 通用小组件 ───────────────────────── */

function SkeletonRows({ n, compact = false }: { n: number; compact?: boolean }) {
  return (
    <div className="home-rows" aria-busy="true" aria-label="加载中">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`home-row home-skeleton-row${compact ? ' compact' : ''}`}>
          {!compact && <span className="home-skel home-skel-ico small" />}
          <span className="home-row-main">
            <span className="home-skel home-skel-line" />
            {!compact && <span className="home-skel home-skel-line short" />}
          </span>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty home-empty home-error" role="alert">
      <CircleAlert size={34} strokeWidth={1.4} />
      <span>{message}</span>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        <RefreshCw size={14} {...ICON} />
        重试
      </button>
    </div>
  );
}
