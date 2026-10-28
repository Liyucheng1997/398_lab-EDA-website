// 解析入口：大文件（> 1 MB）放到 Web Worker，小文件或 Worker 不可用时在主线程解析。

import { parseVcd, type VcdData } from './vcd';
import type { WorkerResponse } from './vcd.worker';

export const WORKER_THRESHOLD = 1 << 20;

export interface ParseHandle {
  promise: Promise<VcdData>;
  /** 放弃本次解析（终止 Worker）；promise 将以 AbortError reject */
  abort(): void;
}

let seq = 0;

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

export function parseVcdAsync(text: string, onProgress?: (fraction: number) => void): ParseHandle {
  let aborted = false;
  let worker: Worker | null = null;
  let rejectFn: ((e: Error) => void) | null = null;

  const mainThread = (): Promise<VcdData> =>
    new Promise((resolve, reject) => {
      rejectFn = reject;
      // 让出一帧，以便先渲染"解析中"状态
      setTimeout(() => {
        if (aborted) return;
        try {
          resolve(parseVcd(text, onProgress));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 0);
    });

  const viaWorker = (): Promise<VcdData> =>
    new Promise((resolve, reject) => {
      rejectFn = reject;
      try {
        worker = new Worker(new URL('./vcd.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        worker = null;
        mainThread().then(resolve, reject);
        return;
      }
      const id = ++seq;
      let settled = false;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== id || aborted) return;
        if (msg.type === 'progress') onProgress?.(msg.fraction);
        else if (msg.type === 'done') {
          settled = true;
          worker?.terminate();
          resolve(msg.data);
        } else {
          settled = true;
          worker?.terminate();
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (ev) => {
        ev.preventDefault?.();
        if (settled || aborted) return;
        settled = true;
        worker?.terminate();
        // Worker 加载失败（如环境不支持 module worker）：退回主线程
        mainThread().then(resolve, reject);
      };
      worker.postMessage({ id, text });
    });

  const useWorker = text.length > WORKER_THRESHOLD && typeof Worker !== 'undefined';
  const promise = useWorker ? viaWorker() : mainThread();
  return {
    promise,
    abort() {
      if (aborted) return;
      aborted = true;
      worker?.terminate();
      rejectFn?.(abortError());
    },
  };
}
