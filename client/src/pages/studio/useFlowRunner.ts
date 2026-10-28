import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobInfo, JobRequest, JobStatus } from '@webeda/shared';
import type { RunningJob } from '../../lib/api';
import type { LogLine } from '../../lib/useJob';
import { attachJob, startJob } from './jobStream';
import { stripAnsi, type FlowKind } from './model';

export interface FlowRun {
  status: JobStatus | 'idle';
  stage?: string;
  jobId: string | null;
  logs: LogLine[];
  /** 当前（或最近一次）任务的最终信息 */
  info: JobInfo | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** 当前任务的输入摘要 */
  hash?: string;
  /** 最近一次结束的任务（重新运行期间仍用于展示旧结果） */
  last: JobInfo | null;
  lastHash?: string;
  /** 运行附加信息（如实现是否生成比特流） */
  meta?: Record<string, unknown>;
}

export type Flows = Partial<Record<FlowKind, FlowRun>>;

const EMPTY: FlowRun = {
  status: 'idle',
  jobId: null,
  logs: [],
  info: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  last: null,
};

const MAX_LOG_CHUNKS = 6000;

export interface StartOptions {
  hash?: string;
  meta?: Record<string, unknown>;
  /** 任务已在服务端创建 */
  onCreated?: (jobId: string) => void;
}

export function isActive(run: FlowRun | undefined): boolean {
  return !!run && (run.status === 'queued' || run.status === 'running');
}

/**
 * 多任务运行器：每种 flow 一个槽位，可并行；日志批量刷新，避免频繁渲染。
 */
