import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { RunRecord, SourceFile, TimingReport, UtilizationReport } from '@webeda/shared';
import { LogConsole } from '../../features/editor/LogConsole';
import type { LogLine } from '../../lib/useJob';
import { StatusDot } from '../../ui/StatusDot';
import { MessagesView, RunsTable, TimingReportView, UtilizationReportView, type MessageGroup } from './ReportViews';
import { TclConsole } from './TclConsole';
import type { FlowKind } from './model';
import { countDiagnostics } from './reports';
import type { Flows } from './useFlowRunner';

export type BottomTab = 'console' | 'messages' | 'log' | 'reports' | 'runs';
export type ReportView = 'util-synth' | 'util-impl' | 'timing';

export const FLOW_LABEL: Record<FlowKind, string> = {
  simulate: '仿真',
  elaborate: 'RTL 分析',
  synthesize: '综合',
  implement: '实现',
  gatesim: '虚拟板构建',
};

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'console', label: 'Tcl Console' },
  { id: 'messages', label: 'Messages' },
  { id: 'log', label: 'Log' },
  { id: 'reports', label: 'Reports' },
  { id: 'runs', label: 'Design Runs' },
];

export interface BottomPanelProps {
  tab: BottomTab;
  onTab: (t: BottomTab) => void;
  reportView: ReportView;
  onReportView: (v: ReportView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  projectId: string;
  files: SourceFile[];
  top?: string;
  messageGroups: MessageGroup[];
  onJump: (file: string, line: number) => void;
  flows: Flows;
  lastKind: FlowKind | null;
  synthUtil: UtilizationReport | null;
  implUtil: UtilizationReport | null;
  timing: TimingReport | null;
  runs: RunRecord[];
  now: number;
}

const EMPTY_LOGS: LogLine[] = [];

/** 底部面板：Tcl Console / Messages / Log / Reports / Design Runs */
export function BottomPanel(p: BottomPanelProps) {
  const [logKind, setLogKind] = useState<FlowKind | null>(p.lastKind);
  useEffect(() => {
    if (p.lastKind) setLogKind(p.lastKind);
  }, [p.lastKind]);

  const counts = countDiagnostics(p.messageGroups.flatMap((g) => g.diagnostics));
  const logKinds = (Object.keys(FLOW_LABEL) as FlowKind[]).filter((k) => p.flows[k] && p.flows[k]!.status !== 'idle');
  const curLog = logKind && p.flows[logKind] ? p.flows[logKind]! : null;
  const fileNames = p.files.map((f) => f.name);

  const header = (
    <div className="tabs st-bottom-tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${p.tab === t.id && !p.collapsed ? ' active' : ''}`}
          onClick={() => {
            p.onTab(t.id);
            if (p.collapsed) p.onToggleCollapsed();
          }}
        >
          {t.label}
          {t.id === 'messages' && counts.errors > 0 && <span className="badge badge-danger">{counts.errors}</span>}
          {t.id === 'messages' && counts.warnings > 0 && <span className="badge badge-warning">{counts.warnings}</span>}
        </button>
      ))}
      <span className="spacer st-flex1" />
      <button className="icon-btn st-icon-sm st-collapse-btn" onClick={p.onToggleCollapsed} title={p.collapsed ? '展开面板' : '收起面板'}>
        {p.collapsed ? <ChevronUp size={15} strokeWidth={1.75} /> : <ChevronDown size={15} strokeWidth={1.75} />}
      </button>
    </div>
  );

  return (
    <div className={`panel st-bottom${p.collapsed ? ' st-bottom-collapsed' : ''}`}>
      {header}
      <div className={`panel-body st-bottom-body${p.collapsed ? ' st-hidden' : ''}`}>
        {/* Tcl Console 始终挂载，保留滚动缓冲与正在运行的命令 */}
        <div className={`st-fill${p.tab === 'console' ? '' : ' st-hidden'}`}>
          <TclConsole projectId={p.projectId} files={p.files} top={p.top} />
        </div>
        {p.tab === 'messages' && <MessagesView groups={p.messageGroups} onJump={p.onJump} />}
        {p.tab === 'log' && (
          <div className="st-fill st-col">
            {logKinds.length > 0 && (
              <div className="st-log-bar">
                <div className="seg st-seg-sm">
                  {logKinds.map((k) => (
                    <button key={k} className={logKind === k ? 'active' : ''} onClick={() => setLogKind(k)}>
                      {FLOW_LABEL[k]}
                    </button>
                  ))}
                </div>
                {curLog && <StatusDot status={curLog.status} label={curLog.stage && (curLog.status === 'running' || curLog.status === 'queued') ? curLog.stage : undefined} />}
              </div>
            )}
            <div className="st-flex1 st-minh0">
              <LogConsole
                logs={curLog?.logs ?? EMPTY_LOGS}
                files={fileNames}
                onJump={p.onJump}
                emptyText={curLog && curLog.status !== 'idle' && !curLog.logs.length ? (curLog.info ? '该任务的日志已不在内存中（页面刷新前运行）' : '等待输出…') : '运行仿真、综合或实现后在这里查看日志'}
              />
            </div>
          </div>
        )}
        {p.tab === 'reports' && (
          <div className="st-fill st-col">
            <div className="st-log-bar">
              <div className="seg st-seg-sm">
                <button className={p.reportView === 'util-synth' ? 'active' : ''} onClick={() => p.onReportView('util-synth')}>
                  利用率 · 综合后
                </button>
                <button className={p.reportView === 'util-impl' ? 'active' : ''} onClick={() => p.onReportView('util-impl')}>
                  利用率 · 实现后
                </button>
                <button className={p.reportView === 'timing' ? 'active' : ''} onClick={() => p.onReportView('timing')}>
                  时序
                </button>
              </div>
            </div>
            <div className="st-flex1 st-minh0 st-scroll">
              {p.reportView === 'util-synth' && <UtilizationReportView report={p.synthUtil} />}
              {p.reportView === 'util-impl' && <UtilizationReportView report={p.implUtil} />}
              {p.reportView === 'timing' && <TimingReportView timing={p.timing} onJump={p.onJump} />}
            </div>
          </div>
        )}
        {p.tab === 'runs' && <RunsTable runs={p.runs} now={p.now} />}
      </div>
    </div>
  );
}
