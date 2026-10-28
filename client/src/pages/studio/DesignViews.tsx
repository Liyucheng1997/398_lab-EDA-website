import { useMemo, type ReactNode } from 'react';
import { AlertCircle, CircuitBoard, Gamepad2, Grid3x3, Network, Play, RefreshCw, Waves } from 'lucide-react';
import type { BoardInfo, ElaborateResult, GatesimResult, ImplementResult, JobInfo, SimulateResult, SynthesizeResult } from '@webeda/shared';
import { api } from '../../lib/api';
import { DeviceView, SchematicViewer } from '../../features/schematic';
import { WaveformViewer } from '../../features/waveform';
import { VirtualBoard } from '../../features/board';
import { UtilRowsTable } from './ReportViews';
import { useArtifact } from './useArtifact';
import { formatDuration } from './reports';

/** 结果过期 / 失败提示条 */
export function InfoBar({ tone, children, action }: { tone: 'stale' | 'error' | 'info'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`st-infobar st-infobar-${tone}`}>
      {tone === 'error' ? <AlertCircle size={14} strokeWidth={1.75} /> : <RefreshCw size={13} strokeWidth={1.75} />}
      <span className="st-infobar-text">{children}</span>
      {action}
    </div>
  );
}

function EmptyRun({ icon, text, button, onRun, busy }: { icon: ReactNode; text: string; button: string; onRun: () => void; busy?: boolean }) {
  return (
    <div className="empty">
      {busy ? <div className="spinner" /> : icon}
      <span>{busy ? '运行中…' : text}</span>
      {!busy && (
        <button className="btn btn-sm btn-primary" onClick={onRun}>
          <Play size={14} strokeWidth={1.75} />
          {button}
        </button>
      )}
    </div>
  );
}

/** 失败任务的简短原因：任务错误或第一条错误诊断 */
export function failureText(info: JobInfo | null): string | null {
  if (!info || info.status === 'succeeded') return null;
  if (info.status === 'cancelled') return '任务已取消';
  const diag = info.result?.diagnostics?.find((d) => d.severity === 'error');
  const where = diag?.file ? `${diag.file}${diag.line ? `:${diag.line}` : ''}：` : '';
  return diag ? `${where}${diag.message}` : (info.error ?? '任务失败');
}

function resultOf<K extends JobInfo['kind']>(info: JobInfo | null, kind: K) {
  return info?.result?.kind === kind ? (info.result as Extract<NonNullable<JobInfo['result']>, { kind: K }>) : null;
}

interface ViewBase {
  info: JobInfo | null;
  running: boolean;
  stale: boolean;
  onRun: () => void;
}

/* ───────────────────────── Elaborated Design ───────────────────────── */

export function ElaboratedView({ info, running, stale, onRun, module, onModule }: ViewBase & { module?: string; onModule: (m: string) => void }) {
  const result = resultOf(info, 'elaborate') as ElaborateResult | null;
  const modules = useMemo(() => (result ? Object.keys(result.schematics) : []), [result]);
  const cur = result ? (module && result.schematics[module] ? module : result.schematics[result.top] ? result.top : modules[0]) : undefined;
  const svg = useArtifact(info?.id, cur && result ? result.schematics[cur] : null, api.artifactText);
  const fail = failureText(info);

  if (!info && !running) {
    return <EmptyRun icon={<Network size={34} strokeWidth={1.4} />} text="运行 RTL 分析以查看 RTL 原理图" button="运行 RTL 分析" onRun={onRun} />;
  }
  return (
    <div className="st-view">
      {fail && !running && (
        <InfoBar tone="error" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重试</button>}>
          RTL 分析失败：{fail}
        </InfoBar>
      )}
      {stale && !fail && !running && (
        <InfoBar tone="stale" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重新分析</button>}>
          源文件已修改，原理图可能已过期
        </InfoBar>
      )}
      <div className="st-view-main">
        <SchematicViewer
          svg={svg.data}
          loading={running || svg.loading}
          title={cur}
          modules={modules}
          currentModule={cur}
          onSelectModule={onModule}
          error={svg.error}
          emptyText={result && modules.length === 0 ? '没有可显示的原理图' : 'RTL 分析失败，没有原理图'}
        />
      </div>
    </div>
  );
}

/* ───────────────────────── Synthesized Design ───────────────────────── */

