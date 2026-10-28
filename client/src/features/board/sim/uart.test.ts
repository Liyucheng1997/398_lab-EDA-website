import { describe, expect, it } from 'vitest';
import { UartDecoder, UartEncoder, bitPeriod } from './uart';

function loopback(period: number, bytes: number[], extraCycles = 0) {
  const enc = new UartEncoder(period);
  const got: [number, boolean][] = [];
  const dec = new UartDecoder(period, (b, e) => got.push([b, e]));
  enc.enqueue(bytes);
  const total = Math.ceil(period * 10 * bytes.length) + 5 + extraCycles;
  for (let c = 0; c < total; c++) dec.sample(enc.level(c), c);
  return { got, enc };
}

describe('uart', () => {
  it('computes bit periods', () => {
    expect(bitPeriod(12e6, 115200)).toBeCloseTo(104.1667, 3);
    expect(bitPeriod(0, 9600)).toBe(0);
    expect(bitPeriod(1e6, 0)).toBe(0);
  });

  it.each([4, 8, 16, 104.1667, 868.0555, 3.5])('loops back bytes at %f cycles/bit', (p) => {
    const data = [0x00, 0xff, 0x55, 0xaa, 0x48, 0x69, 0x0a, 0x81];
    const { got, enc } = loopback(p, data);
    expect(got.map((g) => g[0])).toEqual(data);
    expect(got.every((g) => !g[1])).toBe(true);
    expect(enc.busy).toBe(false);
    expect(enc.pending).toBe(0);
  });

  it('frames bits LSB first with start and stop bits', () => {
    const enc = new UartEncoder(2);
    enc.enqueue([0b10110001]);
    const levels: number[] = [];
    for (let c = 0; c < 24; c++) levels.push(enc.level(c));
    // start(0) d0..d7 = 1,0,0,0,1,1,0,1 stop(1) → each bit 2 cycles
    expect(levels.slice(0, 20)).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1]);
    expect(levels.slice(20)).toEqual([1, 1, 1, 1]);
  });

  it('flags framing errors and ignores glitches', () => {
    const got: [number, boolean][] = [];
    const dec = new UartDecoder(10, (b, e) => got.push([b, e]));
    let c = 0;
    const drive = (level: number, n: number) => {
      for (let i = 0; i < n; i++) dec.sample(level, c++);
    };
    drive(1, 20);
    drive(0, 2); // 毛刺：比半个位短
    drive(1, 30);
    expect(got).toEqual([]);
    drive(0, 100); // break：全 0 → 字节 0 且停止位错误
    expect(got).toEqual([[0, true]]);
    drive(1, 30);
    expect(got).toHaveLength(1);
  });

  it('idles high and does nothing with an invalid period', () => {
    const enc = new UartEncoder(0);
    enc.enqueue([1, 2, 3]);
    expect(enc.level(0)).toBe(1);
    enc.clear();
    expect(enc.pending).toBe(0);
  });
});
