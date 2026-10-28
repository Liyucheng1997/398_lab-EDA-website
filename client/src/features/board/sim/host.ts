/**
 * SimHost：处理协议消息、按目标速度调度 SimRunner、定期发送快照。
 * Worker（sim.worker.ts）与主线程回退（useBoardSim）共用这一实现。
 */
import { NetlistError } from './kernel';
import type { FromWorker, LoadInfo, SimMode, SimSpeed, Snapshot, ToWorker } from './protocol';
import { SimRunner } from './runner';

export interface HostTimers {
  now(): number;
  /** 延迟执行 */
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  /** 尽快执行（让出事件循环以便处理消息） */
  soon(fn: () => void): void;
}

export interface HostOptions {
  /** 每个调度片的计算预算（ms） */
  budgetMs?: number;
  /** 快照最小间隔（ms） */
  snapshotMs?: number;
  /** 同步执行的单步上限（超过则分片执行） */
  syncStepLimit?: number;
}

export function defaultTimers(): HostTimers {
  let soon: (fn: () => void) => void;
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    const queue: (() => void)[] = [];
    ch.port1.onmessage = () => {
      const fn = queue.shift();
      fn?.();
    };
    soon = (fn) => {
      queue.push(fn);
      ch.port2.postMessage(0);
    };
  } else {
    soon = (fn) => void setTimeout(fn, 0);
  }
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    soon,
  };
}

const MAX_HZ = 1e9;

export class SimHost {
  private runner: SimRunner | null = null;
  private mode: SimMode = 'paused';
  private speed: SimSpeed = 'max';
  private stepRemaining = 0;
  private credit = 0;
  private lastTick = 0;
  private batch = 64;
  private scheduled = false;
  private timer: unknown = null;
  private seq = 0;
  private gen = 0;
  private lastSnapAt = 0;
  private lastSnapCycles = 0;
  private lastSnapEvals = 0;
  private achievedHz = 0;
  private evalRate = 0;
  private readonly budgetMs: number;
  private readonly snapshotMs: number;
  private readonly syncStepLimit: number;
  private disposed = false;

  constructor(
    private readonly post: (msg: FromWorker) => void,
    private readonly timers: HostTimers = defaultTimers(),
    opts: HostOptions = {},
  ) {
    this.budgetMs = opts.budgetMs ?? 14;
    this.snapshotMs = opts.snapshotMs ?? 25;
    this.syncStepLimit = opts.syncStepLimit ?? 2000;
  }

  /** 供测试检查 */
  get currentRunner(): SimRunner | null {
    return this.runner;
  }
  get currentMode(): SimMode {
    return this.mode;
  }

  dispose(): void {
    this.disposed = true;
    this.mode = 'paused';
    if (this.timer !== null) this.timers.cancel(this.timer);
    this.timer = null;
    this.runner = null;
  }

  handle(msg: ToWorker): void {
    if (this.disposed) return;
    try {
      this.dispatch(msg);
    } catch (e) {
      const message = e instanceof NetlistError ? `网表无效：${e.message}` : e instanceof Error ? e.message : String(e);
      this.post({ type: 'error', gen: this.gen, message });
    }
  }

  private dispatch(msg: ToWorker): void {
    switch (msg.type) {
      case 'load': {
        this.mode = 'paused';
        this.runner = null;
        this.gen = msg.gen;
        const t0 = this.timers.now();
        const r = new SimRunner(msg.netlist, msg.board, { freqHz: msg.freqHz, baud: msg.baud });
        if (msg.inputs) r.setInputsByName(msg.inputs);
        this.runner = r;
        const info: LoadInfo = {
          compiled: r.sim.compiled,
          gates: r.sim.combGateCount,
          flipflops: r.sim.flipflopCount,
          latches: r.sim.latchCount,
          clockNets: r.sim.clockNetCount,
          loopMode: r.sim.loopMode,
          compileMs: this.timers.now() - t0,
        };
        this.post({ type: 'loaded', gen: this.gen, info });
        this.speed = normSpeed(msg.speed);
        this.resetStats();
        if (msg.run) this.start('running');
        else this.emit();
        return;
      }
      case 'setInput':
        if (!this.runner) return;
        this.runner.setInput(msg.index, msg.level);
        if (this.mode === 'paused') this.emit();
        return;
      case 'run':
        if (!this.runner) return;
        if (msg.speed !== undefined) this.speed = normSpeed(msg.speed);
        this.start('running');
        return;
      case 'speed':
        this.speed = normSpeed(msg.speed);
        this.credit = 0;
        this.lastTick = this.timers.now();
        this.emit();
        if (this.mode === 'running') this.schedule(0);
        return;
      case 'pause':
        this.mode = 'paused';
        this.stepRemaining = 0;
        this.emit();
        return;
      case 'step': {
        if (!this.runner) return;
        const n = Math.max(1, Math.min(1e12, Math.floor(msg.cycles) || 1));
        if (n <= this.syncStepLimit) {
          this.mode = 'paused';
          this.stepRemaining = 0;
          this.runner.runCycles(n);
          this.emit();
        } else {
          this.stepRemaining = n;
          this.start('stepping');
        }
        return;
      }
      case 'reset':
        if (!this.runner) return;
        this.runner.reset();
        this.stepRemaining = 0;
        if (this.mode === 'stepping') this.mode = 'paused';
        this.resetStats();
        this.emit();
        return;
      case 'uartSend':
        this.runner?.uartSend(msg.bytes);
        if (this.mode === 'paused') this.emit();
        return;
      case 'uartClear':
        this.runner?.uartClearQueue();
        if (this.mode === 'paused') this.emit();
        return;
      case 'config':
        this.runner?.configure({ freqHz: msg.freqHz, baud: msg.baud });
        return;
    }
  }