export function SynthesizedView({ info, running, stale, onRun }: ViewBase) {
  const result = resultOf(info, 'synthesize') as SynthesizeResult | null;
  const svg = useArtifact(info?.id, result?.schematic ?? null, api.artifactText);
  const fail = failureText(info);
  if (!info && !running) {
    return <EmptyRun icon={<CircuitBoard size={34} strokeWidth={1.4} />} text="运行综合以查看综合后网表" button="运行综合" onRun={onRun} />;
  }
  return (
    <div className="st-view">
      {fail && !running && (
        <InfoBar tone="error" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重试</button>}>
          综合失败：{fail}
        </InfoBar>
      )}
      {stale && !fail && !running && (
        <InfoBar tone="stale" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重新综合</button>}>
          源文件或设置已修改，综合结果可能已过期
        </InfoBar>
      )}
      <div className="st-view-main st-view-split">
        <div className="st-view-schem">
          <SchematicViewer
            svg={svg.data}
            loading={running || svg.loading}
            title={result ? `${result.top}（综合后）` : undefined}
            error={svg.error}
            emptyText={result ? '综合后原理图因设计规模过大已跳过，资源报告见右侧' : '没有综合结果'}
          />
        </div>
        {result && (
          <aside className="st-view-side">
            <div className="st-side-title">
              资源利用率 <span className="muted">· {result.utilization.target}</span>
            </div>
            {result.utilization.rows.length ? <UtilRowsTable rows={result.utilization.rows} /> : <div className="log-empty">没有资源数据</div>}
            <div className="st-side-foot muted">耗时 {formatDuration(result.durationMs)}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Device ───────────────────────── */

export function DeviceTab({ info, running, stale, onRun, pnr }: ViewBase & { pnr: boolean }) {
  const result = resultOf(info, 'implement') as ImplementResult | null;
  const placement = useArtifact(info?.id, result?.placement ?? null, api.placement);
  const highlight = useMemo(() => {
    const path = result?.timing?.criticalPaths?.[0];
    if (!path) return undefined;
    const names = new Set<string>();
    for (const s of path.steps) {
      names.add(s.from.split('.')[0]);
      names.add(s.to.split('.')[0]);
    }
    return [...names];
  }, [result]);
  const fail = failureText(info);
  if (!pnr) {
    return (
      <div className="empty">
        <Grid3x3 size={34} strokeWidth={1.4} />
        <span>当前器件不支持开源布局布线，没有器件视图</span>
      </div>
    );
  }
  if (!info && !running) {
    return <EmptyRun icon={<Grid3x3 size={34} strokeWidth={1.4} />} text="运行实现后显示器件布局" button="运行实现" onRun={onRun} />;
  }
  return (
    <div className="st-view">
      {stale && !fail && !running && (
        <InfoBar tone="stale" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重新实现</button>}>
          源文件或设置已修改，布局结果可能已过期
        </InfoBar>
      )}
      <div className="st-view-main">
        <DeviceView
          placement={placement.data}
          loading={running || placement.loading}
          error={!running ? (fail ? `实现失败：${fail}` : placement.error) : null}
          emptyText={result ? '本次实现没有生成布局数据' : '运行实现后显示器件视图'}
          highlightCells={highlight}
        />
      </div>
    </div>
  );
}

/* ───────────────────────── Simulation ───────────────────────── */

export function SimulationTab({ info, running, stale, onRun, persistKey }: ViewBase & { persistKey: string }) {
  const result = resultOf(info, 'simulate') as SimulateResult | null;
  const vcd = useArtifact(info?.id, result?.vcd ?? null, api.artifactText);
  const fail = failureText(info);
  if (!info && !running) {
    return <EmptyRun icon={<Waves size={34} strokeWidth={1.4} />} text="运行行为仿真后在这里查看波形" button="运行行为仿真" onRun={onRun} />;
  }
  return (
    <div className="st-view">
      {fail && !running && (
        <InfoBar tone="error" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重试</button>}>
          仿真失败：{fail}
        </InfoBar>
      )}
      {result?.timedOut && !running && <InfoBar tone="error">仿真超时被中止：检查测试平台是否调用了 $finish，或在设置中加大超时</InfoBar>}
      {result && !result.vcd && !running && !fail && <InfoBar tone="info">本次仿真没有生成 VCD 波形</InfoBar>}
      {vcd.error && <InfoBar tone="error">波形加载失败：{vcd.error}</InfoBar>}
      {stale && !fail && !running && (
        <InfoBar tone="stale" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重新仿真</button>}>
          源文件已修改，波形可能已过期
        </InfoBar>
      )}
      <div className="st-view-main">
        <WaveformViewer vcd={vcd.data} loading={running || vcd.loading} persistKey={persistKey} />
      </div>
    </div>
  );
}

/* ───────────────────────── Virtual Board ───────────────────────── */

export function BoardTab({ info, running, stale, onRun, board }: ViewBase & { board?: BoardInfo }) {
  const result = resultOf(info, 'gatesim') as GatesimResult | null;
  const netlist = useArtifact(info?.id, result?.netlist ?? null, api.gateNetlist);
  const fail = failureText(info);
  return (
    <div className="st-view">
      {fail && !running && (
        <InfoBar tone="error" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重试</button>}>
          构建失败：{fail}
        </InfoBar>
      )}
      {netlist.error && <InfoBar tone="error">网表加载失败：{netlist.error}</InfoBar>}
      {stale && !fail && !running && netlist.data && (
        <InfoBar tone="stale" action={<button className="btn btn-sm btn-ghost" onClick={onRun}>重新构建</button>}>
          设计已修改，虚拟开发板运行的是旧版本
        </InfoBar>
      )}
      {!board && !netlist.data && !running && (
        <InfoBar tone="info">工程没有选择板卡：将根据顶层端口名自动推断 LED/开关/按键等外设</InfoBar>
      )}
      <div className="st-view-main">
        <VirtualBoard netlist={netlist.data} board={board} onBuild={onRun} building={running || netlist.loading} />
      </div>
    </div>
  );
}

export const VIEW_ICONS = {
  elab: <Network size={14} strokeWidth={1.75} />,
  synth: <CircuitBoard size={14} strokeWidth={1.75} />,
  device: <Grid3x3 size={14} strokeWidth={1.75} />,
  sim: <Waves size={14} strokeWidth={1.75} />,
  board: <Gamepad2 size={14} strokeWidth={1.75} />,
};
