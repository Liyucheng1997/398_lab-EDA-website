import { describe, expect, it } from 'vitest';
import { SimRunner } from './runner';
import { NetlistBuilder } from './testing';

const CFG = { freqHz: 1000, baud: 100 }; // 10 周期/位

function blinky() {
  const nb = new NetlistBuilder();
  const [clk] = nb.input('clk');
  const [rstn] = nb.input('rst_n');
  const sw = nb.input('sw', 2);
  const q = nb.counter(3, clk, { arst: rstn, arstPol: 0, arstVal: 0 });
  // led[0] = cnt[0]（50%），led[1] = cnt < 3（3/8），led[2] = sw[0]
  const lt3 = nb.and(nb.not(q[2]), nb.gate('NAND', q[0], q[1]));
  nb.output('led', [q[0], lt3, nb.buf(sw[0])]);
  nb.output('cnt', q);
  return nb.build();
}

describe('SimRunner', () => {
  it('drives the clock and measures duty cycles', () => {
    const r = new SimRunner(blinky(), undefined, CFG);
    const led = r.map.leds.map((l) => l.ref.index);
    r.runCycles(800);
    const s = r.snapshot();
    expect(s.cycles).toBe(800);
    expect(s.windowCycles).toBe(800);
    expect(s.duty[led[0]]).toBeCloseTo(0.5, 5);
    expect(s.duty[led[1]]).toBeCloseTo(3 / 8, 5);
    expect(s.duty[led[2]]).toBe(0);
    // 窗口清空后：无周期推进 → 占空比 = 当前值
    const s2 = r.snapshot();
    expect(s2.windowCycles).toBe(0);
    expect(s2.duty[led[0]]).toBe(s2.values[led[0]]);
  });

  it('applies inputs immediately and preserves them across reset', () => {
    const r = new SimRunner(blinky(), undefined, CFG);
    const sw0 = r.map.switches[0].ref.index;
    const led2 = r.map.leds[2].ref.index;
    r.setInput(sw0, 1);
    expect(r.snapshot().values[led2]).toBe(1);
    r.runCycles(5);
    r.reset();
    const s = r.snapshot();
    expect(s.cycles).toBe(0);
    expect(s.values[led2]).toBe(1);
    expect(r.inputLevel(sw0)).toBe(1);
  });

  it('holds the design in reset while the reset button is pressed (active-low)', () => {
    const r = new SimRunner(blinky(), undefined, CFG);
    const rst = r.map.resets[0];
    expect(rst.activeLow).toBe(true);
    const cntIdx = r.map.portOffset[r.map.ports.findIndex((p) => p.name === 'cnt')];
    const cnt = (s: { values: Uint8Array }) => s.values[cntIdx] | (s.values[cntIdx + 1] << 1) | (s.values[cntIdx + 2] << 2);
    r.runCycles(5);
    expect(cnt(r.snapshot())).toBe(5);
    r.setInput(rst.ref.index, 0);
    expect(cnt(r.snapshot())).toBe(0);
    r.runCycles(3);
    expect(cnt(r.snapshot())).toBe(0);
    r.setInput(rst.ref.index, 1);
    r.runCycles(2);
    expect(cnt(r.snapshot())).toBe(2);
  });

  it('ignores writes to outputs and clocks', () => {
    const r = new SimRunner(blinky(), undefined, CFG);
    r.setInput(r.map.leds[0].ref.index, 1);
    r.setInput(r.map.clocks[0].index, 1);
    expect(r.snapshot().values[r.map.clocks[0].index]).toBe(0);
    r.setInput(9999, 1);
  });

  it('computes multiplexed 7-segment joint duty', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const q = nb.net();
    nb.dff({ clk, d: nb.not(q), q });
    // an[0] 在 q=0 时选中，an[1] 在 q=1 时选中（高有效：digit 端口名）
    const an0 = nb.not(q);
    const an1 = nb.buf(q);
    // digit0 显示段 a，digit1 显示段 b
    const segA = nb.not(q);
    const segB = nb.buf(q);
    nb.output('seg', [segA, segB, 0, 0, 0, 0, 0]);
    nb.output('dig', [an0, an1]);
    const r = new SimRunner(nb.build(), undefined, CFG);
    expect(r.map.segMux?.anActiveLow).toBe(false);
    r.runCycles(100);
    const s = r.snapshot();
    const j = s.segJoint!;
    expect(j).toHaveLength(16);
    expect(j[0 * 8 + 0]).toBeCloseTo(0.5); // digit0 a
    expect(j[0 * 8 + 1]).toBe(0); // digit0 b
    expect(j[1 * 8 + 1]).toBeCloseTo(0.5); // digit1 b
    expect(j[1 * 8 + 0]).toBe(0);
    expect(j[1 * 8 + 7]).toBe(0); // 缺失的 dp
  });

  it('round-trips UART through a loopback design', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [rx] = nb.input('rx');
    // 打一拍再输出，确认 rx 变化后需要时钟
    const q = nb.dff({ clk, d: rx, init: 1 });
    nb.output('tx', [q]);
    const r = new SimRunner(nb.build(), undefined, CFG);
    expect(r.uartBitPeriod).toBe(10);
    const text = Array.from(new TextEncoder().encode('Hi\n'));
    r.uartSend(text);
    expect(r.snapshot().rxPending).toBe(3);
    r.runCycles(10 * 10 * 3 + 30);
    const s = r.snapshot();
    expect(s.uart).toEqual(text);
    expect(s.uartErrors).toBe(0);
    expect(s.rxPending).toBe(0);
    expect(r.snapshot().uart).toEqual([]);
  });

  it('reconfigures baud rate', () => {
    const nb = new NetlistBuilder();
    nb.input('clk');
    const [rx] = nb.input('uart_rx');
    nb.output('uart_tx', [nb.buf(rx)]);
    const r = new SimRunner(nb.build(), undefined, CFG);
    r.configure({ baud: 250 });
    expect(r.uartBitPeriod).toBe(4);
    r.configure({ freqHz: 0, baud: -1 }); // 无效值被忽略
    expect(r.uartBitPeriod).toBe(4);
    r.uartSend([0x5a]);
    r.runCycles(60);
    expect(r.snapshot().uart).toEqual([0x5a]);
  });

  it('runs designs without a clock (cycles still advance)', () => {
    const nb = new NetlistBuilder();
    const [a] = nb.input('a');
    nb.output('y', [nb.not(a)]);
    const r = new SimRunner(nb.build(), undefined, CFG);
    r.runCycles(10);
    const s = r.snapshot();
    expect(s.cycles).toBe(10);
    expect(s.duty[1]).toBe(1);
  });
});