  private resetStats(): void {
    const now = this.timers.now();
    this.lastSnapAt = now;
    this.lastSnapCycles = this.runner?.cycles ?? 0;
    this.lastSnapEvals = this.runner?.sim.gateEvals ?? 0;
    this.achievedHz = 0;
    this.evalRate = 0;
    this.credit = 0;
    this.lastTick = now;
  }

  private start(mode: 'running' | 'stepping'): void {
    const was = this.mode;
    this.mode = mode;
    if (was === 'paused') {
      // 定速运行时立刻执行第一个周期，慢速下点击「运行」也能马上看到变化
      this.credit = 1;
      this.lastTick = this.timers.now();
      this.lastSnapAt = this.lastTick;
      this.lastSnapCycles = this.runner?.cycles ?? 0;
      this.lastSnapEvals = this.runner?.sim.gateEvals ?? 0;
    }
    this.emit();
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.disposed) return;
    if (this.timer !== null) {
      this.timers.cancel(this.timer);
      this.timer = null;
    }
    if (ms <= 0) {
      if (this.scheduled) return;
      this.scheduled = true;
      this.timers.soon(() => {
        this.scheduled = false;
        this.tick();
      });
    } else {
      this.timer = this.timers.later(() => {
        this.timer = null;
        this.tick();
      }, ms);
    }
  }

  /** 一个调度片 */
  private tick(): void {
    const r = this.runner;
    if (!r || this.mode === 'paused' || this.disposed) return;
    const t0 = this.timers.now();
    let todo: number;
    if (this.mode === 'stepping') todo = this.stepRemaining;
    else if (this.speed === 'max') todo = Number.POSITIVE_INFINITY;
    else {
      const hz = this.speed;
      this.credit += ((t0 - this.lastTick) / 1000) * hz;
      // 跟不上时最多积压 0.2 秒，避免恢复时爆发
      this.credit = Math.min(this.credit, Math.max(1, hz * 0.2));
      todo = Math.floor(this.credit);
    }
    this.lastTick = t0;

    let done = 0;
    let now = t0;
    // 批数上限：计时器精度很粗（隐私模式）时也保证让出事件循环
    for (let batches = 0; done < todo && batches < 4096; batches++) {
      const k = Math.min(this.batch, todo - done);
      const b0 = now;
      r.runCycles(k);
      done += k;
      now = this.timers.now();
      const dt = now - b0;
      // 自适应批大小：每批约 1ms
      if (k === this.batch) {
        if (dt < 0.5) this.batch = Math.min(this.batch * 2, 1 << 20);
        else if (dt > 2) this.batch = Math.max(1, Math.floor(this.batch / 2));
      }
      if (now - t0 >= this.budgetMs) break;
    }
    if (this.mode === 'stepping') {
      this.stepRemaining -= done;
      if (this.stepRemaining <= 0) {
        this.stepRemaining = 0;
        this.mode = 'paused';
        this.emit();
        return;
      }
    } else if (this.speed !== 'max') {
      this.credit -= done;
    }

    if (now - this.lastSnapAt >= this.snapshotMs) this.emit();

    if (this.mode === 'stepping' || this.speed === 'max' || this.credit >= 1) {
      this.schedule(0);
    } else {
      const hz = this.speed as number;
      const wait = ((1 - this.credit) / hz) * 1000;
      // 慢速时也定期唤醒以更新实测速度
      this.schedule(Math.max(1, Math.min(wait, 100)));
    }
  }

  /** 发送快照 */
  private emit(): void {
    const r = this.runner;
    if (!r) return;
    const now = this.timers.now();
    const s = r.snapshot();
    const dt = (now - this.lastSnapAt) / 1000;
    if (this.mode !== 'paused' && dt > 0.001) {
      const hz = (r.cycles - this.lastSnapCycles) / dt;
      const er = (r.sim.gateEvals - this.lastSnapEvals) / dt;
      // 指数平滑，显示更稳定
      this.achievedHz = this.achievedHz > 0 ? this.achievedHz * 0.6 + hz * 0.4 : hz;
      this.evalRate = this.evalRate > 0 ? this.evalRate * 0.6 + er * 0.4 : er;
    } else if (this.mode === 'paused') {
      this.achievedHz = 0;
      this.evalRate = 0;
    }
    this.lastSnapAt = now;
    this.lastSnapCycles = r.cycles;
    this.lastSnapEvals = r.sim.gateEvals;
    const snap: Snapshot = {
      gen: this.gen,
      seq: ++this.seq,
      mode: this.mode,
      speed: this.speed,
      cycles: s.cycles,
      achievedHz: this.achievedHz,
      gateEvalsPerSec: this.evalRate,
      values: s.values,
      duty: s.duty,
      segJoint: s.segJoint,
      uart: s.uart,
      uartErrors: s.uartErrors,
      rxPending: s.rxPending,
      oscillating: s.oscillating,
      stepRemaining: this.stepRemaining,
    };
    this.post({ type: 'snapshot', snap });
  }
}

function normSpeed(s: SimSpeed): SimSpeed {
  if (s === 'max') return 'max';
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(MAX_HZ, s);
}
