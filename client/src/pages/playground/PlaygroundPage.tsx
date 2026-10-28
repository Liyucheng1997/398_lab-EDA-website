import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Copy,
  FilePlus,
  Link2,
  Moon,
  MoreHorizontal,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Save,
  Square,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import type { Diagnostic, JobInfo, JobRequest, ToolInfo } from '@webeda/shared';
import { api } from '../../lib/api';
import { pageUrl } from '../../lib/config';
import { useJob, type LogLine } from '../../lib/useJob';
import { useTheme } from '../../lib/theme';
import { SplitPane } from '../../ui/SplitPane';
import { StatusDot } from '../../ui/StatusDot';
import { toast } from '../../ui/toast';
import { BottomPanel, type BottomTab, type RunSummary, type SchematicState } from './BottomPanel';
import { ConfirmDialog, PromptDialog, ShareDialog } from './dialogs';
import { EditorPane } from './EditorPane';
import { ExamplesModal } from './ExamplesModal';
import { copyText, useElapsed, useMediaQuery } from './hooks';
import {
  classifyError,
  cleanSimulateOptions,
  DEFAULT_TITLE,
  defaultExtFor,
  docFromExample,
  docFromPlayground,
  docReducer,
  docSignature,
  formatBytes,
  formatDuration,
  isHdlName,
  layoutOf,
  MAX_FILES,
  neighborAfterDelete,
  newFileId,
  normalizeFileName,
  resolveActive,
  starterContent,
  templateDoc,
  TITLE_MAX,
  toInput,
  toSourceFiles,
  uniqueFileName,
  validateFileName,
  type Pane,
  type PgDoc,
} from './model';
import {
  BOTTOM_KEY,
  clearDraft,
  clearLocal,
  loadDraft,
  loadFlag,
  loadLayout,
  loadLocal,
  saveDraft,
  saveFlag,
  saveLayout,
  saveLocal,
  SIDEBAR_KEY,
} from './storage';
import { Sidebar } from './Sidebar';
import './playground.css';

interface Meta {
  id: string | null;
  updatedAt: string;
  forkedFrom?: string;
}

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

interface SchemData {
  jobId: string | null;
  map: Record<string, string>;
  top: string | null;
  current: string | null;
  svgs: Record<string, string>;
  loadingSvg: boolean;
  error: string | null;
}

const EMPTY_SCHEM: SchemData = { jobId: null, map: {}, top: null, current: null, svgs: {}, loadingSvg: false, error: null };
const NEW_META: Meta = { id: null, updatedAt: '' };
/** 超过这个大小的 VCD 先提示再加载（浏览器内解析很慢） */
const LARGE_VCD = 48 * 1024 * 1024;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

