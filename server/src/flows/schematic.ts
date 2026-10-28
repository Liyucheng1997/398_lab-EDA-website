/**
 * netlistsvg 原理图渲染：在 worker_thread 中运行，单张图超时即终止 worker（之后按需重建）。
 */
import { Worker } from 'node:worker_threads';
import type { Diagnostic } from '@webeda/shared';
import type { JobContext } from '../jobs/context';
import type { YosysDesign } from './yosysJson';

export const SCHEMATIC_TIMEOUT_MS = 60_000;

const WORKER_URL = new URL('./netlistsvg-worker.mjs', import.meta.url);

export class RenderTimeoutError extends Error {}

export class SchematicRenderer {
  private worker: Worker | null = null;
  private seq = 0;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: 1536 } });
      this.worker.unref();
    }
    return this.worker;
  }

  /** 渲染一张原理图；超时、取消或 worker 崩溃时拒绝 */
  render(netlist: YosysDesign, timeoutMs = SCHEMATIC_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
    const worker = this.ensure();
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        done = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        signal?.removeEventListener('abort', onAbort);
      };
      const kill = () => {
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
      };
      const onMessage = (msg: { id: number; svg?: string; error?: string }) => {
        if (msg.id !== id || done) return;
        cleanup();
        if (msg.svg !== undefined) resolve(msg.svg);
        else reject(new Error(msg.error ?? 'netlistsvg 渲染失败'));
      };
      const onError = (err: Error) => {
        if (done) return;
        cleanup();
        kill();
        reject(new Error(`netlistsvg 渲染进程出错：${err.message}`));
      };
      const onExit = (code: number) => {
        if (done) return;
        cleanup();
        if (this.worker === worker) this.worker = null;
        reject(new Error(`netlistsvg 渲染进程意外退出（${code}）`));
      };
      const onAbort = () => {
        if (done) return;
        cleanup();
        kill();
        reject(new Error('已取消'));
      };
      const timer = setTimeout(() => {
        if (done) return;
        cleanup();
        kill();
        reject(new RenderTimeoutError(`原理图布局超过 ${Math.round(timeoutMs / 1000)} 秒，已放弃`));
      }, timeoutMs);
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort);
      worker.postMessage({ id, netlist });
    });
  }

  async close() {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}

export interface SchematicJob {
  /** 用于诊断消息的名字 */
  label: string;
  netlist: YosysDesign;
  artifact: string;
  artifactLabel: string;
}

/** 依次渲染并登记为 svg 产物；失败的图只产生 warning 诊断，不让整个任务失败 */
export async function renderSchematics(ctx: JobContext, jobs: SchematicJob[], diagnostics: Diagnostic[]): Promise<Map<SchematicJob, string>> {
  const done = new Map<SchematicJob, string>();
  if (!jobs.length) return done;
  const renderer = new SchematicRenderer();
  try {
    for (const job of jobs) {
      if (ctx.signal.aborted) break;
      const t0 = Date.now();
      ctx.log('info', `▶ netlistsvg 绘制 ${job.label} 原理图…\n`);
      try {
        const svg = await renderer.render(job.netlist, SCHEMATIC_TIMEOUT_MS, ctx.signal);
        await ctx.writeArtifact(job.artifact, svg, 'svg', job.artifactLabel);
        done.set(job, job.artifact);
        ctx.log('info', `  ${job.label}：完成（${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
      } catch (e) {
        if (ctx.signal.aborted) break;
        const msg = (e as Error).message;
        ctx.log('stderr', `  ${job.label}：${msg}\n`);
        diagnostics.push({ severity: 'warning', tool: 'webeda', message: `${job.label} 原理图生成失败：${msg}` });
      }
    }
  } finally {
    await renderer.close();
  }
  return done;
}
