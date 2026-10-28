import type { JobEvent, JobInfo } from '@webeda/shared';
import { api, startJob, type JobHandlers, type RunningJob } from '../../lib/api';
import type { JobRequest } from '@webeda/shared';
import { apiUrl } from '../../lib/config';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * 重新订阅一个已存在的任务（页面刷新后继续跟踪正在运行的任务）。
 * 服务端连接建立时会补发已有日志。
 */
export function attachJob(id: string, handlers: JobHandlers = {}): RunningJob {
  const done = new Promise<JobInfo>((resolve, reject) => {
    const es = new EventSource(apiUrl(`/api/jobs/${id}/events`));
    let finished = false;
    es.addEventListener('log', (e) => handlers.onLog?.(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('status', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as Extract<JobEvent, { type: 'status' }>;
      handlers.onStatus?.(ev.status, ev.stage);
    });
    es.addEventListener('end', (e) => {
      finished = true;
      es.close();
      resolve((JSON.parse((e as MessageEvent).data) as Extract<JobEvent, { type: 'end' }>).job);
    });
    es.onerror = () => {
      if (finished) return;
      es.close();
      const poll = async () => {
        try {
          const info = await api.getJob(id);
          if (TERMINAL.has(info.status)) resolve(info);
          else setTimeout(poll, 1000);
        } catch (err) {
          reject(err);
        }
      };
      void poll();
    };
  });
  return {
    id,
    done,
    cancel: async () => {
      await api.cancelJob(id).catch(() => {});
    },
  };
}

export { startJob };
export type { JobRequest };

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}
