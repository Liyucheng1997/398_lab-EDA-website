import type { JobStatus } from '@webeda/shared';

const LABEL: Record<JobStatus | 'idle', string> = {
  idle: '就绪',
  queued: '排队中',
  running: '运行中',
  succeeded: '完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 7px 小圆点 + 文字的状态标记 */
export function StatusDot({ status, label }: { status: JobStatus | 'idle'; label?: string }) {
  return (
    <span className={`status-dot status-${status}`}>
      <i />
      {label ?? LABEL[status]}
    </span>
  );
}
