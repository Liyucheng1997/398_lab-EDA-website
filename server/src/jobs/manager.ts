import fs from 'node:fs/promises';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import type { Artifact, JobEvent, JobInfo, JobRequest, JobResult, JobStatus } from '@webeda/shared';
import { config } from '../config';
import { runTool } from '../tools/exec';
import { FLOWS } from '../flows';
import { FlowError, type JobContext } from './context';
import { normalizeFiles, safeJoin, writeFiles } from './files';

const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const KINDS = new Set<JobRequest['kind']>(['simulate', 'elaborate', 'synthesize', 'implement', 'gatesim', 'yosys']);

type Listener = (ev: JobEvent) => void;

interface JobRecord {
  info: JobInfo;
  req: JobRequest;
  workDir: string;
  logs: Extract<JobEvent, { type: 'log' }>[];
  logBytes: number;
  logTruncated: boolean;
  listeners: Set<Listener>;
  abort: AbortController;
  artifacts: Artifact[];
  stage?: string;
}

class JobManager {
  private jobs = new Map<string, JobRecord>();
  private queue: JobRecord[] = [];
  private running = 0;

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  /** 校验请求并入队，返回任务 id */
  async create(body: unknown): Promise<string> {
    const req = body as JobRequest;
    if (!req || typeof req !== 'object' || !KINDS.has(req.kind)) throw new Error('未知任务类型');
    const files = normalizeFiles(req.files);
    const normalized = { ...req, files, options: (req as { options?: object }).options ?? {} } as JobRequest;
    const id = newId();
    const workDir = path.join(config.workDir, id);
    await fs.mkdir(workDir, { recursive: true });
    await writeFiles(workDir, files);
    const rec: JobRecord = {
      info: { id, kind: req.kind, status: 'queued', createdAt: new Date().toISOString() },
      req: normalized,
      workDir,
      logs: [],
      logBytes: 0,
      logTruncated: false,
      listeners: new Set(),
      abort: new AbortController(),
      artifacts: [],
    };
    this.jobs.set(id, rec);
    this.queue.push(rec);
    this.pump();
    return id;
  }

  get(id: string): JobInfo | undefined {
    return this.jobs.get(id)?.info;
  }

  /** 订阅事件：先补发历史日志与当前状态；若已结束则直接发 end */
  subscribe(id: string, fn: Listener): (() => void) | null {
    const rec = this.jobs.get(id);
    if (!rec) return null;
    for (const l of rec.logs) fn(l);
    fn({ type: 'status', status: rec.info.status, stage: rec.stage });
    if (isFinal(rec.info.status)) {
      fn({ type: 'end', job: rec.info });
      return () => {};
    }
    rec.listeners.add(fn);
    return () => rec.listeners.delete(fn);
  }

  cancel(id: string): boolean {
    const rec = this.jobs.get(id);
    if (!rec || isFinal(rec.info.status)) return false;
    if (rec.info.status === 'queued') {
      this.queue = this.queue.filter((r) => r !== rec);
      this.finish(rec, 'cancelled', undefined, '已取消');
    } else {
      rec.abort.abort();
    }
    return true;
  }

  artifactPath(id: string, name: string): { path: string; artifact: Artifact } | null {
    const rec = this.jobs.get(id);
    if (!rec) return null;
    const artifact = rec.artifacts.find((a) => a.name === name);
    if (!artifact) return null;
    const p = safeJoin(rec.workDir, name);
    return p ? { path: p, artifact } : null;
  }

  private emit(rec: JobRecord, ev: JobEvent) {
    for (const fn of rec.listeners) {
      try {
        fn(ev);
      } catch {
        /* listener errors are not our problem */
      }
    }
  }

  private log(rec: JobRecord, stream: 'stdout' | 'stderr' | 'info', text: string) {
    if (!text) return;
    if (rec.logBytes > config.limits.maxLogBytes) {
      if (!rec.logTruncated) {
        rec.logTruncated = true;
        const ev = { type: 'log' as const, stream: 'info' as const, text: '\n[WebEDA] 日志过长，后续输出已截断\n', ts: Date.now() };
        rec.logs.push(ev);
        this.emit(rec, ev);
      }
      return;
    }
    rec.logBytes += text.length;
    const ev = { type: 'log' as const, stream, text, ts: Date.now() };
    rec.logs.push(ev);
    this.emit(rec, ev);
  }

