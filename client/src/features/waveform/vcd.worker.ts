// VCD 解析 Worker：主线程 postMessage({ id, text }) → 回传 progress / done / error。

import { parseVcd, transferables } from './vcd';

export type WorkerRequest = { id: number; text: string };
export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'done'; data: import('./vcd').VcdData }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, text } = e.data;
  try {
    let last = 0;
    const data = parseVcd(text, (fraction) => {
      if (fraction - last >= 0.01 || fraction >= 1) {
        last = fraction;
        ctx.postMessage({ id, type: 'progress', fraction });
      }
    });
    ctx.postMessage({ id, type: 'done', data }, transferables(data));
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
