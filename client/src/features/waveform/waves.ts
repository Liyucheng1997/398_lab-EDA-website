// 波形数据查询：二分查找、取值、派生波形（位展开、模拟数值）、可见段遍历（含 <1px 合并）。

import { bitsState, bitsToNumber, formatBits, formatReal, type Radix } from './format';
import { BIT_X, BIT_Z, type Wave } from './vcd';

/** 第一个 times[i] > t 的下标（从 lo 开始搜索） */
export function upperBound(times: ArrayLike<number>, t: number, lo = 0, hi = times.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第一个 times[i] >= t 的下标 */
export function lowerBound(times: ArrayLike<number>, t: number, lo = 0, hi = times.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** t 时刻生效的跳变下标；t 早于第一个跳变时返回 -1 */
export function indexAt(wave: Wave, t: number): number {
  return upperBound(wave.times, t) - 1;
}

/** t 之后（严格大于）的下一个跳变时刻 */
export function nextEdge(wave: Wave, t: number): number | null {
  const i = upperBound(wave.times, t);
  return i < wave.times.length ? wave.times[i] : null;
}

/** t 之前（严格小于）的上一个跳变时刻 */
export function prevEdge(wave: Wave, t: number): number | null {
  const i = lowerBound(wave.times, t) - 1;
  return i >= 0 ? wave.times[i] : null;
}

const BIT_TEXT = ['0', '1', 'x', 'z'];

/** 第 i 个跳变的值文本（按进制） */
export function valueText(wave: Wave, i: number, radix: Radix): string {
  if (i < 0 || i >= wave.times.length) return '';
  switch (wave.kind) {
    case 'bit':
      return BIT_TEXT[wave.bits![i]] ?? 'x';
    case 'event':
      return '';
    case 'vec':
      return formatBits(wave.vecs![i], radix);
    case 'string':
      return wave.vecs![i];
    case 'real':
      return formatReal(wave.reals![i]);
  }
}

/** 第 i 个跳变的状态：ok / x / z（用于着色） */
export function valueStateAt(wave: Wave, i: number): 'ok' | 'x' | 'z' {
  if (i < 0 || i >= wave.times.length) return 'ok';
  switch (wave.kind) {
    case 'bit': {
      const b = wave.bits![i];
      return b === BIT_X ? 'x' : b === BIT_Z ? 'z' : 'ok';
    }
    case 'vec':
      return bitsState(wave.vecs![i]);
    case 'real':
      return Number.isNaN(wave.reals![i]) ? 'x' : 'ok';
    default:
      return 'ok';
  }
}

/** 光标处的值文本；事件信号在恰好触发时显示 "↑" */
export function valueAtText(wave: Wave, t: number, radix: Radix): string {
  const i = indexAt(wave, t);
  if (i < 0) return '';
  if (wave.kind === 'event') return wave.times[i] === t ? '↑' : '';
  return valueText(wave, i, radix);
}

// ---------------------------------------------------------------------------
// 派生波形

const bitCache = new WeakMap<Wave, Map<number, Wave>>();

/** 从向量波形中抽出第 k 位（k = 0 为 MSB）形成标量波形；结果缓存 */
export function bitWave(wave: Wave, k: number): Wave {
  let m = bitCache.get(wave);
  if (!m) {
    m = new Map();
    bitCache.set(wave, m);
  }
  const hit = m.get(k);
  if (hit) return hit;
  const n = wave.times.length;
  const times = new Float64Array(n);
  const bits = new Uint8Array(n);
  let c = 0;
  let prev = -1;
  const vecs = wave.vecs ?? [];
  for (let i = 0; i < n; i++) {
    const ch = vecs[i]?.[k] ?? 'x';
    const code = ch === '0' ? 0 : ch === '1' ? 1 : ch === 'z' ? BIT_Z : BIT_X;
    if (code === prev) continue;
    prev = code;
    times[c] = wave.times[i];
    bits[c] = code;
    c++;
  }
  const out: Wave = { kind: 'bit', width: 1, times: times.slice(0, c), bits: bits.slice(0, c) };
  m.set(k, out);
  return out;
}

export interface Analog {
  /** 每个跳变的数值（x/z → NaN） */
  values: Float64Array;
  min: number;
  max: number;
}

const analogCache = new WeakMap<Wave, Map<string, Analog>>();

/** 模拟视图用的数值数组与范围（向量按有/无符号解释；实数直接使用） */
export function analogOf(wave: Wave, signed: boolean): Analog {
  const key = wave.kind === 'real' ? 'r' : signed ? 's' : 'u';
  let m = analogCache.get(wave);
  if (!m) {
    m = new Map();
    analogCache.set(wave, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const n = wave.times.length;
  let values: Float64Array;
  if (wave.kind === 'real') values = wave.reals ?? new Float64Array(0);
  else if (wave.kind === 'vec') {
    values = new Float64Array(n);
    const vecs = wave.vecs!;
    for (let i = 0; i < n; i++) values[i] = bitsToNumber(vecs[i], signed);
  } else if (wave.kind === 'bit') {
    values = new Float64Array(n);
    const bits = wave.bits!;
    for (let i = 0; i < n; i++) values[i] = bits[i] <= 1 ? bits[i] : Number.NaN;
  } else values = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) {
    min = 0;
    max = 1;
  }
  const out: Analog = { values, min, max };
  m.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// 可见段遍历

export interface SegmentVisitor {
  /** 一个足够宽（≥ minPx）的段：跳变 i，从 x0 到 x1 */
  seg(i: number, x0: number, x1: number): void;
  /** 一串过密（每段 < minPx）的跳变合并成一个块：覆盖跳变 iFrom..iTo（含） */
  dense(x0: number, x1: number, iFrom: number, iTo: number): void;
}

/**
 * 遍历可见窗口中的跳变段。复杂度约 O(可见像素 × log n + 宽段数)，与总跳变数无关。
 * @param times 跳变时刻
 * @param viewStart 画布 x=0 对应的时间
 * @param scale 像素 / 时间单位
 * @param widthPx 画布宽度
 * @param endTime 最后一段的结束时间
 */
export function scanSegments(
  times: ArrayLike<number>,
  viewStart: number,
  scale: number,
  widthPx: number,
  endTime: number,
  visitor: SegmentVisitor,
  minPx = 1,
): void {
  const n = times.length;
  if (n === 0 || !(scale > 0)) return;
  const tB = viewStart + widthPx / scale;
  const xOf = (t: number) => (t - viewStart) * scale;
  const endOf = (i: number) => (i + 1 < n ? times[i + 1] : Math.max(endTime, times[i]));
  let i = Math.max(0, upperBound(times, viewStart) - 1);
  let guard = 0;
  const guardMax = widthPx * 4 + 4096;
  while (i < n && times[i] <= tB) {
    const x0 = xOf(times[i]);
    const x1 = xOf(endOf(i));
    if (x1 - x0 >= minPx || i + 1 >= n) {
      visitor.seg(i, x0, x1);
      i++;
      continue;
    }
    // 过密：向前跳到下一个"宽段"
    let k = i;
    for (;;) {
      if (++guard > guardMax) break;
      const target = viewStart + (xOf(times[k]) + minPx) / scale;
      const j = lowerBound(times, target, k + 1);
      k = j - 1;
      if (j >= n) break;
      const ks = xOf(times[k]);
      const ke = xOf(times[j]);
      if (ke - ks >= minPx || ks > widthPx) break;
    }
    if (k <= i) k = i + 1; // 保证前进
    if (k >= n) k = n - 1;
    const kx = xOf(times[k]);
    // 段 k 若仍过窄（文件结尾或保护触发），并入块
    const kWide = xOf(endOf(k)) - kx >= minPx;
    if (kWide) {
      visitor.dense(x0, Math.max(kx, x0 + minPx), i, k - 1);
      i = k;
    } else {
      visitor.dense(x0, Math.max(xOf(endOf(k)), x0 + minPx), i, k);
      i = k + 1;
    }
  }
}