  private pump() {
    while (this.running < config.concurrency && this.queue.length) {
      const rec = this.queue.shift()!;
      this.running++;
      this.execute(rec).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async execute(rec: JobRecord) {
    rec.info.status = 'running';
    rec.info.startedAt = new Date().toISOString();
    this.emit(rec, { type: 'status', status: 'running' });
    const started = Date.now();
    const ctx: JobContext = {
      id: rec.info.id,
      workDir: rec.workDir,
      files: rec.req.files,
      signal: rec.abort.signal,
      artifacts: rec.artifacts,
      log: (stream, text) => this.log(rec, stream, text),
      stage: (name) => {
        rec.stage = name;
        this.emit(rec, { type: 'status', status: rec.info.status, stage: name });
      },
      run: (tool, args, opts) => {
        if (!opts?.quiet) this.log(rec, 'info', `▶ ${tool} ${args.join(' ')}\n`);
        return runTool(tool, args, {
          cwd: rec.workDir,
          timeoutMs: (opts?.timeoutSec ?? config.limits.toolTimeoutSec) * 1000,
          signal: rec.abort.signal,
          stdin: opts?.stdin,
          onOutput: opts?.quiet ? undefined : (stream, text) => this.log(rec, stream, text),
        });
      },
      addArtifact: async (name, kind, label) => {
        const p = safeJoin(rec.workDir, name);
        if (!p) throw new Error(`非法产物名 ${name}`);
        const st = await fs.stat(p);
        if (st.size > config.limits.maxArtifactBytes) {
          throw new FlowError(`产物 ${name} 过大（${(st.size / 1048576).toFixed(1)} MB），请减少 $dumpvars 范围或缩短仿真时间`);
        }
        const art: Artifact = { name, size: st.size, kind, label };
        rec.artifacts.splice(0, rec.artifacts.length, ...rec.artifacts.filter((a) => a.name !== name), art);
        return art;
      },
      writeArtifact: async (name, content, kind, label) => {
        const p = safeJoin(rec.workDir, name);
        if (!p) throw new Error(`非法产物名 ${name}`);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, content);
        return ctx.addArtifact(name, kind, label);
      },
    };

    try {
      const flow = FLOWS[rec.req.kind] as (c: JobContext, r: JobRequest) => Promise<JobResult>;
      const result = await flow(ctx, rec.req);
      result.durationMs = Date.now() - started;
      result.artifacts = rec.artifacts;
      const failed = result.diagnostics.some((d) => d.severity === 'error');
      if (rec.abort.signal.aborted) this.finish(rec, 'cancelled', result, '已取消');
      else this.finish(rec, failed ? 'failed' : 'succeeded', result, failed ? firstError(result) : undefined);
    } catch (err) {
      const e = err as Error;
      if (rec.abort.signal.aborted) {
        this.finish(rec, 'cancelled', undefined, '已取消');
        return;
      }
      this.log(rec, 'stderr', `\n[WebEDA] ${e.message}\n`);
      if (!(e instanceof FlowError)) console.error(`[job ${rec.info.id}]`, e);
      const diagnostics = e instanceof FlowError ? e.diagnostics : [];
      if (!diagnostics.some((d) => d.severity === 'error')) {
        diagnostics.push({ severity: 'error', message: e.message, tool: 'webeda' });
      }
      const partial = { kind: rec.req.kind, diagnostics, artifacts: rec.artifacts, durationMs: Date.now() - started } as unknown as JobResult;
      this.finish(rec, 'failed', partial, e.message);
    }
  }

  private finish(rec: JobRecord, status: JobStatus, result: JobResult | undefined, error?: string) {
    rec.info.status = status;
    rec.info.finishedAt = new Date().toISOString();
    if (result) rec.info.result = result;
    if (error) rec.info.error = error;
    this.emit(rec, { type: 'status', status });
    this.emit(rec, { type: 'end', job: rec.info });
    rec.listeners.clear();
  }

  private async cleanup() {
    const now = Date.now();
    for (const [id, rec] of this.jobs) {
      const done = rec.info.finishedAt ? Date.parse(rec.info.finishedAt) : NaN;
      if (isFinal(rec.info.status) && now - done > config.jobTtlMs) {
        this.jobs.delete(id);
        await fs.rm(rec.workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

function isFinal(s: JobStatus) {
  return s === 'succeeded' || s === 'failed' || s === 'cancelled';
}

function firstError(r: JobResult) {
  return r.diagnostics.find((d) => d.severity === 'error')?.message;
}

export const jobs = new JobManager();
