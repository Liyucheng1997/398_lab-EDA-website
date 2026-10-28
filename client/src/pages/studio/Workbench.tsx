import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileCode2, Gamepad2, LayoutDashboard, X } from 'lucide-react';
import type {
  Diagnostic,
  FileRole,
  HierarchyNode,
  ImplementResult,
  JobInfo,
  JobRequest,
  JobResult,
  Project,
  RunRecord,
  SourceFile,
  SynthesizeResult,
} from '@webeda/shared';
import { getBoard, getDevice } from '@webeda/shared';
import { api } from '../../lib/api';
import { CodeEditor } from '../../features/editor/CodeEditor';
import { Modal } from '../../ui/Modal';
import { SplitPane } from '../../ui/SplitPane';
import { toast } from '../../ui/toast';
import { BottomPanel, FLOW_LABEL, type BottomTab, type ReportView } from './BottomPanel';
import { BoardTab, DeviceTab, ElaboratedView, SimulationTab, SynthesizedView, VIEW_ICONS } from './DesignViews';
import { AddFileModal, ConfirmModal, RenameModal } from './FileDialogs';
import { FlowNavigator, type NavAction } from './FlowNavigator';
import type { MessageGroup } from './ReportViews';
import { SettingsModal, type SettingsDraft } from './SettingsModal';
import { SourcesPanel } from './SourcesPanel';
import { StatusBar } from './StatusBar';
import { SummaryView, type SummaryRun } from './SummaryView';
import { TopBar } from './TopBar';
import {
  defaultFileContent,
  fileOfModule,
  filesForKind,
  inferRole,
  inputHash,
  isHdlName,
  roleOf,
  synthTarget,
  validateFileName,
  type FlowKind,
} from './model';
import {
  formatMHz,
  formatNs,
  latestRun,
  nextRunName,
  pickResource,
  rowsFromSummary,
  summarizeResult,
  timingSummary,
  type RunKind,
} from './reports';
import { isActive, useFlowRunner, type FlowRun } from './useFlowRunner';
import type { ProjectDoc } from './useProjectDoc';
import { downloadUrl, useMediaQuery, useNow } from './useStudioUi';
import { isTerminal } from './jobStream';

type ViewId = 'summary' | 'elab' | 'synth' | 'device' | 'sim' | 'board';
type TabId = ViewId | `file:${string}`;

const VIEW_LABEL: Record<ViewId, { label: string; en: string }> = {
  summary: { label: '工程概览', en: 'Project Summary' },
  elab: { label: 'RTL 设计', en: 'Elaborated Design' },
  synth: { label: '综合后设计', en: 'Synthesized Design' },
  device: { label: '器件', en: 'Device' },
  sim: { label: '仿真波形', en: 'Simulation' },
  board: { label: '虚拟开发板', en: 'Virtual Board' },
};

const RUN_KINDS: RunKind[] = ['simulate', 'synthesize', 'implement'];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 64;

const isFileTab = (t: TabId): t is `file:${string}` => t.startsWith('file:');
const fileOfTab = (t: TabId) => (isFileTab(t) ? t.slice(5) : null);

function lastResult<K extends JobResult['kind']>(run: FlowRun | undefined, kind: K): Extract<JobResult, { kind: K }> | null {
  const r = run?.last?.result;
  return r && r.kind === kind ? (r as Extract<JobResult, { kind: K }>) : null;
}

function diagsOf(run: FlowRun | undefined): Diagnostic[] {
  if (!run) return [];
  const info = run.info ?? run.last;
  if (!info) return run.error ? [{ severity: 'error', message: run.error, tool: 'webeda' }] : [];
  const list = info.result?.diagnostics ?? [];
  if (info.status === 'failed' && info.error && !list.some((d) => d.severity === 'error')) {
    return [{ severity: 'error', message: info.error, tool: 'webeda' }, ...list];
  }
  return list;
}

