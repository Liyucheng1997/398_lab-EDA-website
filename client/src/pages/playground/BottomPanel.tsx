import { useEffect, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, Clock, ListX, MessageSquareWarning, Network, ScrollText, Trash2 } from 'lucide-react';
import type { Diagnostic } from '@webeda/shared';
import { DiagnosticList, LogConsole } from '../../features/editor/LogConsole';
import { SchematicViewer } from '../../features/schematic';
import { WaveformViewer } from '../../features/waveform';
import type { LogLine } from '../../lib/useJob';
import { formatDuration } from './model';

export type BottomTab = 'log' | 'messages' | 'wave' | 'schematic';

export interface RunSummary {
  exitCode: number | null;
  durationMs: number | null;
  timedOut: boolean;
  timeoutSec: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
}

export interface SchematicState {
  modules: string[];
  current: string | null;
  svg: string | null;
  loading: boolean;
  error: string | null;
}

interface Props {
  tab: BottomTab;
  onTab: (t: BottomTab) => void;
  logs: LogLine[];
  fileNames: string[];
  onJump: (file: string, line: number) => void;
  onClearLog: () => void;
  canClearLog: boolean;
  diagnostics: Diagnostic[];
  vcd: string | null;
  vcdLoading: boolean;
  vcdError: string | null;
  persistKey: string;
  schematic: SchematicState;
  onSelectModule: (m: string) => void;
  onElaborate: () => void;
  run: RunSummary | null;
}

/** 底部面板：日志 / 消息 / 波形 / 原理图 */
export function BottomPanel(p: Props) {
  const errors = p.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = p.diagnostics.filter((d) => d.severity === 'warning').length;
  const infos = p.diagnostics.length - errors - warnings;

  // 波形 / 原理图首次打开后保持挂载，切换页签不丢视图状态
  const [mounted, setMounted] = useState<Record<BottomTab, boolean>>({ log: true, messages: true, wave: false, schematic: false });
  useEffect(() => {
    if (!mounted[p.tab]) setMounted((m) => ({ ...m, [p.tab]: true }));
  }, [p.tab, mounted]);

  const tabs: { id: BottomTab; label: string; icon: ReactNode; extra?: ReactNode }[] = [
    { id: 'log', label: '日志', icon: <ScrollText size={14} strokeWidth={1.75} /> },
    {
      id: 'messages',
      label: '消息',
      icon: <MessageSquareWarning size={14} strokeWidth={1.75} />,
      extra: (
        <>
          {errors > 0 && <span className="badge badge-danger" title={`${errors} 个错误`}>{errors}</span>}
          {warnings > 0 && <span className="badge badge-warning" title={`${warnings} 个警告`}>{warnings}</span>}
          {errors === 0 && warnings === 0 && infos > 0 && <span className="badge">{infos}</span>}
        </>
      ),
    },
    { id: 'wave', label: '波形', icon: <Activity size={14} strokeWidth={1.75} />, extra: p.vcd ? <i className="pg-tab-ready" aria-label="有新波形" /> : null },
    { id: 'schematic', label: '原理图', icon: <Network size={14} strokeWidth={1.75} />, extra: p.schematic.modules.length ? <i className="pg-tab-ready" aria-label="有原理图" /> : null },
  ];

  const r = p.run;

  return (
    <div className="panel pg-bottom">
      <div className="pg-bottom-head">
        <div className="tabs pg-bottom-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={p.tab === t.id} className={`tab${p.tab === t.id ? ' active' : ''}`} onClick={() => p.onTab(t.id)}>
              {t.icon}
              {t.label}
              {t.extra}
            </button>
          ))}
        </div>
        <div className="pg-run-summary">
          {r && (
            <>
              {r.timedOut && (
                <span className="pg-pill warn" title="仿真超过时限被中止，可在左侧调整超时">
                  <Clock size={12} strokeWidth={2} />
                  超时（{r.timeoutSec}s）已中止
                </span>
              )}
              {r.status === 'cancelled' && <span className="pg-pill warn">已停止</span>}
              {r.error && !r.timedOut && r.status === 'failed' && (
                <span className="pg-pill danger" title={r.error}>
                  <AlertTriangle size={12} strokeWidth={2} />
                  <span className="pg-pill-text">{r.error}</span>
                </span>
              )}
              {r.exitCode !== null && (
                <span className={`pg-kv${r.exitCode !== 0 ? ' danger' : ''}`}>
                  退出码 <b className="tabular">{r.exitCode}</b>
                </span>
              )}
              {r.durationMs !== null && (
                <span className="pg-kv">
                  耗时 <b className="tabular">{formatDuration(r.durationMs)}</b>
                </span>
              )}
            </>
          )}
          {p.tab === 'log' && (
            <button className="icon-btn" title="清空日志" aria-label="清空日志" onClick={p.onClearLog} disabled={!p.canClearLog}>
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      <div className="pg-bottom-body">
        {p.tab === 'log' && (
          <LogConsole logs={p.logs} files={p.fileNames} onJump={p.onJump} emptyText="按 Ctrl+Enter 运行仿真，输出会显示在这里" />
        )}
        {p.tab === 'messages' &&
          (p.diagnostics.length ? (
            <div className="pg-scroll">
              <DiagnosticList diagnostics={p.diagnostics} onJump={p.onJump} />
            </div>
          ) : (
            <div className="empty">
              <ListX size={34} strokeWidth={1.4} />
              <span>没有错误或警告</span>
            </div>
          ))}
        {mounted.wave && (
          <div className="pg-keep" style={{ display: p.tab === 'wave' ? 'flex' : 'none' }}>
            {p.vcdError && !p.vcdLoading ? (
              <div className="empty">
                <Activity size={34} strokeWidth={1.4} />
                <span>{p.vcdError}</span>
              </div>
            ) : (
              <WaveformViewer vcd={p.vcd} loading={p.vcdLoading} persistKey={p.persistKey} className="pg-viewer" />
            )}
          </div>
        )}
        {mounted.schematic && (
          <div className="pg-keep" style={{ display: p.tab === 'schematic' ? 'flex' : 'none' }}>
            {p.schematic.modules.length > 0 || p.schematic.loading ? (
              <SchematicViewer
                svg={p.schematic.svg}
                loading={p.schematic.loading}
                title={p.schematic.current ?? undefined}
                modules={p.schematic.modules}
                currentModule={p.schematic.current ?? undefined}
                onSelectModule={p.onSelectModule}
                className="pg-viewer"
              />
            ) : (
              <div className="empty">
                <Network size={34} strokeWidth={1.4} />
                <span>{p.schematic.error ?? '用 Yosys 生成设计文件的 RTL 原理图'}</span>
                <button className="btn btn-sm" onClick={p.onElaborate}>
                  生成原理图
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
