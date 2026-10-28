/** 虚拟开发板仿真 Worker：消息协议见 protocol.ts */
import { SimHost } from './host';
import type { FromWorker, ToWorker } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const host = new SimHost((msg: FromWorker) => {
  if (msg.type === 'snapshot') {
    const s = msg.snap;
    const transfer: Transferable[] = [s.values.buffer, s.duty.buffer];
    if (s.segJoint) transfer.push(s.segJoint.buffer);
    ctx.postMessage(msg, transfer);
  } else {
    ctx.postMessage(msg);
  }
});

ctx.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data);