export default function PlaygroundPage() {
  const { id: routeId } = useParams();
  const [searchParams] = useSearchParams();
  const exampleId = searchParams.get('example');
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const narrow = useMediaQuery('(max-width: 760px)');
  const stacked = useMediaQuery('(max-width: 900px)');

  /* ───────────── 文档状态 ───────────── */
  const [doc, dispatch] = useReducer(docReducer, undefined, templateDoc);
  const [meta, setMeta] = useState<Meta>(NEW_META);
  const [baseline, setBaseline] = useState<string>('');
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [loadNonce, setLoadNonce] = useState(0);
  const [active, setActive] = useState<Record<Pane, string | null>>({ tb: null, design: null });
  const [reveal, setReveal] = useState<{ fileId: string; line: number; column?: number; seq: number } | null>(null);
  const signature = useMemo(() => docSignature(doc), [doc]);
  const dirty = load.status === 'ready' && signature !== baseline;

  /* ───────────── 界面状态 ───────────── */
  const [sidebarOpen, setSidebarOpen] = useState(() => loadFlag(SIDEBAR_KEY, true));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(() => loadFlag(BOTTOM_KEY, false));
  const [tab, setTab] = useState<BottomTab>('log');
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addPane, setAddPane] = useState<Pane | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [pendingExample, setPendingExample] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [toolsError, setToolsError] = useState(false);

  /* ───────────── 任务状态 ───────────── */
  const sim = useJob();
  const elab = useJob();
  const [vcd, setVcd] = useState<string | null>(null);
  const [vcdFetching, setVcdFetching] = useState(false);
  const [vcdError, setVcdError] = useState<string | null>(null);
  const [schem, setSchem] = useState<SchemData>(EMPTY_SCHEM);
  const [simStartedAt, setSimStartedAt] = useState<number | null>(null);
  const [elabStartedAt, setElabStartedAt] = useState<number | null>(null);
  const [runTimeout, setRunTimeout] = useState(30);
  const [lastJob, setLastJob] = useState<'sim' | 'elab' | null>(null);
  const [logCut, setLogCut] = useState<{ sim: [string | null, number]; elab: [string | null, number] }>({ sim: [null, 0], elab: [null, 0] });

  /* ───────────── refs（键盘、卸载、异步回调读取最新值） ───────────── */
  const docRef = useRef(doc);
  docRef.current = doc;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const loadRef = useRef(load);
  loadRef.current = load;
  /** 当前编辑器里装载的是什么：'draft' | 'pg:<id>' | null */
  const loadedKey = useRef<string | null>(null);
  const confirmedExample = useRef<string | null>(null);
  const savingRef = useRef(false);
  const runLock = useRef(false);
  const svgSeq = useRef(0);
  const quotaWarned = useRef(false);
  const cancelSim = sim.cancel;
  const cancelElab = elab.cancel;
  const clearSim = sim.clear;
  const clearElab = elab.clear;

  /* ───────────── 本地持久化 ───────────── */
  const persistNow = useCallback(() => {
    if (loadRef.current.status !== 'ready') return;
    const d = docRef.current;
    const m = metaRef.current;
    let ok = true;
    if (!m.id) {
      ok = saveDraft({ doc: d, baseline: baselineRef.current });
    } else if (dirtyRef.current) {
      ok = saveLocal(m.id, d, m.updatedAt);
    } else {
      clearLocal(m.id);
    }
    if (!ok && !quotaWarned.current) {
      quotaWarned.current = true;
      toast('浏览器存储空间不足，无法在本地自动保存草稿', 'error', 4000);
    }
  }, []);

  useEffect(() => {
    if (load.status !== 'ready') return;
    const t = window.setTimeout(persistNow, 600);
    return () => window.clearTimeout(t);
  }, [doc, baseline, meta.id, load.status, persistNow]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      persistNow();
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => persistNow();
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onHide);
      persistNow();
    };
  }, [persistNow]);

  // 离开页面时取消仍在运行的任务
  useEffect(
    () => () => {
      void cancelSim();
      void cancelElab();
    },
    [cancelSim, cancelElab],
  );

  useEffect(() => saveFlag(SIDEBAR_KEY, sidebarOpen), [sidebarOpen]);
  useEffect(() => saveFlag(BOTTOM_KEY, bottomCollapsed), [bottomCollapsed]);
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${doc.title.trim() || DEFAULT_TITLE} · WebEDA Playground`;
  }, [doc.title, dirty]);

  /* ───────────── 工具信息 / 在线检测 ───────────── */
  const fetchTools = useCallback(async (): Promise<boolean> => {
    try {
      const t = await api.tools();
      setTools(Array.isArray(t) ? t : []);
      setToolsError(false);
      setOffline(false);
      return true;
    } catch (e) {
      setToolsError(true);
      if (classifyError(e) === 'offline') setOffline(true);
      return false;
    }
  }, []);

  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  const retryConnection = async () => {
    const ok = await fetchTools();
    if (ok) {
      toast('已重新连接服务器', 'success');
      if (loadRef.current.status === 'error') {
        loadedKey.current = null;
        setLoadNonce((n) => n + 1);
      }
    } else toast('仍然无法连接服务器', 'error');
  };

  /* ───────────── 装载文档 ───────────── */
  const resetResults = useCallback(() => {
    void cancelSim();
    void cancelElab();
    clearSim();
    clearElab();
    setVcd(null);
    setVcdError(null);
    setVcdFetching(false);
    setSchem(EMPTY_SCHEM);
    setSimStartedAt(null);
    setElabStartedAt(null);
    setLastJob(null);
    setLogCut({ sim: [null, 0], elab: [null, 0] });
    setTab('log');
    setReveal(null);
    svgSeq.current++;
  }, [cancelSim, cancelElab, clearSim, clearElab]);

  const applyDoc = useCallback(
    (d: PgDoc, m: Meta, base: string, key: string) => {
      loadedKey.current = key;
      dispatch({ type: 'load', doc: d });
      setMeta(m);
      setBaseline(base);
      setActive({ tb: null, design: null });
      resetResults();
      setLoad({ status: 'ready' });
    },
    [resetResults],
  );

  const loadDraftOrTemplate = useCallback(() => {
    const draft = loadDraft();
    if (draft) {
      applyDoc(draft.doc, NEW_META, draft.baseline, 'draft');
    } else {
      const d = templateDoc();
      applyDoc(d, NEW_META, docSignature(d), 'draft');
    }
  }, [applyDoc]);

  useEffect(() => {
    let alive = true;

    if (routeId) {
      const key = `pg:${routeId}`;
      if (loadedKey.current === key && loadRef.current.status === 'ready') return;
      persistNow();
      setLoad({ status: 'loading' });
      api
        .getPlayground(routeId)
        .then((p) => {
          if (!alive) return;
          const serverDoc = docFromPlayground(p, loadLayout(p.id));
          const base = docSignature(serverDoc);
          const local = loadLocal(p.id);
          let d = serverDoc;
          if (local && docSignature(local.doc) !== base) {
            d = local.doc;
            toast(
              local.baseUpdatedAt === p.updatedAt ? '已恢复上次未保存的修改' : '已恢复本地未保存的修改（服务器上的版本之后有更新）',
              'info',
              3600,
            );
          } else if (local) clearLocal(p.id);
          applyDoc(d, { id: p.id, updatedAt: p.updatedAt, forkedFrom: p.forkedFrom }, base, key);
          setOffline(false);
        })
        .catch((e: Error) => {
          if (!alive) return;
          const kind = classifyError(e);
          if (kind === 'notfound') {
            toast('Playground 不存在，已为你打开新的 Playground', 'error', 3600);
            navigate('/playground', { replace: true });
          } else {
            if (kind === 'offline') setOffline(true);
            setLoad({ status: 'error', message: kind === 'offline' ? '无法连接到服务器' : e.message || '未知错误' });
          }
        });
      return () => {
        alive = false;
      };
    }

    if (exampleId) {
      const draft = loadDraft();
      const draftDirty = !!draft && docSignature(draft.doc) !== draft.baseline;
      if (draftDirty && confirmedExample.current !== exampleId) {
        // 当前草稿有修改：先展示草稿，询问是否替换
        if (loadedKey.current !== 'draft') applyDoc(draft.doc, NEW_META, draft.baseline, 'draft');
        setPendingExample(exampleId);
        return;
      }
      persistNow();
      setLoad({ status: 'loading' });
      api
        .example(exampleId)
        .then((ex) => {
          if (!alive) return;
          confirmedExample.current = null;
          const d = docFromExample(ex);
          const base = docSignature(d);
          saveDraft({ doc: d, baseline: base, source: ex.id });
          applyDoc(d, NEW_META, base, 'draft');
          setOffline(false);
          navigate('/playground', { replace: true });
        })
        .catch((e: Error) => {
          if (!alive) return;
          const kind = classifyError(e);
          if (kind === 'offline') setOffline(true);
          toast(kind === 'notfound' ? '示例不存在' : `示例加载失败：${e.message}`, 'error', 3600);
          loadedKey.current = null;
          navigate('/playground', { replace: true });
        });
      return () => {
        alive = false;
      };
    }

    if (loadedKey.current === 'draft' && loadRef.current.status === 'ready') return;
    persistNow();
    loadDraftOrTemplate();
    return () => {
      alive = false;
    };
  }, [routeId, exampleId, loadNonce, applyDoc, loadDraftOrTemplate, navigate, persistNow]);

  /* ───────────── 派生数据 ───────────── */
  const tbFiles = useMemo(() => doc.files.filter((f) => f.pane === 'tb'), [doc.files]);
  const designFiles = useMemo(() => doc.files.filter((f) => f.pane === 'design'), [doc.files]);
  const activeTb = resolveActive(doc.files, 'tb', active.tb);
  const activeDesign = resolveActive(doc.files, 'design', active.design);
  const fileNames = useMemo(() => doc.files.map((f) => f.name), [doc.files]);

  const diagnostics = useMemo<Diagnostic[]>(
    () => [...(sim.info?.result?.diagnostics ?? []), ...(elab.info?.result?.diagnostics ?? [])],
    [sim.info, elab.info],
  );

  const logs = useMemo<LogLine[]>(() => {
    const simLogs = logCut.sim[0] && logCut.sim[0] === sim.jobId ? sim.logs.slice(logCut.sim[1]) : sim.logs;
    const elabLogs = logCut.elab[0] && logCut.elab[0] === elab.jobId ? elab.logs.slice(logCut.elab[1]) : elab.logs;
    if (elab.status === 'idle' || (elabLogs.length === 0 && !elab.running)) return simLogs;
    const sep: LogLine = { stream: 'info', text: `${simLogs.length ? '\n' : ''}── RTL 原理图（Yosys）──\n`, ts: 0 };
    return [...simLogs, sep, ...elabLogs];
  }, [sim.logs, sim.jobId, elab.logs, elab.jobId, elab.status, elab.running, logCut]);

  const busy = sim.running || elab.running;
  const runSummary = useMemo<RunSummary | null>(() => {
    const info = sim.info;
    if (!info) {
      if (sim.status === 'failed' && sim.error) return { exitCode: null, durationMs: null, timedOut: false, timeoutSec: runTimeout, status: 'failed', error: sim.error };
      return null;
    }
    const r = info.result?.kind === 'simulate' ? info.result : null;
    const wall = info.startedAt && info.finishedAt ? Date.parse(info.finishedAt) - Date.parse(info.startedAt) : null;
    return {
      exitCode: typeof r?.exitCode === 'number' ? r.exitCode : null,
      durationMs: typeof r?.durationMs === 'number' ? r.durationMs : wall,
      timedOut: r?.timedOut === true,
      timeoutSec: runTimeout,
      status: info.status === 'succeeded' ? 'succeeded' : info.status === 'cancelled' ? 'cancelled' : 'failed',
      error: info.error ?? null,
    };
  }, [sim.info, sim.status, sim.error, runTimeout]);

  const schematicState = useMemo<SchematicState>(() => {
    const mods = Object.keys(schem.map).sort((a, b) => (a === schem.top ? -1 : b === schem.top ? 1 : a.localeCompare(b)));
    return {
      modules: mods,
      current: schem.current,
      svg: schem.current ? (schem.svgs[schem.current] ?? null) : null,
      loading: elab.running || schem.loadingSvg,
      error: schem.error,
    };
  }, [schem, elab.running]);

  const shownJob = sim.running ? 'sim' : elab.running ? 'elab' : lastJob;
  const shownStatus = shownJob === 'sim' ? sim.status : shownJob === 'elab' ? elab.status : 'idle';
  const liveElapsed = useElapsed(shownJob === 'elab' ? elabStartedAt : simStartedAt, busy);
  const shownElapsed = busy
    ? liveElapsed
    : shownJob === 'sim'
      ? (sim.info?.result?.durationMs ?? null)
      : shownJob === 'elab'
        ? (elab.info?.result?.durationMs ?? null)
        : null;
  const shownStage = shownJob === 'sim' ? sim.stage : shownJob === 'elab' ? elab.stage : undefined;
  const statusLabel =
    shownStatus === 'running' ? (shownJob === 'elab' ? '生成原理图中' : '仿真中') : shownStatus === 'succeeded' && shownJob === 'elab' && schematicState.modules.length > 0 ? '原理图已生成' : undefined;
  const iverilog = tools?.find((t) => t.id === 'iverilog');

  /* ───────────── 仿真 ───────────── */
  const checkConnection = useCallback(async () => {
    try {
      await api.tools();
      setOffline(false);
    } catch (e) {
      if (classifyError(e) === 'offline') setOffline(true);
    }
  }, []);

  const fetchSvg = useCallback(async (jobId: string, module: string, artifact: string) => {
    const seq = ++svgSeq.current;
    setSchem((s) => ({ ...s, current: module, loadingSvg: true }));
    try {
      const text = await api.artifactText(jobId, artifact);
      if (seq !== svgSeq.current) return;
      setSchem((s) => (s.jobId === jobId ? { ...s, svgs: { ...s.svgs, [module]: text }, loadingSvg: false } : s));
    } catch (e) {
      if (seq !== svgSeq.current) return;
      setSchem((s) => ({ ...s, loadingSvg: false }));
      toast(`原理图下载失败：${(e as Error).message}`, 'error');
    }
  }, []);

  const elaborate = useCallback(
    async (opts: { switchTab: boolean }) => {
      if (loadRef.current.status !== 'ready') return;
      const files = toSourceFiles(docRef.current.files).filter((f) => f.role !== 'testbench');
      if (!files.some((f) => isHdlName(f.name))) {
        toast('设计面板中没有 Verilog/SystemVerilog 文件', 'error');
        return;
      }
      svgSeq.current++;
      setSchem({ ...EMPTY_SCHEM });
      setLastJob('elab');
      setElabStartedAt(Date.now());
      setLogCut((c) => ({ ...c, elab: [null, 0] }));
      if (opts.switchTab) {
        setTab('schematic');
        setBottomCollapsed(false);
      }
      const info: JobInfo | null = await elab.run({ kind: 'elaborate', files, options: {} });
      if (!info) {
        setSchem((s) => ({ ...s, error: '无法提交原理图任务，详见日志' }));
        void checkConnection();
        return;
      }
      const r = info.result?.kind === 'elaborate' ? info.result : null;
      const map = r?.schematics ?? {};
      const mods = Object.keys(map);
      if (info.status !== 'succeeded' || !r || mods.length === 0) {
        const msg =
          info.status === 'cancelled'
            ? '已停止生成原理图'
            : info.status === 'succeeded'
              ? '没有可显示的模块'
              : `原理图生成失败${info.error ? `：${info.error}` : ''}`;
        setSchem((s) => ({ ...s, error: msg }));
        if (opts.switchTab && info.status === 'failed') toast('原理图生成失败，详见日志与消息', 'error');
        return;
      }
      const current = r.top && map[r.top] ? r.top : mods[0];
      setSchem({ jobId: info.id, map, top: r.top, current, svgs: {}, loadingSvg: true, error: null });
      void fetchSvg(info.id, current, map[current]);
    },
    [elab, checkConnection, fetchSvg],
  );

  const selectModule = useCallback(
    (m: string) => {
      if (!schem.jobId || !schem.map[m]) return;
      if (schem.svgs[m]) {
        svgSeq.current++;
        setSchem((s) => ({ ...s, current: m, loadingSvg: false }));
      } else void fetchSvg(schem.jobId, m, schem.map[m]);
    },
    [schem, fetchSvg],
  );

  const runSim = useCallback(async () => {
    if (runLock.current || loadRef.current.status !== 'ready') return;
    const d = docRef.current;
    const files = toSourceFiles(d.files);
    if (!files.some((f) => isHdlName(f.name))) {
      toast('没有可仿真的 Verilog/SystemVerilog 文件', 'error');
      return;
    }
    runLock.current = true;
    try {
      void elab.cancel();
      elab.clear();
      svgSeq.current++;
      setSchem(EMPTY_SCHEM);
      setVcd(null);
      setVcdError(null);
      setLogCut({ sim: [null, 0], elab: [null, 0] });
      setLastJob('sim');
      setSimStartedAt(Date.now());
      const options = cleanSimulateOptions(d.settings.simulate);
      setRunTimeout(options.timeoutSec ?? 30);
      setTab('log');
      setBottomCollapsed(false);
      const req: JobRequest = { kind: 'simulate', files, options };
      const info = await sim.run(req);
      if (!info) {
        void checkConnection();
        return;
      }
      setOffline(false);
      const r = info.result?.kind === 'simulate' ? info.result : null;
      let hasVcd = false;
      if (r?.vcd) {
        const art = r.artifacts.find((a) => a.name === r.vcd);
        if (art && art.size > LARGE_VCD) {
          setVcdError(`波形文件过大（${formatBytes(art.size)}），请减少 $dumpvars 范围或缩短仿真时间`);
        } else {
          setVcdFetching(true);
          try {
            const text = await api.artifactText(info.id, r.vcd);
            setVcd(text);
            hasVcd = text.length > 0;
          } catch (e) {
            setVcdError(`波形下载失败：${(e as Error).message}`);
          } finally {
            setVcdFetching(false);
          }
        }
      }
      const ok = info.status === 'succeeded';
      const settings = docRef.current.settings;
      if (ok && settings.openWaveform && hasVcd) setTab('wave');
      else setTab('log');
      if (info.status === 'cancelled') toast('仿真已停止');
      else if (r?.timedOut) toast(`仿真超过 ${options.timeoutSec ?? 30} 秒被中止`, 'error');
      if (ok && settings.showSchematic) void elaborate({ switchTab: false });
    } finally {
      runLock.current = false;
    }
  }, [sim, elab, checkConnection, elaborate]);

  const stop = useCallback(() => {
    void sim.cancel();
    void elab.cancel();
  }, [sim, elab]);

  /* ───────────── 保存 / 复制 / 分享 / 新建 ───────────── */
  const save = useCallback(async (): Promise<string | null> => {
    if (savingRef.current || loadRef.current.status !== 'ready') return null;
    savingRef.current = true;
    setSaving(true);
    const d = docRef.current;
    const sig = docSignature(d);
    const input = toInput(d);
    const createNew = async (forkedFrom?: string) => {
      const p = await api.createPlayground(forkedFrom ? { ...input, forkedFrom } : input);
      const oldId = metaRef.current.id;
      if (oldId) clearLocal(oldId);
      else clearDraft();
      saveLayout(p.id, layoutOf(d));
      loadedKey.current = `pg:${p.id}`;
      setMeta({ id: p.id, updatedAt: p.updatedAt, forkedFrom: p.forkedFrom });
      setBaseline(sig);
      navigate(`/playground/${p.id}`, { replace: true });
      return p.id;
    };
    try {
      const id = metaRef.current.id;
      let savedId: string;
      if (id) {
        try {
          const p = await api.updatePlayground(id, input);
          clearLocal(id);
          saveLayout(id, layoutOf(d));
          setMeta({ id: p.id, updatedAt: p.updatedAt, forkedFrom: p.forkedFrom });
          setBaseline(sig);
          savedId = p.id;
        } catch (e) {
          if (classifyError(e) !== 'notfound') throw e;
          savedId = await createNew();
          toast('原 Playground 已不存在，已另存为新的 Playground', 'info', 3600);
          return savedId;
        }
      } else {
        savedId = await createNew();
      }
      setOffline(false);
      toast('已保存', 'success');
      return savedId;
    } catch (e) {
      if (classifyError(e) === 'offline') setOffline(true);
      toast(`保存失败：${(e as Error).message}`, 'error', 3600);
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [navigate]);

  const fork = useCallback(async () => {
    const id = metaRef.current.id;
    if (!id || savingRef.current || loadRef.current.status !== 'ready') return;
    savingRef.current = true;
    setSaving(true);
    persistNow(); // 原 playground 的未保存修改留在本地副本里
    const src = docRef.current;
    const title = `${src.title.trim() || DEFAULT_TITLE} 副本`.slice(0, TITLE_MAX);
    const d: PgDoc = { ...src, title };
    try {
      const p = await api.createPlayground({ ...toInput(d), forkedFrom: id });
      saveLayout(p.id, layoutOf(d));
      loadedKey.current = `pg:${p.id}`;
      dispatch({ type: 'load', doc: d });
      setMeta({ id: p.id, updatedAt: p.updatedAt, forkedFrom: p.forkedFrom ?? id });
      setBaseline(docSignature(d));
      navigate(`/playground/${p.id}`);
      toast('已复制为新的 Playground', 'success');
    } catch (e) {
      if (classifyError(e) === 'offline') setOffline(true);
      toast(`复制失败：${(e as Error).message}`, 'error', 3600);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [navigate, persistNow]);

  const share = useCallback(async () => {
    let id = metaRef.current.id;
    if (!id || dirtyRef.current) {
      id = await save();
      if (!id) return;
    }
    const url = pageUrl(`/playground/${id}`);
    if (await copyText(url)) toast('链接已复制到剪贴板', 'success');
    else setShareUrl(url);
  }, [save]);

  const doNew = useCallback(() => {
    const d = templateDoc();
    const base = docSignature(d);
    clearDraft();
    saveDraft({ doc: d, baseline: base });
    applyDoc(d, NEW_META, base, 'draft');
    if (routeId || exampleId) navigate('/playground');
  }, [applyDoc, routeId, exampleId, navigate]);

  const requestNew = () => {
    setMoreOpen(false);
    persistNow();
    const draft = loadDraft();
    if (draft && docSignature(draft.doc) !== draft.baseline) setConfirmNew(true);
    else doNew();
  };

  const pickExample = (id: string) => {
    setExamplesOpen(false);
    persistNow();
    navigate(`/playground?example=${encodeURIComponent(id)}`);
  };

  /* ───────────── 文件操作 ───────────── */
  const defaultExt = defaultExtFor(doc.settings.simulate.standard);

  const addFile = (pane: Pane, name: string) => {
    if (docRef.current.files.length >= MAX_FILES) {
      toast(`最多 ${MAX_FILES} 个文件`, 'error');
      return;
    }
    const f = { id: newFileId(), name, content: starterContent(name, pane), pane };
    dispatch({ type: 'addFile', file: f });
    setActive((a) => ({ ...a, [pane]: f.id }));
    setAddPane(null);
  };

  const renameFile = (id: string, raw: string): string | null => {
    const f = docRef.current.files.find((x) => x.id === id);
    if (!f) return '文件不存在';
    // 不写扩展名时沿用原文件的扩展名
    const name = normalizeFileName(raw, /\.[^./]+$/.exec(f.name)?.[0] ?? defaultExt);
    const err = validateFileName(name, docRef.current.files.map((x) => x.name), f.name);
    if (err) return err;
    dispatch({ type: 'renameFile', fileId: id, name });
    return null;
  };

  const deleteFile = (id: string) => {
    const f = docRef.current.files.find((x) => x.id === id);
    if (!f) return;
    const next = neighborAfterDelete(docRef.current.files, id);
    dispatch({ type: 'deleteFile', fileId: id });
    setActive((a) => ({ ...a, [f.pane]: next }));
    setDeleteId(null);
  };

  const jump = useCallback((file: string, line: number) => {
    const files = docRef.current.files;
    const clean = file.replace(/^\.\//, '');
    const f = files.find((x) => x.name === clean) ?? files.find((x) => x.name.endsWith(`/${clean}`) || clean.endsWith(`/${x.name}`));
    if (!f) {
      toast(`找不到文件 ${file}`, 'error');
      return;
    }
    setActive((a) => ({ ...a, [f.pane]: f.id }));
    setReveal({ fileId: f.id, line: Math.max(1, line), seq: Date.now() });
  }, []);

  /* ───────────── 全局快捷键 ───────────── */
  const handlers = useRef({ run: runSim, save });
  handlers.current = { run: runSim, save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void handlers.current.run();
      } else if ((e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void handlers.current.save();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 更多菜单：点外部关闭
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.pg-more')) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  /* ───────────── 渲染 ───────────── */
  const ready = load.status === 'ready';
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const deleting = deleteId ? doc.files.find((f) => f.id === deleteId) : null;
  const sidebarVisible = narrow ? drawerOpen : sidebarOpen;
  const saveState = !ready ? '' : dirty ? '未保存' : meta.id ? '已保存' : '草稿';

  const sidebar = (
    <Sidebar
      settings={doc.settings}
      description={doc.description}
      tools={tools}
      toolsError={toolsError}
      elaborating={elab.running}
      onSimulate={(patch) => dispatch({ type: 'simulate', patch })}
      onSettings={(patch) => dispatch({ type: 'settings', patch })}
      onDescription={(description) => dispatch({ type: 'description', description })}
      onElaborate={() => {
        if (narrow) setDrawerOpen(false);
        void elaborate({ switchTab: true });
      }}
    />
  );

  const editors = (
    <SplitPane
      key={stacked ? 'v' : 'h'}
      direction={stacked ? 'vertical' : 'horizontal'}
      initial="50%"
      min={stacked ? 120 : 220}
      minSecond={stacked ? 120 : 220}
      storageKey={stacked ? 'playground.editors.stacked' : 'playground.editors'}
      className="pg-editors"
    >
      <EditorPane
        pane="tb"
        label="测试平台"
        files={tbFiles}
        activeId={activeTb}
        diagnostics={diagnostics}
        reveal={reveal}
        onSelect={(id) => setActive((a) => ({ ...a, tb: id }))}
        onAdd={() => setAddPane('tb')}
        onRename={renameFile}
        onDelete={setDeleteId}
        onChange={(id, content) => dispatch({ type: 'content', fileId: id, content })}
      />
      <EditorPane
        pane="design"
        label="设计"
        files={designFiles}
        activeId={activeDesign}
        diagnostics={diagnostics}
        reveal={reveal}
        onSelect={(id) => setActive((a) => ({ ...a, design: id }))}
        onAdd={() => setAddPane('design')}
        onRename={renameFile}
        onDelete={setDeleteId}
        onChange={(id, content) => dispatch({ type: 'content', fileId: id, content })}
      />
    </SplitPane>
  );

  const bottom = (
    <BottomPanel
      tab={tab}
      onTab={setTab}
      logs={logs}
      fileNames={fileNames}
      onJump={jump}
      onClearLog={() => setLogCut({ sim: [sim.jobId, sim.logs.length], elab: [elab.jobId, elab.logs.length] })}
      canClearLog={logs.length > 0 && !!(sim.jobId || elab.jobId)}
      diagnostics={diagnostics}
      vcd={vcd}
      vcdLoading={sim.running || vcdFetching}
      vcdError={vcdError}
      persistKey={`playground:${meta.id ?? 'draft'}`}
      schematic={schematicState}
      onSelectModule={selectModule}
      onElaborate={() => void elaborate({ switchTab: true })}
      run={runSummary}
    />
  );

  return (
    <div className="pg-root">
      <header className="topbar pg-topbar">
        <Link to="/" className="logo" title="返回首页">
          <span className="logo-mark">W</span>
          <span className="logo-text pg-logo-text">
            <b>WebEDA</b>
            <small>Playground</small>
          </span>
        </Link>
        <span className="tb-sep pg-hide-narrow" />
        <button
          className={`icon-btn${sidebarVisible ? ' active' : ''}`}
          onClick={() => (narrow ? setDrawerOpen((v) => !v) : setSidebarOpen((v) => !v))}
          title={sidebarVisible ? '隐藏设置栏' : '显示设置栏'}
          aria-label={sidebarVisible ? '隐藏设置栏' : '显示设置栏'}
        >
          {sidebarVisible ? <PanelLeftClose size={17} strokeWidth={1.75} /> : <PanelLeftOpen size={17} strokeWidth={1.75} />}
        </button>
        <div className="pg-title-wrap">
          <input
            className="pg-title"
            value={doc.title}
            placeholder={DEFAULT_TITLE}
            maxLength={TITLE_MAX}
            spellCheck={false}
            aria-label="Playground 标题"
            disabled={!ready}
            onChange={(e) => dispatch({ type: 'title', title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {saveState && (
            <span className={`pg-save-state${dirty ? ' dirty' : ''}`} title={dirty ? `有未保存的修改（${MOD}+S 保存）` : undefined}>
              {dirty && <i />}
              <span className="pg-save-text">{saveState}</span>
            </span>
          )}
        </div>
        <div className="pg-actions pg-hide-narrow">
          <button className="btn" onClick={() => setExamplesOpen(true)} title="示例">
            <BookOpen size={15} strokeWidth={1.75} />
            <span className="pg-btn-label">示例</span>
          </button>
          <button className="btn" onClick={requestNew} title="新建 Playground">
            <FilePlus size={15} strokeWidth={1.75} />
            <span className="pg-btn-label">新建</span>
          </button>
          <button className="btn" onClick={() => void fork()} disabled={!meta.id || saving || !ready} title={meta.id ? '复制为新的 Playground（Fork）' : '保存后才能复制'}>
            <Copy size={15} strokeWidth={1.75} />
            <span className="pg-btn-label">复制</span>
          </button>
          <button className="btn" onClick={() => void share()} disabled={saving || !ready} title="复制分享链接">
            <Link2 size={15} strokeWidth={1.75} />
            <span className="pg-btn-label">分享</span>
          </button>
          <button className="btn" onClick={() => void save()} disabled={saving || !ready} title={`保存（${MOD}+S）`}>
            <Save size={15} strokeWidth={1.75} />
            <span className="pg-btn-label">{saving ? '保存中…' : '保存'}</span>
          </button>
        </div>
        <button className="icon-btn pg-show-narrow" onClick={() => void save()} disabled={saving || !ready} title="保存" aria-label="保存">
          <Save size={17} strokeWidth={1.75} />
        </button>
        {busy ? (
          <button className="btn pg-run pg-stop" onClick={stop} title="停止">
            <Square size={13} strokeWidth={2.2} fill="currentColor" />
            停止
          </button>
        ) : (
          <button className="btn btn-primary pg-run" onClick={() => void runSim()} disabled={!ready} title={`运行（${MOD}+Enter）`}>
            <Play size={14} strokeWidth={2} fill="currentColor" />
            运行
          </button>
        )}
        <button className="pg-round pg-hide-narrow" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色' : '切换到深色'} aria-label="切换主题">
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
        </button>
        <div className="pg-more pg-show-narrow">
          <button className={`icon-btn${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen((v) => !v)} aria-label="更多" aria-expanded={moreOpen}>
            <MoreHorizontal size={18} strokeWidth={1.75} />
          </button>
          {moreOpen && (
            <div className="popover menu pg-more-menu" role="menu">
              <div className="menu-item" role="menuitem" onClick={() => (setMoreOpen(false), setExamplesOpen(true))}>
                <span className="menu-icon"><BookOpen size={15} strokeWidth={1.75} /></span>
                <span className="menu-label">示例</span>
              </div>
              <div className="menu-item" role="menuitem" onClick={requestNew}>
                <span className="menu-icon"><FilePlus size={15} strokeWidth={1.75} /></span>
                <span className="menu-label">新建</span>
              </div>
              <div
                className={`menu-item${!meta.id ? ' disabled' : ''}`}
                role="menuitem"
                onClick={() => {
                  if (!meta.id) return;
                  setMoreOpen(false);
                  void fork();
                }}
              >
                <span className="menu-icon"><Copy size={15} strokeWidth={1.75} /></span>
                <span className="menu-label">复制（Fork）</span>
              </div>
              <div className="menu-item" role="menuitem" onClick={() => (setMoreOpen(false), void share())}>
                <span className="menu-icon"><Link2 size={15} strokeWidth={1.75} /></span>
                <span className="menu-label">分享链接</span>
              </div>
              <div className="menu-sep" />
              <div className="menu-item" role="menuitem" onClick={() => (setMoreOpen(false), toggleTheme())}>
                <span className="menu-icon">{theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}</span>
                <span className="menu-label">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {offline && (
        <div className="pg-banner" role="alert">
          <WifiOff size={15} strokeWidth={1.75} />
          <span className="pg-banner-text">无法连接到 WebEDA 服务器，仿真与保存暂不可用；你的修改会继续保存在本地。</span>
          <button className="btn btn-sm" onClick={() => void retryConnection()}>
            <RefreshCw size={13} strokeWidth={1.75} />
            重试
          </button>
        </div>
      )}

      <div className="pg-body">
        {narrow ? (
          drawerOpen && (
            <>
              <div className="pg-drawer-mask" onClick={() => setDrawerOpen(false)} />
              <aside className="pg-sidebar pg-drawer" aria-label="设置">
                <div className="pg-drawer-head">
                  <span>设置</span>
                  <button className="modal-x" onClick={() => setDrawerOpen(false)} aria-label="关闭">
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
                {ready && sidebar}
              </aside>
            </>
          )
        ) : (
          sidebarOpen && (
            <aside className="pg-sidebar" aria-label="设置">
              {ready && sidebar}
            </aside>
          )
        )}

        <main className="pg-main">
          {load.status === 'loading' ? (
            <div className="panel pg-state">
              <div className="spinner" />
              <span>正在加载…</span>
            </div>
          ) : load.status === 'error' ? (
            <div className="panel pg-state">
              <WifiOff size={34} strokeWidth={1.4} />
              <span>加载失败：{load.message}</span>
              <div className="pg-state-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    loadedKey.current = null;
                    setLoadNonce((n) => n + 1);
                  }}
                >
                  <RefreshCw size={13} strokeWidth={1.75} />
                  重试
                </button>
                <button className="btn btn-sm" onClick={() => navigate('/playground')}>
                  打开草稿
                </button>
              </div>
            </div>
          ) : (
            <SplitPane direction="vertical" initial="62%" min={140} minSecond={120} storageKey="playground.bottom" collapsedSecond={bottomCollapsed} className="pg-split">
              {editors}
              {bottom}
            </SplitPane>
          )}
        </main>
      </div>

      <footer className="statusbar pg-status">
        <StatusDot status={shownStatus} label={statusLabel} />
        {shownStage && busy && <span className="pg-status-stage">{shownStage}</span>}
        {shownElapsed !== null && <span className="tabular">{formatDuration(shownElapsed)}</span>}
        <span className="pg-status-tool pg-hide-narrow">
          {iverilog ? `Icarus Verilog ${iverilog.version ?? ''}`.trim() : toolsError ? '工具信息不可用' : ''}
        </span>
        <span className="spacer" />
        <span className="pg-hints pg-hide-narrow">
          <kbd>{MOD}</kbd>+<kbd>Enter</kbd> 运行 · <kbd>{MOD}</kbd>+<kbd>S</kbd> 保存
        </span>
        <button
          className="icon-btn pg-status-btn"
          onClick={() => setBottomCollapsed((v) => !v)}
          title={bottomCollapsed ? '显示底部面板' : '隐藏底部面板'}
          aria-label={bottomCollapsed ? '显示底部面板' : '隐藏底部面板'}
          disabled={!ready}
        >
          {bottomCollapsed ? <PanelBottomOpen size={15} strokeWidth={1.75} /> : <PanelBottomClose size={15} strokeWidth={1.75} />}
        </button>
      </footer>

      <ExamplesModal open={examplesOpen} onClose={() => setExamplesOpen(false)} onPick={pickExample} />

      <PromptDialog
        open={addPane !== null}
        title={addPane === 'tb' ? '新建测试平台文件' : '新建设计文件'}
        label="文件名"
        initial={addPane ? uniqueFileName(addPane === 'tb' ? 'tb_new' : 'module', defaultExt, fileNames) : ''}
        hint="支持 .sv .v .svh .vh 以及 .hex .mem 等存储器初始化文件；不写扩展名时自动补全"
        confirmLabel="创建"
        transform={(v) => normalizeFileName(v, defaultExt)}
        validate={(v) => validateFileName(v, fileNames)}
        onSubmit={(name) => addPane && addFile(addPane, name)}
        onCancel={() => setAddPane(null)}
      />

      <ShareDialog
        url={shareUrl}
        onClose={() => setShareUrl(null)}
        onCopy={(url) =>
          void copyText(url).then((ok) => {
            if (ok) {
              toast('链接已复制到剪贴板', 'success');
              setShareUrl(null);
            } else toast('复制失败，请选中链接后按 Ctrl+C', 'error');
          })
        }
      />

      <ConfirmDialog
        open={!!deleting}
        title="删除文件"
        danger
        confirmLabel="删除"
        message={
          <>
            确定从当前 Playground 中删除 <b className="pg-mono">{deleting?.name}</b> 吗？文件内容会一并移除。
          </>
        }
        onConfirm={() => deleteId && deleteFile(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmNew}
        title="新建 Playground"
        danger
        confirmLabel="放弃草稿并新建"
        message="本地草稿中有尚未保存的修改，新建会覆盖这份草稿。"
        onConfirm={() => {
          setConfirmNew(false);
          doNew();
        }}
        onCancel={() => setConfirmNew(false)}
      />

      <ConfirmDialog
        open={!!pendingExample}
        title="加载示例"
        confirmLabel="替换草稿"
        cancelLabel="保留草稿"
        message="本地草稿中有尚未保存的修改，加载示例会替换这份草稿。"
        onConfirm={() => {
          confirmedExample.current = pendingExample;
          setPendingExample(null);
          setLoadNonce((n) => n + 1);
        }}
        onCancel={() => {
          setPendingExample(null);
          navigate('/playground', { replace: true });
        }}
      />
    </div>
  );
}
