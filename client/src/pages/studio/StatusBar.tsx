import { Cpu, Crown } from 'lucide-react';
import type { DeviceInfo } from '@webeda/shared';
import { StatusDot } from '../../ui/StatusDot';
import { FLOW_LABEL } from './BottomPanel';
import type { FlowKind } from './model';
import { formatDuration } from './reports';
import type { FlowRun } from './useFlowRunner';

/** 底部状态栏：当前任务状态/阶段/耗时、器件、顶层 */
export function StatusBar({
  kind,
  run,
  activeCount,
  now,
  device,
  top,
  cursor,
}: {
  kind: FlowKind | null;
  run: FlowRun | null;
  activeCount: number;
  now: number;
  device?: DeviceInfo;
  top?: string;
  cursor?: string;
}) {
  const active = run && (run.status === 'running' || run.status === 'queued');
  const elapsed = run?.startedAt ? (active ? now - run.startedAt : (run.finishedAt ?? now) - run.startedAt) : null;
  return (
    <footer className="statusbar st-statusbar">
      {kind && run && run.status !== 'idle' ? (
        <span className="st-sb-item">
          <StatusDot status={run.status} label={`${FLOW_LABEL[kind]} · ${active ? (run.stage ?? (run.status === 'queued' ? '排队中' : '运行中')) : statusText(run.status)}`} />
          {elapsed != null && <span className="tabular">{formatDuration(elapsed)}</span>}
          {activeCount > 1 && <span className="muted">（另有 {activeCount - 1} 个任务运行中）</span>}
        </span>
      ) : (
        <span className="st-sb-item">
          <StatusDot status="idle" />
        </span>
      )}
      <span className="st-flex1" />
      {cursor && <span className="st-sb-item st-hide-sm">{cursor}</span>}
      <span className="st-sb-item st-hide-sm" title="顶层模块">
        <Crown size={12} strokeWidth={1.75} />
        <span className="st-mono">{top ?? '自动'}</span>
      </span>
      {device && (
        <span className="st-sb-item" title={device.name}>
          <Cpu size={12} strokeWidth={1.75} />
          <span className="st-mono">{device.partNumber}</span>
        </span>
      )}
    </footer>
  );
}

function statusText(s: FlowRun['status']): string {
  switch (s) {
    case 'succeeded':
      return '完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return '就绪';
  }
}
