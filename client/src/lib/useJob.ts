import { useCallback, useRef, useState } from 'react';
import type { JobInfo, JobRequest, JobStatus } from '@webeda/shared';
import { startJob, type RunningJob } from './api';

export interface LogLine {
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
  ts: number;
}

export interface JobState {
  jobId: string | null;
  status: JobStatus | 'idle';
  stage?: string;
  logs: LogLine[];
  info: JobInfo | null;
  error: string | null;
}

const initial: JobState = { jobId: null, status: 'idle', logs: [], info: null, error: null };

/**
 * React 钩子：运行一个任务并收集日志/状态。
 * run() resolve 为最终 JobInfo（网络错误时为 null）。
 */
export function useJob() {
  const [state, setState] = useState<JobState>(initial);
  const current = useRef<RunningJob | null>(null);

  const run = useCallback(async (req: JobRequest, opts: { keepLogs?: boolean } = {}): Promise<JobInfo | null> => {
    if (current.current) await current.current.cancel();
    setState((s) => ({ ...initial, logs: opts.keepLogs ? s.logs : [], status: 'queued' }));
    try {
      const job = await startJob(req, {
        onLog: (ev) => setState((s) => ({ ...s, logs: [...s.logs, { stream: ev.stream, text: ev.text, ts: ev.ts }] })),
        onStatus: (status, stage) => setState((s) => ({ ...s, status, stage: stage ?? s.stage })),
      });
      current.current = job;
      setState((s) => ({ ...s, jobId: job.id }));
      const info = await job.done;
      if (current.current === job) current.current = null;
      setState((s) => ({ ...s, status: info.status, info, error: info.error ?? null }));
      return info;
    } catch (e) {
      const msg = (e as Error).message;
      setState((s) => ({ ...s, status: 'failed', error: msg, logs: [...s.logs, { stream: 'stderr', text: `${msg}\n`, ts: Date.now() }] }));
      return null;
    }
  }, []);

  const cancel = useCallback(async () => {
    await current.current?.cancel();
  }, []);

  const clear = useCallback(() => setState(initial), []);

  const running = state.status === 'queued' || state.status === 'running';
  return { ...state, running, run, cancel, clear };
}