export function useFlowRunner() {
  const [flows, setFlows] = useState<Flows>({});
  const [lastKind, setLastKind] = useState<FlowKind | null>(null);
  const handles = useRef<Partial<Record<FlowKind, RunningJob>>>({});
  const pending = useRef<Partial<Record<FlowKind, LogLine[]>>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 每种 flow 的运行序号：旧任务的迟到事件不会污染新任务 */
  const seqs = useRef<Partial<Record<FlowKind, number>>>({});

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  const patch = useCallback((kind: FlowKind, fn: (r: FlowRun) => FlowRun) => {
    setFlows((f) => ({ ...f, [kind]: fn(f[kind] ?? EMPTY) }));
  }, []);

  const flushLogs = useCallback(() => {
    flushTimer.current = null;
    const batch = pending.current;
    pending.current = {};
    setFlows((f) => {
      const next = { ...f };
      for (const k of Object.keys(batch) as FlowKind[]) {
        const add = batch[k];
        if (!add?.length) continue;
        const cur = next[k] ?? EMPTY;
        let logs = cur.logs.concat(add);
        if (logs.length > MAX_LOG_CHUNKS) {
          logs = [{ stream: 'info', text: '…（较早的日志已截断）\n', ts: logs[0].ts }, ...logs.slice(logs.length - MAX_LOG_CHUNKS + 1)];
        }
        next[k] = { ...cur, logs };
      }
      return next;
    });
  }, []);

  const pushLog = useCallback(
    (kind: FlowKind, line: LogLine) => {
      (pending.current[kind] ??= []).push({ ...line, text: stripAnsi(line.text) });
      if (!flushTimer.current) flushTimer.current = setTimeout(flushLogs, 60);
    },
    [flushLogs],
  );

  const follow = useCallback(
    async (kind: FlowKind, job: RunningJob): Promise<JobInfo | null> => {
      handles.current[kind] = job;
      try {
        const info = await job.done;
        if (handles.current[kind] === job) delete handles.current[kind];
        flushLogs();
        patch(kind, (r) =>
          r.jobId !== job.id
            ? r
            : {
                ...r,
                status: info.status,
                info,
                error: info.error ?? null,
                finishedAt: Date.now(),
                last: info,
                lastHash: r.hash,
              },
        );
        return info;
      } catch (e) {
        if (handles.current[kind] === job) delete handles.current[kind];
        const msg = (e as Error).message;
        flushLogs();
        patch(kind, (r) =>
          r.jobId !== job.id
            ? r
            : { ...r, status: 'failed', error: msg, finishedAt: Date.now(), logs: [...r.logs, { stream: 'stderr', text: `${msg}\n`, ts: Date.now() }] },
        );
        return null;
      }
    },
    [flushLogs, patch],
  );

  /** 提交并跟踪一个任务；同类任务正在运行时先取消旧的 */
  const start = useCallback(
    async (kind: FlowKind, req: JobRequest, opts: StartOptions = {}): Promise<JobInfo | null> => {
      const prev = handles.current[kind];
      if (prev) {
        delete handles.current[kind];
        await prev.cancel();
      }
      pending.current[kind] = [];
      const seq = (seqs.current[kind] = (seqs.current[kind] ?? 0) + 1);
      const live = () => seqs.current[kind] === seq;
      setLastKind(kind);
      patch(kind, (r) => ({
        ...EMPTY,
        status: 'queued',
        startedAt: Date.now(),
        hash: opts.hash,
        meta: opts.meta,
        last: r.last,
        lastHash: r.lastHash,
      }));
      let job: RunningJob;
      try {
        job = await startJob(req, {
          onLog: (ev) => live() && pushLog(kind, { stream: ev.stream, text: ev.text, ts: ev.ts }),
          onStatus: (status, stage) => live() && patch(kind, (r) => ({ ...r, status, stage: stage ?? r.stage })),
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (!live()) return null;
        patch(kind, (r) => ({
          ...r,
          status: 'failed',
          error: msg,
          finishedAt: Date.now(),
          logs: [...r.logs, { stream: 'stderr', text: `${msg}\n`, ts: Date.now() }],
        }));
        return null;
      }
      if (!live()) {
        await job.cancel();
        return null;
      }
      patch(kind, (r) => ({ ...r, jobId: job.id }));
      opts.onCreated?.(job.id);
      return follow(kind, job);
    },
    [follow, patch, pushLog],
  );

  /** 重新连接到服务端仍在运行的任务（刷新页面后） */
  const attach = useCallback(
    (kind: FlowKind, jobId: string, startedAt: number, opts: StartOptions = {}): Promise<JobInfo | null> => {
      pending.current[kind] = [];
      const seq = (seqs.current[kind] = (seqs.current[kind] ?? 0) + 1);
      const live = () => seqs.current[kind] === seq;
      patch(kind, (r) => ({ ...EMPTY, status: 'running', jobId, startedAt, hash: opts.hash, meta: opts.meta, last: r.last, lastHash: r.lastHash }));
      setLastKind((k) => k ?? kind);
      const job = attachJob(jobId, {
        onLog: (ev) => live() && pushLog(kind, { stream: ev.stream, text: ev.text, ts: ev.ts }),
        onStatus: (status, stage) => live() && patch(kind, (r) => ({ ...r, status, stage: stage ?? r.stage })),
      });
      return follow(kind, job);
    },
    [follow, patch, pushLog],
  );

  /** 恢复已结束任务的结果（无日志） */
  const restore = useCallback(
    (kind: FlowKind, info: JobInfo, hash?: string, meta?: Record<string, unknown>) => {
      patch(kind, (r) =>
        r.status !== 'idle'
          ? r
          : {
              ...EMPTY,
              status: info.status,
              jobId: info.id,
              info,
              error: info.error ?? null,
              startedAt: info.startedAt ? Date.parse(info.startedAt) : null,
              finishedAt: info.finishedAt ? Date.parse(info.finishedAt) : null,
              hash,
              last: info,
              lastHash: hash,
              meta,
            },
      );
    },
    [patch],
  );

  const cancel = useCallback(async (kind?: FlowKind) => {
    const kinds = kind ? [kind] : (Object.keys(handles.current) as FlowKind[]);
    await Promise.all(kinds.map((k) => handles.current[k]?.cancel()));
  }, []);

  return { flows, lastKind, setLastKind, start, attach, restore, cancel };
}

export type FlowRunner = ReturnType<typeof useFlowRunner>;
