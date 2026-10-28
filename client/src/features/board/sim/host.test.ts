import { describe, expect, it } from 'vitest';
import type { GateNetlist } from '@webeda/shared';
import { SimHost, type HostTimers } from './host';
import type { FromWorker, Snapshot } from './protocol';
import { NetlistBuilder } from './testing';

/** 手动推进的假时钟 */
function fakeTimers(step = 0.01) {
  let t = 0;
  const soonQ: (() => void)[] = [];
  const later: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const timers: HostTimers = {
    // 每次读取时间都前进一点，模拟计算耗时
    now: () => (t += step),
    later: (fn, ms) => {
      later.push({ at: t + ms, fn, id: ++id });
      return id;
    },
    cancel: (h) => {
      const i = later.findIndex((l) => l.id === h);
      if (i >= 0) later.splice(i, 1);
    },
    soon: (fn) => void soonQ.push(fn),
  };
  return {
    timers,
    advance(ms: number) {
      t += ms;
    },
    /** 执行一个排队任务（先 soon，再到期的 later） */
    runOne(): boolean {
      const f = soonQ.shift();
      if (f) {
        f();
        return true;
      }
      later.sort((a, b) => a.at - b.at);
      const l = later[0];
      if (l && l.at <= t) {
        later.shift();
        l.fn();
        return true;
      }
      return false;
    },
    pendingLater: () => later.length,
  };
}

function counterNetlist(): GateNetlist {
  const nb = new NetlistBuilder();
  const [clk] = nb.input('clk');
  const sw = nb.input('sw', 1);
  nb.output('led', [...nb.counter(4, clk), nb.buf(sw[0])]);
  return nb.build();
}

function setup(step?: number) {
  const ft = fakeTimers(step);
  const msgs: FromWorker[] = [];
  const host = new SimHost((m) => msgs.push(m), ft.timers, { budgetMs: 5, snapshotMs: 10, syncStepLimit: 100 });
  const snaps = () => msgs.filter((m): m is { type: 'snapshot'; snap: Snapshot } => m.type === 'snapshot').map((m) => m.snap);
  return { ft, msgs, host, snaps, last: () => snaps()[snaps().length - 1] };
}

describe('SimHost', () => {
  it('loads, reports info and restores inputs by name', () => {
    const { host, msgs, last } = setup();
    host.handle({ type: 'load', gen: 1, netlist: counterNetlist(), freqHz: 1e6, baud: 9600, inputs: { sw: 1 }, run: false, speed: 'max' });
    const loaded = msgs.find((m) => m.type === 'loaded');
    expect(loaded && loaded.type === 'loaded' && loaded.info.flipflops).toBe(4);
    const s = last();
    expect(s.mode).toBe('paused');
    expect(s.values[s.values.length - 1]).toBe(1); // led[4] = sw
  });

  it('reports netlist errors instead of throwing', () => {
    const { host, msgs } = setup();
    host.handle({ type: 'load', gen: 1, netlist: { ...counterNetlist(), netCount: 1 }, freqHz: 1e6, baud: 9600, run: true, speed: 'max' });
    expect(msgs[0].type).toBe('error');
    // 未加载时的命令被忽略
    host.handle({ type: 'step', cycles: 1 });
    host.handle({ type: 'run' });
    expect(msgs).toHaveLength(1);
  });

  it('steps synchronously for small counts and in slices for large ones', () => {
    const { host, ft, last } = setup();
    host.handle({ type: 'load', gen: 1, netlist: counterNetlist(), freqHz: 1e6, baud: 9600, run: false, speed: 'max' });
    host.handle({ type: 'step', cycles: 3 });
    expect(last().cycles).toBe(3);
    expect(last().mode).toBe('paused');
    host.handle({ type: 'step', cycles: 5000 });
    expect(last().mode).toBe('stepping');
    let guard = 0;
    while (host.currentMode === 'stepping' && guard++ < 10000) {
      ft.advance(1);
      ft.runOne();
    }
    expect(last().mode).toBe('paused');
    expect(last().cycles).toBe(5003);
    expect(last().stepRemaining).toBe(0);
  });

  it('runs at a target rate', () => {
    const { host, ft, last } = setup();
    host.handle({ type: 'load', gen: 1, netlist: counterNetlist(), freqHz: 1e6, baud: 9600, run: true, speed: 100 });
    // 模拟 1 秒
    for (let i = 0; i < 1000; i++) {
      ft.advance(1);
      while (ft.runOne()) {
        /* 执行到期任务 */
      }
    }
    const c = host.currentRunner!.cycles;
    expect(c).toBeGreaterThanOrEqual(99);
    expect(c).toBeLessThanOrEqual(102);
    expect(last().mode).toBe('running');
    host.handle({ type: 'pause' });
    expect(last().mode).toBe('paused');
    expect(last().achievedHz).toBe(0);
    const at = host.currentRunner!.cycles;
    for (let i = 0; i < 100; i++) {
      ft.advance(5);
      while (ft.runOne()) {
        /* 暂停后不应推进 */
      }
    }
    expect(host.currentRunner!.cycles).toBe(at);
  });

  it('runs as fast as possible in max mode and yields between slices', () => {
    const { host, ft, last } = setup(1);
    host.handle({ type: 'load', gen: 1, netlist: counterNetlist(), freqHz: 1e6, baud: 9600, run: true, speed: 'max' });
    // 每个调度片只推进到预算用完；假时钟不前进时 batch 会持续增长，限制轮数
    for (let i = 0; i < 20; i++) {
      ft.advance(6);
      ft.runOne();
    }
    expect(host.currentRunner!.cycles).toBeGreaterThan(100);
    expect(last().mode).toBe('running');
    host.handle({ type: 'reset' });
    expect(last().cycles).toBe(0);
    host.handle({ type: 'speed', speed: 10 });
    expect(last().speed).toBe(10);
    expect(last().mode).toBe('running');
    host.dispose();
    host.handle({ type: 'step', cycles: 1 });
  });

  it('forwards UART bytes and config', () => {
    const { host, last } = setup();
    const nb = new NetlistBuilder();
    nb.input('clk');
    const [rx] = nb.input('rx');
    nb.output('tx', [nb.buf(rx)]);
    host.handle({ type: 'load', gen: 1, netlist: nb.build(), freqHz: 1000, baud: 100, run: false, speed: 'max' });
    host.handle({ type: 'config', baud: 250 });
    host.handle({ type: 'uartSend', bytes: [0x41, 0x42] });
    expect(last().rxPending).toBe(2);
    host.handle({ type: 'step', cycles: 100 });
    expect(last().uart).toEqual([0x41, 0x42]);
    host.handle({ type: 'uartSend', bytes: [0x43] });
    host.handle({ type: 'uartClear' });
    expect(last().rxPending).toBe(0);
  });
});
