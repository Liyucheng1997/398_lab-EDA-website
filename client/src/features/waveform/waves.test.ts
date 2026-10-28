import { describe, expect, it } from 'vitest';
import { analogOf, bitWave, indexAt, lowerBound, nextEdge, prevEdge, scanSegments, upperBound, valueAtText } from './waves';
import type { Wave } from './vcd';

const vec: Wave = {
  kind: 'vec',
  width: 4,
  times: Float64Array.from([0, 10, 20, 30]),
  vecs: ['0000', '1010', 'x011', '1111'],
};

describe('binary search', () => {
  it('upper/lower bound', () => {
    const t = [0, 10, 10, 20];
    expect(upperBound(t, 10)).toBe(3);
    expect(lowerBound(t, 10)).toBe(1);
    expect(upperBound(t, -1)).toBe(0);
    expect(lowerBound(t, 99)).toBe(4);
  });
  it('indexAt / edges', () => {
    expect(indexAt(vec, -5)).toBe(-1);
    expect(indexAt(vec, 15)).toBe(1);
    expect(indexAt(vec, 20)).toBe(2);
    expect(nextEdge(vec, 10)).toBe(20);
    expect(nextEdge(vec, 30)).toBeNull();
    expect(prevEdge(vec, 10)).toBe(0);
    expect(prevEdge(vec, 0)).toBeNull();
  });
  it('valueAtText', () => {
    expect(valueAtText(vec, 25, 'hex')).toBe('X');
    expect(valueAtText(vec, 12, 'dec')).toBe('10');
    expect(valueAtText(vec, -1, 'hex')).toBe('');
    const ev: Wave = { kind: 'event', width: 1, times: Float64Array.from([5]), bits: Uint8Array.from([1]) };
    expect(valueAtText(ev, 5, 'hex')).toBe('↑');
    expect(valueAtText(ev, 6, 'hex')).toBe('');
  });
});

describe('derived waves', () => {
  it('extracts a bit and dedupes', () => {
    const b0 = bitWave(vec, 0); // MSB
    expect(Array.from(b0.times)).toEqual([0, 10, 20, 30]);
    expect(Array.from(b0.bits!)).toEqual([0, 1, 2, 1]);
    const b3 = bitWave(vec, 3); // LSB: 0,0,1,1
    expect(Array.from(b3.times)).toEqual([0, 20]);
    expect(bitWave(vec, 3)).toBe(b3);
  });
  it('analog values', () => {
    const u = analogOf(vec, false);
    expect(Array.from(u.values.slice(0, 2))).toEqual([0, 10]);
    expect(Number.isNaN(u.values[2])).toBe(true);
    expect(u.min).toBe(0);
    expect(u.max).toBe(15);
    const s = analogOf(vec, true);
    expect(s.min).toBe(-6);
    expect(s.max).toBe(0);
  });
});

describe('scanSegments', () => {
  function collect(times: number[], start: number, scale: number, width: number, end: number) {
    const out: string[] = [];
    let iterations = 0;
    let lastX = -Infinity;
    let monotonic = true;
    scanSegments(Float64Array.from(times), start, scale, width, end, {
      seg: (i, x0, x1) => {
        iterations++;
        if (x0 < lastX - 1e-9) monotonic = false;
        lastX = x0;
        out.push(`s${i}:${x0.toFixed(0)}-${x1.toFixed(0)}`);
      },
      dense: (x0, x1, a, b) => {
        iterations++;
        if (x0 < lastX - 1e-9) monotonic = false;
        lastX = x0;
        out.push(`d${a}-${b}:${x0.toFixed(0)}-${x1.toFixed(0)}`);
      },
    });
    return { out, iterations, monotonic };
  }

  it('emits wide segments', () => {
    expect(collect([0, 10, 20], 0, 1, 100, 30).out).toEqual(['s0:0-10', 's1:10-20', 's2:20-30']);
  });

  it('starts from the segment covering the view start', () => {
    expect(collect([0, 10, 20], 15, 1, 100, 30).out).toEqual(['s1:-5-5', 's2:5-15']);
  });

  it('stops after view end', () => {
    expect(collect([0, 10, 20, 300], 0, 1, 15, 400).out).toEqual(['s0:0-10', 's1:10-20']);
  });

  it('coalesces sub-pixel transitions', () => {
    const times = [0, 10];
    for (let k = 0; k < 1000; k++) times.push(20 + k * 0.01);
    times.push(50);
    const r = collect(times, 0, 1, 100, 60);
    expect(r.out[0]).toBe('s0:0-10');
    expect(r.out[1]).toBe('s1:10-20');
    expect(r.out.some((s) => s.startsWith('d2-'))).toBe(true);
    expect(r.out[r.out.length - 1]).toBe('s1002:50-60');
    expect(r.iterations).toBeLessThan(40);
    expect(r.monotonic).toBe(true);
  });

  it('covers every transition exactly once', () => {
    const times: number[] = [];
    let t = 0;
    for (let k = 0; k < 5000; k++) {
      t += k % 7 === 0 ? 50 : 0.3;
      times.push(t);
    }
    const covered = new Uint8Array(times.length);
    scanSegments(Float64Array.from(times), 0, 1, 1e9, t + 10, {
      seg: (i) => covered[i]++,
      dense: (_x0, _x1, a, b) => {
        for (let i = a; i <= b; i++) covered[i]++;
      },
    });
    expect(covered.every((c) => c === 1)).toBe(true);
  });

  it('scales with pixels, not transitions', () => {
    const n = 200_000;
    const times = new Array<number>(n);
    for (let i = 0; i < n; i++) times[i] = i;
    const r = collect(times, 0, 1000 / n, 1000, n);
    expect(r.iterations).toBeLessThan(3000);
    expect(r.monotonic).toBe(true);
  });

  it('handles empty and zero-width', () => {
    expect(collect([], 0, 1, 100, 10).out).toEqual([]);
    expect(collect([5], 0, 1, 100, 5).out).toEqual(['s0:5-5']);
  });
});