export function Workbench({ doc }: { doc: ProjectDoc }) {
  const project = doc.project as Project;
  const { update, flush, getLatest } = doc;
  const settings = project.settings;
  const device = getDevice(settings.device);
  const board = getBoard(settings.board);
  const pnr = device?.pnr ?? false;

  const runner = useFlowRunner();
  const { flows } = runner;

  /* ───────── 布局状态 ───────── */
  const narrow = useMediaQuery('(max-width: 760px)');
  const [navOpen, setNavOpen] = useState(() => !(window.matchMedia?.('(max-width: 760px)').matches ?? false));
  // 宽窄切换时：窄屏收起导航（抽屉），回到宽屏时展开
  useEffect(() => {
    setNavOpen(!narrow);
  }, [narrow]);

  const [tabs, setTabs] = useState<TabId[]>(['summary']);
  const [active, setActive] = useState<TabId>('summary');
  const [reveal, setReveal] = useState<{ line: number; column?: number } | null>(null);
  const [elabModule, setElabModule] = useState<string | undefined>();
  const [bottomTab, setBottomTab] = useState<BottomTab>('console');
  const [reportView, setReportView] = useState<ReportView>('util-synth');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addFile, setAddFile] = useState<{ role?: FileRole } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bitDialog, setBitDialog] = useState<{ jobId: string; name: string; result: ImplementResult } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const anyActive = (Object.values(flows) as FlowRun[]).some(isActive);
  const now = useNow(anyActive ? 1000 : 30000);

  useEffect(() => {
    document.title = `${project.name} · WebEDA Studio`;
  }, [project.name]);

  /* ───────── 输入摘要（判断结果是否过期） ───────── */
  const deferredFiles = useDeferredValue(project.files);
  const deferredSettings = useDeferredValue(project.settings);
  const hashes = useMemo(() => {
    const p = { files: deferredFiles, settings: deferredSettings };
    return {
      simulate: inputHash('simulate', p),
      elaborate: inputHash('elaborate', p),
      synthesize: inputHash('synthesize', p),
      implement: inputHash('implement', p),
      gatesim: inputHash('gatesim', p),
    } satisfies Record<FlowKind, string>;
  }, [deferredFiles, deferredSettings]);
  const stale = (k: FlowKind) => {
    const r = flows[k];
    return !!(r?.last && r.lastHash && r.lastHash !== hashes[k]);
  };

  /* ───────── 运行记录 ───────── */
  const recordStart = useCallback(
    (kind: RunKind, jobId: string, hash: string, meta?: Record<string, unknown>) => {
      update((p) => {
        const rec: RunRecord = {
          id: nextRunName(p.runs, kind),
          kind,
          jobId,
          status: 'running',
          startedAt: new Date().toISOString(),
          summary: { inputHash: hash, ...(meta?.bitstream ? { wantBitstream: 1 } : {}) },
        };
        return { ...p, runs: [...p.runs, rec].slice(-50) };
      });
    },
    [update],
  );

  const recordEnd = useCallback(
    (jobId: string, info: JobInfo | null, fallbackStatus: RunRecord['status'] = 'failed') => {
      update((p) => {
        if (!p.runs.some((r) => r.jobId === jobId)) return p;
        return {
          ...p,
          runs: p.runs.map((r) => {
            if (r.jobId !== jobId) return r;
            const started = Date.parse(r.startedAt);
            const finished = info?.finishedAt ? Date.parse(info.finishedAt) : Date.now();
            const keep: Record<string, string | number> = {};
            if (r.summary?.inputHash != null) keep.inputHash = r.summary.inputHash;
            if (r.summary?.wantBitstream != null) keep.wantBitstream = r.summary.wantBitstream;
            return {
              ...r,
              status: info?.status ?? fallbackStatus,
              durationMs: info?.result?.durationMs ?? (Number.isFinite(started) ? Math.max(0, finished - started) : undefined),
              summary: { ...keep, ...summarizeResult(info?.result) },
            };
          }),
        };
      });
    },
    [update],
  );

  /* ───────── 运行任务 ───────── */
  const openTab = useCallback((t: TabId) => {
    setTabs((ts) => (ts.includes(t) ? ts : [...ts, t]));
    setActive(t);
  }, []);

  const runFlow = useCallback(
    async (kind: FlowKind, opts: { bitstream?: boolean } = {}): Promise<JobInfo | null> => {
      const p = getLatest();
      if (!p) return null;
      const s = p.settings;
      const dev = getDevice(s.device);
      const designHdl = p.files.filter((f) => roleOf(f) === 'design' && isHdlName(f.name));
      if (!designHdl.length && kind !== 'simulate') {
        toast('工程中没有设计源文件，请先添加 .v / .sv 文件', 'error');
        return null;
      }
      let req: JobRequest;
      switch (kind) {
        case 'simulate': {
          const files = filesForKind(p.files, 'simulate');
          if (!files.some((f) => isHdlName(f.name))) {
            toast('工程中没有可仿真的 HDL 文件', 'error');
            return null;
          }
          if (!files.some((f) => f.role === 'testbench')) toast('没有仿真源文件（测试平台），将直接仿真设计顶层', 'info');
          req = { kind, files, options: { ...s.simulate, top: s.simTop || undefined } };
          break;
        }
        case 'elaborate':
          req = { kind, files: filesForKind(p.files, 'elaborate'), options: { top: s.top || undefined, flatten: false } };
          break;
        case 'synthesize':
          req = {
            kind,
            files: filesForKind(p.files, 'synthesize'),
            options: { top: s.top || undefined, target: synthTarget(s.device), device: s.device, flatten: s.synth?.flatten ?? true, schematic: true },
          };
          break;
        case 'implement': {
          if (!dev?.pnr) {
            toast(`${dev?.name ?? '该器件'} 暂不支持开源布局布线`, 'error');
            return null;
          }
          let constraintFile = s.constraintFile;
          if (constraintFile && !p.files.some((f) => f.name === constraintFile)) {
            toast(`约束文件 ${constraintFile} 不存在，已忽略`, 'error');
            constraintFile = undefined;
          }
          if (!constraintFile) toast('没有约束文件：引脚将由布局器自动分配', 'info');
          req = {
            kind,
            files: filesForKind(p.files, 'implement', constraintFile),
            options: { top: s.top || undefined, device: s.device, constraintFile, freqMHz: s.freqMHz, bitstream: !!opts.bitstream },
          };
          break;
        }
        case 'gatesim':
          req = { kind, files: filesForKind(p.files, 'gatesim'), options: { top: s.top || undefined, params: s.gatesimParams } };
          break;
      }
      const hash = inputHash(kind, p);
      const runKind = (RUN_KINDS as string[]).includes(kind) ? (kind as RunKind) : null;
      let jobId: string | null = null;
      void flush();
      if (runKind) {
        setBottomTab((t) => (t === 'console' ? t : 'log'));
      }
      const meta = kind === 'implement' ? { bitstream: !!opts.bitstream } : undefined;
      const info = await runner.start(kind, req, {
        hash,
        meta,
        onCreated: (id) => {
          jobId = id;
          if (runKind) recordStart(runKind, id, hash, meta);
        },
      });
      if (runKind && jobId) recordEnd(jobId, info);
      return info;
    },
    [flush, getLatest, recordEnd, recordStart, runner],
  );

  const afterRun = useCallback(
    (kind: FlowKind, info: JobInfo | null) => {
      if (!info) return;
      const label = FLOW_LABEL[kind];
      if (info.status === 'cancelled') {
        toast(`${label}已取消`);
        return;
      }
      if (info.status !== 'succeeded') {
        toast(`${label}失败${info.error ? `：${info.error}` : ''}`, 'error', 4000);
        const hasDiag = info.result?.diagnostics?.some((d) => d.severity === 'error');
        setBottomCollapsed(false);
        setBottomTab(hasDiag ? 'messages' : 'log');
        return;
      }
      const r = info.result;
      if (r?.kind === 'simulate') {
        toast(r.timedOut ? '仿真超时' : `仿真完成${r.exitCode ? `（退出码 ${r.exitCode}）` : ''}`, r.timedOut ? 'error' : 'success');
        openTab('sim');
      } else if (r?.kind === 'synthesize') {
        const lut = pickResource(r.utilization.rows, 'LUT');
        const ff = pickResource(r.utilization.rows, 'FF');
        toast(`综合完成${lut ? ` · ${lut.resource} ${lut.used}` : ''}${ff ? ` · FF ${ff.used}` : ''}`, 'success');
      } else if (r?.kind === 'implement') {
        const t = timingSummary(r.timing);
        if (r.bitstream) {
          setBitDialog({ jobId: info.id, name: r.bitstream, result: r });
        } else {
          toast(`实现完成${t ? ` · Fmax ${formatMHz(t.fmax)} · WNS ${formatNs(t.wns, 2)}` : ''}`, t && !t.passed ? 'error' : 'success');
        }
      }
    },
    [openTab],
  );

  const run = useCallback(
    async (kind: FlowKind, opts?: { bitstream?: boolean }) => {
      const info = await runFlow(kind, opts);
      afterRun(kind, info);
      return info;
    },
    [afterRun, runFlow],
  );

  const implRun = flows.implement;
  const implResult = lastResult(implRun, 'implement');
  const bitstreamInfo =
    implRun?.last && implResult?.bitstream && implRun.last.status === 'succeeded'
      ? { jobId: implRun.last.id, name: implResult.bitstream, size: implRun.last.result?.artifacts.find((a) => a.name === implResult.bitstream)?.size }
      : null;

  const generateBitstream = useCallback(() => {
    if (bitstreamInfo && !stale('implement') && implResult) {
      setBitDialog({ jobId: bitstreamInfo.jobId, name: bitstreamInfo.name, result: implResult });
      return;
    }
    void run('implement', { bitstream: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitstreamInfo, implResult, run, hashes]);

  const downloadBitstream = useCallback(() => {
    if (!bitstreamInfo) {
      toast('还没有比特流，请先生成比特流', 'error');
      return;
    }
    downloadUrl(api.artifactUrl(bitstreamInfo.jobId, bitstreamInfo.name, true), bitstreamInfo.name);
  }, [bitstreamInfo]);

  const stopAll = useCallback(() => {
    void runner.cancel();
  }, [runner]);

  /* ───────── 页面刷新后恢复运行记录与结果 ───────── */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const p = getLatest();
    if (!p) return;
    const latestIds = new Set<string>();
    for (const kind of RUN_KINDS) {
      const rec = latestRun(p.runs, kind);
      if (!rec?.jobId) continue;
      latestIds.add(rec.jobId);
      const hash = typeof rec.summary?.inputHash === 'string' ? rec.summary.inputHash : undefined;
      const meta = kind === 'implement' ? { bitstream: !!rec.summary?.wantBitstream || !!rec.summary?.bitstream } : undefined;
      api.getJob(rec.jobId).then(
        (info) => {
          if (!isTerminal(info.status)) {
            void runner.attach(kind, rec.jobId, Date.parse(rec.startedAt) || Date.now(), { hash, meta }).then((final) => {
              recordEnd(rec.jobId, final, 'cancelled');
              afterRun(kind, final);
            });
          } else {
            runner.restore(kind, info, hash, meta);
            if (rec.status === 'running' || rec.status === 'queued') recordEnd(rec.jobId, info);
          }
        },
        () => {
          if (rec.status === 'running' || rec.status === 'queued') recordEnd(rec.jobId, null, 'cancelled');
        },
      );
    }
    // 更早的、仍显示"运行中"的记录：向服务端核对最终状态
    for (const rec of p.runs) {
      if (latestIds.has(rec.jobId) || (rec.status !== 'running' && rec.status !== 'queued')) continue;
      api.getJob(rec.jobId).then(
        (info) => isTerminal(info.status) && recordEnd(rec.jobId, info),
        () => recordEnd(rec.jobId, null, 'cancelled'),
      );
    }
    // 只在打开工程时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── 视图打开 ───────── */
  const openView = useCallback(
    (v: ViewId) => {
      openTab(v);
      if (narrow) setNavOpen(false);
      const need = (k: FlowKind) => !isActive(flows[k]) && (!flows[k]?.last || stale(k));
      if (v === 'elab' && need('elaborate')) void run('elaborate');
      if (v === 'synth' && !flows.synthesize?.last && !isActive(flows.synthesize)) void run('synthesize');
      if (v === 'device' && pnr && !flows.implement?.last && !isActive(flows.implement)) void run('implement');
      if (v === 'board' && !flows.gatesim?.last && !isActive(flows.gatesim)) void run('gatesim');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [flows, hashes, narrow, openTab, pnr, run],
  );

  const openFile = useCallback(
    (name: string) => {
      openTab(`file:${name}`);
      if (narrow) setNavOpen(false);
    },
    [narrow, openTab],
  );

  const closeTab = useCallback(
    (t: TabId) => {
      if (t === 'summary') return;
      setTabs((ts) => {
        const idx = ts.indexOf(t);
        const next = ts.filter((x) => x !== t);
        setActive((a) => (a === t ? next[Math.min(idx, next.length - 1)] ?? 'summary' : a));
        return next.length ? next : ['summary'];
      });
    },
    [],
  );

  const jumpTo = useCallback(
    (file: string, line: number) => {
      const p = getLatest();
      if (!p) return;
      const clean = file.replace(/^\.\//, '');
      const target =
        p.files.find((f) => f.name === clean) ?? p.files.find((f) => f.name.endsWith(`/${clean}`) || clean.endsWith(`/${f.name}`));
      if (!target) {
        toast(`工程中没有文件 ${file}`, 'error');
        return;
      }
      openFile(target.name);
      setReveal({ line: Math.max(1, line) });
      // 编辑器首次挂载是异步的：稍后再跳一次
      setTimeout(() => setReveal({ line: Math.max(1, line) }), 350);
    },
    [getLatest, openFile],
  );

  const onNav = useCallback(
    (a: NavAction | 'openSimulation') => {
      switch (a) {
        case 'settings':
          setSettingsOpen(true);
          break;
        case 'addSources':
          setAddFile({});
          break;
        case 'simulate':
          void run('simulate');
          break;
        case 'openSimulation':
          openView('sim');
          break;
        case 'openElaborated':
          openView('elab');
          break;
        case 'synthesize':
          void run('synthesize');
          break;
        case 'openSynthesized':
          openView('synth');
          break;
        case 'reportUtilization':
          setReportView(flows.implement?.last && implResult ? 'util-impl' : 'util-synth');
          setBottomTab('reports');
          setBottomCollapsed(false);
          break;
        case 'implement':
          void run('implement');
          break;
        case 'openImplemented':
          openView('device');
          break;
        case 'reportTiming':
          setReportView('timing');
          setBottomTab('reports');
          setBottomCollapsed(false);
          break;
        case 'bitstream':
          generateBitstream();
          break;
        case 'downloadBitstream':
          downloadBitstream();
          break;
        case 'virtualBoard':
          openView('board');
          break;
      }
      if (narrow && a !== 'settings' && a !== 'addSources') setNavOpen(false);
    },
    [downloadBitstream, flows.implement?.last, generateBitstream, implResult, narrow, openView, run],
  );

  /* ───────── 文件操作 ───────── */
  const createFile = (name: string, role: FileRole) => {
    const p = getLatest();
    if (!p) return;
    if (p.files.length >= MAX_FILES) {
      toast(`文件数已达上限 ${MAX_FILES}`, 'error');
      return;
    }
    update((pp) => ({ ...pp, files: [...pp.files, { name, role, content: defaultFileContent(name, role) }] }));
    if (role === 'constraint' && !p.settings.constraintFile) update((pp) => ({ ...pp, settings: { ...pp.settings, constraintFile: name } }));
    setAddFile(null);
    openFile(name);
  };

  const importFiles = async (list: FileList) => {
    const p = getLatest();
    if (!p) return;
    const added: SourceFile[] = [];
    const replaced: string[] = [];
    const skipped: string[] = [];
    let count = p.files.length;
    for (const f of Array.from(list)) {
      const name = f.name.replace(/[^\w\-. ]/g, '_').replace(/^\.+/, '_');
      if (f.size > MAX_IMPORT_BYTES) {
        skipped.push(`${f.name}（超过 2 MB）`);
        continue;
      }
      let text: string;
      try {
        text = await f.text();
      } catch {
        skipped.push(`${f.name}（读取失败）`);
        continue;
      }
      if (text.includes('\u0000')) {
        skipped.push(`${f.name}（二进制文件）`);
        continue;
      }
      const exists = p.files.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        replaced.push(exists.name);
        added.push({ ...exists, content: text });
        continue;
      }
      if (validateFileName(name, [...p.files.map((x) => x.name), ...added.map((x) => x.name)])) {
        skipped.push(`${f.name}（文件名不合法）`);
        continue;
      }
      if (count >= MAX_FILES) {
        skipped.push(`${f.name}（文件数已达上限）`);
        continue;
      }
      count++;
      added.push({ name, content: text, role: inferRole(name) });
    }
    if (added.length) {
      update((pp) => {
        const byName = new Map(added.map((a) => [a.name, a]));
        const files = pp.files.map((x) => byName.get(x.name) ?? x);
        const fresh = added.filter((a) => !pp.files.some((x) => x.name === a.name));
        const all = [...files, ...fresh];
        const constraintFile = pp.settings.constraintFile ?? fresh.find((x) => x.role === 'constraint')?.name;
        return { ...pp, files: all, settings: { ...pp.settings, constraintFile } };
      });
      const n = added.length - replaced.length;
      toast(`${n ? `已导入 ${n} 个文件` : ''}${n && replaced.length ? '，' : ''}${replaced.length ? `已更新 ${replaced.length} 个同名文件` : ''}`, 'success');
      const first = added[0];
      if (first) openFile(first.name);
    }
    if (skipped.length) toast(`已跳过：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ` 等 ${skipped.length} 个` : ''}`, 'error', 4500);
    setAddFile(null);
  };

  const renameFile = (from: string, to: string) => {
    update((p) => ({
      ...p,
      files: p.files.map((f) => (f.name === from ? { ...f, name: to, role: f.role ?? inferRole(from) } : f)),
      settings: p.settings.constraintFile === from ? { ...p.settings, constraintFile: to } : p.settings,
    }));
    const ft: TabId = `file:${from}`;
    const tt: TabId = `file:${to}`;
    setTabs((ts) => ts.map((t) => (t === ft ? tt : t)));
    setActive((a) => (a === ft ? tt : a));
    setRenaming(null);
  };

  const deleteFile = (name: string) => {
    update((p) => {
      const files = p.files.filter((f) => f.name !== name);
      let constraintFile = p.settings.constraintFile;
      if (constraintFile === name) {
        const ext = getDevice(p.settings.device)?.constraintExt;
        constraintFile = files.find((f) => roleOf(f) === 'constraint' && (!ext || f.name.endsWith(ext)))?.name;
      }
      return { ...p, files, settings: { ...p.settings, constraintFile } };
    });
    closeTab(`file:${name}`);
    setDeleting(null);
    toast(`已删除 ${name}`);
  };

  const setSetting = <K extends keyof Project['settings']>(key: K, value: Project['settings'][K]) =>
    update((p) => ({ ...p, settings: { ...p.settings, [key]: value } }));

  const applySettings = (d: SettingsDraft) => {
    update((p) => ({ ...p, name: d.name || p.name, description: d.description || undefined, settings: d.settings }));
    setSettingsOpen(false);
    toast('设置已更新', 'success');
  };

  /* ───────── 快捷键 ───────── */
  const keyActions = useRef({ run, flush, generateBitstream, toggleNav: () => setNavOpen((o) => !o) });
  keyActions.current = { run, flush, generateBitstream, toggleNav: () => setNavOpen((o) => !o) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = keyActions.current;
      const modalOpen = !!document.querySelector('.modal-overlay');
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        void k.flush();
        return;
      }
      if (modalOpen) return;
      if (e.key === 'Enter' && mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void k.run('synthesize');
      } else if (e.key === 'Enter' && mod && e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void k.run('implement');
      } else if (e.key === 'Enter' && e.altKey && !mod && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void k.run('simulate');
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        k.generateBitstream();
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        k.toggleNav();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /* ───────── 派生数据 ───────── */
  const synthRun = flows.synthesize;
  const synthResult = lastResult(synthRun, 'synthesize') as SynthesizeResult | null;
  const elabResult = lastResult(flows.elaborate, 'elaborate');
  const simRun = flows.simulate;

  const latestSynthRec = latestRun(project.runs, 'synthesize', (r) => r.status === 'succeeded');
  const latestImplRec = latestRun(project.runs, 'implement', (r) => r.status === 'succeeded');
  const synthUtilRows = synthResult?.utilization.rows ?? (latestSynthRec ? rowsFromSummary(latestSynthRec.summary, device?.resources) : null);
  const implUtilRows = implResult?.utilization.rows ?? (latestImplRec ? rowsFromSummary(latestImplRec.summary, device?.resources) : null);
  const recStale = (rec: RunRecord | undefined, k: FlowKind) =>
    !!rec && typeof rec.summary?.inputHash === 'string' && rec.summary.inputHash !== hashes[k];

  const timing =
    timingSummary(implResult?.timing) ??
    (latestImplRec && typeof latestImplRec.summary?.Fmax === 'number' && typeof latestImplRec.summary?.WNS === 'number'
      ? {
          clock: '—',
          fmax: latestImplRec.summary.Fmax,
          wns: latestImplRec.summary.WNS,
          constraintMHz: settings.freqMHz,
          passed: latestImplRec.summary.timingMet === 1,
        }
      : null);

  const summaryRuns: SummaryRun[] = RUN_KINDS.map((k) => {
    const r = flows[k];
    const rec = latestRun(project.runs, k);
    const activeNow = isActive(r);
    return {
      key: k,
      label: k === 'simulate' ? '行为仿真' : k === 'synthesize' ? '综合' : '实现',
      en: k === 'simulate' ? 'sim_1' : k === 'synthesize' ? 'synth_1' : 'impl_1',
      status: activeNow ? r!.status : (rec?.status ?? r?.status ?? 'idle'),
      startedAt: activeNow && r?.startedAt ? new Date(r.startedAt).toISOString() : rec?.startedAt,
      durationMs: rec?.durationMs,
      stale: r?.last ? stale(k) : recStale(rec, k),
    };
  });

  const messageGroups: MessageGroup[] = (['simulate', 'elaborate', 'synthesize', 'implement', 'gatesim'] as FlowKind[]).map((k) => ({
    key: k,
    label: FLOW_LABEL[k],
    diagnostics: diagsOf(flows[k]),
  }));
  const editorDiags = useMemo(() => {
    const seen = new Set<string>();
    const out: Diagnostic[] = [];
    for (const g of messageGroups) {
      for (const d of g.diagnostics) {
        if (!d.file || !d.line) continue;
        const key = `${d.file}:${d.line}:${d.severity}:${d.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
      }
    }
    return out;
    // messageGroups 由 flows 派生
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows]);

  const navStatus = {
    simulate: simRun?.status ?? latestRun(project.runs, 'simulate')?.status ?? 'idle',
    elaborate: flows.elaborate?.status ?? 'idle',
    synthesize: synthRun?.status ?? latestRun(project.runs, 'synthesize')?.status ?? 'idle',
    implement: implRun && !implRun.meta?.bitstream ? implRun.status : 'idle',
    bitstream: implRun?.meta?.bitstream ? implRun.status : bitstreamInfo ? 'succeeded' : 'idle',
    gatesim: flows.gatesim?.status ?? 'idle',
  } as const;

  const activeFile = fileOfTab(active);
  const activeFileObj = activeFile ? project.files.find((f) => f.name === activeFile) : undefined;
  const statusKind = runner.lastKind;
  const activeCount = (Object.values(flows) as FlowRun[]).filter(isActive).length;
  const fileNames = project.files.map((f) => f.name);

  // 打开的文件被删除/重命名后关闭对应标签
  useEffect(() => {
    setTabs((ts) => {
      const next = ts.filter((t) => !isFileTab(t) || fileNames.includes(t.slice(5)));
      return next.length === ts.length ? ts : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileNames.join('\n')]);
  useEffect(() => {
    if (!tabs.includes(active)) setActive(tabs[tabs.length - 1] ?? 'summary');
  }, [tabs, active]);

  const onSelectHierarchy = (node: HierarchyNode) => {
    setElabModule(node.module);
    if (elabResult?.schematics[node.module]) {
      openTab('elab');
    } else {
      const f = fileOfModule(project.files, node.module);
      if (f) openFile(f);
      else openTab('elab');
    }
  };

  const tabIcon = (t: TabId) => {
    if (isFileTab(t)) return <FileCode2 size={14} strokeWidth={1.75} />;
    if (t === 'summary') return <LayoutDashboard size={14} strokeWidth={1.75} />;
    return VIEW_ICONS[t];
  };

  const viewTabs = tabs.filter((t): t is ViewId => !isFileTab(t));

  return (
    <div className="st-root">
      <TopBar
        name={project.name}
        onRename={(name) => update((p) => ({ ...p, name }))}
        device={device}
        saveState={doc.saveState}
        saveError={doc.saveError}
        onSave={() => void flush()}
        running={{
          simulate: isActive(simRun),
          synthesize: isActive(synthRun),
          implement: isActive(implRun),
          bitstream: isActive(implRun),
        }}
        anyRunning={anyActive}
        onSimulate={() => void run('simulate')}
        onSynthesize={() => void run('synthesize')}
        onImplement={() => void run('implement')}
        onBitstream={generateBitstream}
        onStop={stopAll}
        onSettings={() => setSettingsOpen(true)}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((o) => !o)}
      />
      <div className={`st-main${navOpen ? ' st-nav-open' : ''}`}>
        {navOpen && narrow && <div className="st-scrim" onClick={() => setNavOpen(false)} />}
        {navOpen && (
          <aside className="st-left" aria-label="导航与源文件">
            <SplitPane direction="vertical" initial="52%" min={120} minSecond={140} storageKey="studio-left">
              <div className="panel st-nav-panel">
                <div className="panel-header st-panel-header">
                  Flow Navigator
                </div>
                <div className="panel-body">
                  <FlowNavigator status={navStatus} pnr={pnr} hasBitstream={!!bitstreamInfo} onAction={onNav} />
                </div>
              </div>
              <SourcesPanel
                files={project.files}
                settings={settings}
                activeFile={activeFile ?? undefined}
                onOpen={openFile}
                onAdd={(role) => setAddFile({ role })}
                onImport={(l) => void importFiles(l)}
                onRename={setRenaming}
                onDelete={setDeleting}
                onSetTop={(m) => {
                  setSetting('top', m);
                  toast(`顶层模块：${m}`, 'success');
                }}
                onSetSimTop={(m) => {
                  setSetting('simTop', m);
                  toast(`仿真顶层：${m}`, 'success');
                }}
                onSetConstraint={(n) => {
                  setSetting('constraintFile', n);
                  toast(`约束文件：${n}`, 'success');
                }}
                onSetRole={(name, role) => update((p) => ({ ...p, files: p.files.map((f) => (f.name === name ? { ...f, role } : f)) }))}
                hierarchy={elabResult?.hierarchy ?? null}
                hierarchyLoading={isActive(flows.elaborate)}
                hierarchyStale={stale('elaborate')}
                onRunElaborate={() => void run('elaborate')}
                onSelectHierarchy={onSelectHierarchy}
                selectedModule={elabModule}
              />
            </SplitPane>
          </aside>
        )}
        <div className="st-center">
          <SplitPane
            direction="vertical"
            initial="68%"
            min={160}
            minSecond={120}
            storageKey="studio-bottom"
            className={bottomCollapsed ? 'st-split-collapsed' : ''}
          >
            <div className="panel st-workspace">
              <div className="tabs st-ws-tabs" role="tablist">
                {tabs.map((t) => {
                  const name = fileOfTab(t);
                  const label = name ? name.slice(name.lastIndexOf('/') + 1) : VIEW_LABEL[t as ViewId].label;
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={active === t}
                      className={`tab${active === t ? ' active' : ''}`}
                      title={name ?? VIEW_LABEL[t as ViewId].en}
                      onClick={() => setActive(t)}
                      onAuxClick={(e) => e.button === 1 && closeTab(t)}
                    >
                      {tabIcon(t)}
                      <span className="st-tab-label">{label}</span>
                      {t !== 'summary' && (
                        <span
                          className="tab-x"
                          role="button"
                          aria-label="关闭"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(t);
                          }}
                        >
                          <X size={12} strokeWidth={2} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="st-ws-body">
                {viewTabs.map((v) => (
                  <div key={v} className={`st-fill${active === v ? '' : ' st-hidden'}`}>
                    {v === 'summary' && (
                      <SummaryView
                        name={project.name}
                        description={project.description}
                        settings={settings}
                        device={device}
                        board={board}
                        synthUtil={synthUtilRows}
                        implUtil={implUtilRows}
                        synthStale={synthResult ? stale('synthesize') : recStale(latestSynthRec, 'synthesize')}
                        implStale={implResult ? stale('implement') : recStale(latestImplRec, 'implement')}
                        timing={timing}
                        timingStale={implResult ? stale('implement') : recStale(latestImplRec, 'implement')}
                        runs={summaryRuns}
                        bitstream={
                          bitstreamInfo
                            ? {
                                url: api.artifactUrl(bitstreamInfo.jobId, bitstreamInfo.name, true),
                                name: bitstreamInfo.name,
                                size: bitstreamInfo.size,
                                stale: stale('implement'),
                              }
                            : null
                        }
                        now={now}
                        onAction={onNav}
                      />
                    )}
                    {v === 'elab' && (
                      <ElaboratedView
                        info={flows.elaborate?.last ?? null}
                        running={isActive(flows.elaborate)}
                        stale={stale('elaborate')}
                        onRun={() => void run('elaborate')}
                        module={elabModule}
                        onModule={setElabModule}
                      />
                    )}
                    {v === 'synth' && (
                      <SynthesizedView info={synthRun?.last ?? null} running={isActive(synthRun)} stale={stale('synthesize')} onRun={() => void run('synthesize')} />
                    )}
                    {v === 'device' && (
                      <DeviceTab info={implRun?.last ?? null} running={isActive(implRun)} stale={stale('implement')} onRun={() => void run('implement')} pnr={pnr} />
                    )}
                    {v === 'sim' && (
                      <SimulationTab
                        info={simRun?.last ?? null}
                        running={isActive(simRun)}
                        stale={stale('simulate')}
                        onRun={() => void run('simulate')}
                        persistKey={`studio-${project.id}`}
                      />
                    )}
                    {v === 'board' && (
                      <BoardTab
                        info={flows.gatesim?.last ?? null}
                        running={isActive(flows.gatesim)}
                        stale={stale('gatesim')}
                        onRun={() => void run('gatesim')}
                        board={board}
                      />
                    )}
                  </div>
                ))}
                {activeFile &&
                  (activeFileObj ? (
                    <div className="st-fill st-editor">
                      <CodeEditor
                        fileName={activeFileObj.name}
                        value={activeFileObj.content}
                        onChange={(v) =>
                          update((p) => ({ ...p, files: p.files.map((f) => (f.name === activeFileObj.name ? { ...f, content: v } : f)) }))
                        }
                        diagnostics={editorDiags}
                        onRun={() => void run('synthesize')}
                        onSave={() => void flush()}
                        reveal={reveal}
                      />
                    </div>
                  ) : (
                    <div className="empty">文件不存在</div>
                  ))}
              </div>
            </div>
            <BottomPanel
              tab={bottomTab}
              onTab={setBottomTab}
              reportView={reportView}
              onReportView={setReportView}
              collapsed={bottomCollapsed}
              onToggleCollapsed={() => setBottomCollapsed((c) => !c)}
              projectId={project.id}
              files={project.files}
              top={settings.top}
              messageGroups={messageGroups}
              onJump={jumpTo}
              flows={flows}
              lastKind={runner.lastKind}
              synthUtil={synthResult?.utilization ?? null}
              implUtil={implResult?.utilization ?? null}
              timing={implResult?.timing ?? null}
              runs={project.runs}
              now={now}
            />
          </SplitPane>
        </div>
      </div>
      <StatusBar
        kind={statusKind}
        run={statusKind ? (flows[statusKind] ?? null) : null}
        activeCount={activeCount}
        now={now}
        device={device}
        top={settings.top}
      />

      <SettingsModal
        open={settingsOpen}
        name={project.name}
        description={project.description}
        settings={settings}
        files={project.files}
        onClose={() => setSettingsOpen(false)}
        onApply={applySettings}
      />
      <AddFileModal
        open={!!addFile}
        initialRole={addFile?.role}
        constraintExt={device?.constraintExt ?? '.pcf'}
        existing={fileNames}
        onClose={() => setAddFile(null)}
        onCreate={createFile}
        onImport={() => importInput.current?.click()}
      />
      <input
        ref={importInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <RenameModal name={renaming} existing={fileNames} onClose={() => setRenaming(null)} onRename={renameFile} />
      <ConfirmModal
        open={!!deleting}
        title={`删除 ${deleting ?? ''}？`}
        message="文件将从工程中移除，此操作无法撤销。"
        confirmText="删除"
        danger
        onConfirm={() => deleting && deleteFile(deleting)}
        onClose={() => setDeleting(null)}
      />
      <Modal
        open={!!bitDialog}
        title="比特流已生成"
        onClose={() => setBitDialog(null)}
        width={420}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setBitDialog(null);
                openView('board');
              }}
            >
              <Gamepad2 size={14} strokeWidth={1.75} />
              虚拟开发板
            </button>
            {bitDialog && (
              <a
                className="btn btn-primary st-link-btn"
                href={api.artifactUrl(bitDialog.jobId, bitDialog.name, true)}
                download={bitDialog.name}
                onClick={() => setBitDialog(null)}
              >
                <Download size={14} strokeWidth={1.75} />
                下载 {bitDialog.name}
              </a>
            )}
          </>
        }
      >
        {bitDialog && <BitstreamSummary result={bitDialog.result} />}
      </Modal>
    </div>
  );
}

function BitstreamSummary({ result }: { result: ImplementResult }) {
  const t = timingSummary(result.timing);
  const lut = pickResource(result.utilization.rows, 'LUT');
  const ff = pickResource(result.utilization.rows, 'FF');
  return (
    <div className="st-bit-summary">
      <p className="modal-msg">实现与比特流生成已完成，可以下载后用 iceprog / openFPGALoader 烧录到开发板。</p>
      <div className="st-bit-stats">
        {t && (
          <>
            <div>
              <span className="st-stat-label">Fmax</span>
              <span className="st-stat-num">{formatMHz(t.fmax)}</span>
            </div>
            <div>
              <span className="st-stat-label">WNS</span>
              <span className={`st-stat-num ${t.wns < 0 ? 'st-bad' : ''}`}>{formatNs(t.wns, 2)}</span>
            </div>
          </>
        )}
        {lut && (
          <div>
            <span className="st-stat-label">{lut.resource}</span>
            <span className="st-stat-num">{lut.used.toLocaleString()}</span>
          </div>
        )}
        {ff && (
          <div>
            <span className="st-stat-label">FF</span>
            <span className="st-stat-num">{ff.used.toLocaleString()}</span>
          </div>
        )}
      </div>
      {t && !t.passed && <div className="st-form-error">时序未满足：设计可能无法在 {formatMHz(t.constraintMHz)} 下可靠工作。</div>}
    </div>
  );
}
