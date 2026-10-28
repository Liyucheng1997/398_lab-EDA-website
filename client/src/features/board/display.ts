/** 虚拟开发板界面用的纯函数：亮度换算、数值格式化、速度滑块映射 */
import type { SegMux } from './sim/peripherals';

/** 有效电平占比：低有效时取反 */
export function activeDuty(duty: number, activeLow: boolean): number {
  const d = activeLow ? 1 - duty : duty;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/**
 * 占空比 → 显示亮度（0..1）。极低占空比视为熄灭；
 * 用平方根近似人眼对亮度的感知，让 PWM 调光在低占空比时也有可见差异。
 */
export function ledLevel(duty: number): number {
  if (!(duty > 0.002)) return 0;
  return Math.min(1, 0.12 + 0.88 * Math.sqrt(Math.min(1, duty)));
}

/**
 * 多路复用数码管各段的亮度，下标 d*8+s。
 * joint = 位选 d 与段 s 原始电平同为 1 的占比；按极性用容斥换算出「位选有效且段有效」的占比，
 * 再按最亮那一位的位选占比归一化（模拟人眼余辉：4 位轮流扫描时每位都显示为正常亮度）。
 */
export function muxSegLevels(
  mux: Pick<SegMux, 'segs' | 'digits'>,
  joint: Float32Array | null,
  duty: Float32Array,
  anActiveLow: boolean,
  segActiveLow: boolean,
): Float32Array {
  const nd = mux.digits.length;
  const out = new Float32Array(Math.max(1, nd) * 8);
  if (nd === 0) {
    // 没有位选：单个常亮数码管
    for (let s = 0; s < 8; s++) {
      const r = mux.segs[s];
      out[s] = r ? activeDuty(duty[r.index] ?? 0, segActiveLow) : 0;
    }
    return out;
  }
  if (!joint || joint.length < nd * 8) return out;
  let maxDigit = 0;
  for (let d = 0; d < nd; d++) maxDigit = Math.max(maxDigit, activeDuty(duty[mux.digits[d].index] ?? 0, anActiveLow));
  if (maxDigit <= 0.0005) return out;
  const gain = 1 / maxDigit;
  for (let d = 0; d < nd; d++) {
    const A = duty[mux.digits[d].index] ?? 0;
    for (let s = 0; s < 8; s++) {
      const r = mux.segs[s];
      if (!r) continue;
      const S = duty[r.index] ?? 0;
      const J = joint[d * 8 + s];
      let f: number;
      if (!anActiveLow && !segActiveLow) f = J;
      else if (!anActiveLow && segActiveLow) f = A - J;
      else if (anActiveLow && !segActiveLow) f = S - J;
      else f = 1 - A - S + J;
      out[d * 8 + s] = Math.max(0, Math.min(1, f * gain));
    }
  }
  return out;
}

/** 静态数码管各段亮度 */
export function staticSegLevels(segs: SegMux['segs'], duty: Float32Array, activeLow: boolean): Float32Array {
  const out = new Float32Array(8);
  for (let s = 0; s < 8; s++) {
    const r = segs[s];
    out[s] = r ? activeDuty(duty[r.index] ?? 0, activeLow) : 0;
  }
  return out;
}

function trimNum(x: number, digits: number): string {
  const t = x.toFixed(digits);
  return t.includes('.') ? t.replace(/\.?0+$/, '') : t;
}

/** 1234567 → "1.23 MHz" */
export function formatHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '0 Hz';
  if (hz >= 1e9) return `${trimNum(hz / 1e9, 2)} GHz`;
  if (hz >= 1e6) return `${trimNum(hz / 1e6, hz >= 1e8 ? 0 : hz >= 1e7 ? 1 : 2)} MHz`;
  if (hz >= 1e3) return `${trimNum(hz / 1e3, hz >= 1e5 ? 0 : hz >= 1e4 ? 1 : 2)} kHz`;
  if (hz >= 10) return `${Math.round(hz)} Hz`;
  return `${trimNum(hz, 1)} Hz`;
}

/** 仿真时间（秒）→ 可读字符串 */
export function formatSimTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0 s';
  if (sec < 1e-6) return `${trimNum(sec * 1e9, 1)} ns`;
  if (sec < 1e-3) return `${trimNum(sec * 1e6, 1)} µs`;
  if (sec < 1) return `${trimNum(sec * 1e3, 2)} ms`;
  if (sec < 60) return `${trimNum(sec, 3)} s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    return `${m} min ${trimNum(sec - m * 60, 1)} s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec - h * 3600) / 60);
  return `${h} h ${m} min`;
}

/** 大整数缩写：12345 → "12.3k" */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e12) return `${trimNum(n / 1e12, 2)}T`;
  if (a >= 1e9) return `${trimNum(n / 1e9, 2)}G`;
  if (a >= 1e6) return `${trimNum(n / 1e6, 2)}M`;
  if (a >= 1e4) return `${trimNum(n / 1e3, 1)}k`;
  return String(Math.round(n));
}

/* ───── 速度滑块（对数刻度 1 Hz … 100 MHz） ───── */

export const SPEED_MIN_HZ = 1;
export const SPEED_MAX_HZ = 1e8;
export const SLIDER_STEPS = 1000;

/** 取 1/2/5 序列附近的整齐值 */
export function niceHz(hz: number): number {
  if (!(hz > 0)) return SPEED_MIN_HZ;
  const e = Math.floor(Math.log10(hz));
  const base = 10 ** e;
  const m = hz / base;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - m) < Math.abs(best - m)) best = s;
  return Math.max(SPEED_MIN_HZ, Math.min(SPEED_MAX_HZ, Math.round(best * base)));
}

export function sliderToHz(x: number): number {
  const t = Math.max(0, Math.min(SLIDER_STEPS, x)) / SLIDER_STEPS;
  const lo = Math.log10(SPEED_MIN_HZ);
  const hi = Math.log10(SPEED_MAX_HZ);
  return niceHz(10 ** (lo + t * (hi - lo)));
}

export function hzToSlider(hz: number): number {
  const lo = Math.log10(SPEED_MIN_HZ);
  const hi = Math.log10(SPEED_MAX_HZ);
  const h = Math.max(SPEED_MIN_HZ, Math.min(SPEED_MAX_HZ, hz));
  return Math.round(((Math.log10(h) - lo) / (hi - lo)) * SLIDER_STEPS);
}

/* ───── 端口值格式化 / 解析 ───── */

export type Radix = 'hex' | 'bin' | 'dec';

/** 读取 values[offset .. offset+width) 组成的数（LSB 在前） */
export function bitsToBigInt(values: ArrayLike<number>, offset: number, width: number): bigint {
  let x = 0n;
  for (let i = width - 1; i >= 0; i--) x = (x << 1n) | BigInt(values[offset + i] ? 1 : 0);
  return x;
}

export function formatPortValue(values: ArrayLike<number>, offset: number, width: number, radix: Radix): string {
  if (width <= 0) return '';
  const x = bitsToBigInt(values, offset, width);
  if (radix === 'dec') return x.toString(10);
  if (radix === 'bin') {
    const s = x.toString(2).padStart(width, '0');
    // 每 4 位一个下划线，便于阅读
    return s.replace(/\B(?=(\d{4})+(?!\d))/g, '_');
  }
  const digits = Math.ceil(width / 4);
  return x.toString(16).toUpperCase().padStart(digits, '0');
}

/**
 * 解析用户输入的端口值，返回 LSB 在前的位数组；超出位宽或格式错误返回 null。
 * 支持 0x1F / 'h1F / 1F（默认按 defaultRadix）、0b101 / 'b101、0d12 / 'd12、带下划线。
 */
export function parsePortValue(text: string, width: number, defaultRadix: Radix = 'hex'): number[] | null {
  let s = text.trim().replace(/_/g, '').toLowerCase();
  if (!s) return null;
  s = s.replace(/^\d*'/, "'");
  let radix: Radix = defaultRadix;
  const pre = /^(0x|'h|0b|'b|0d|'d)/.exec(s);
  if (pre) {
    radix = pre[1].endsWith('x') || pre[1].endsWith('h') ? 'hex' : pre[1].endsWith('b') ? 'bin' : 'dec';
    s = s.slice(pre[1].length);
  }
  const re = radix === 'hex' ? /^[0-9a-f]+$/ : radix === 'bin' ? /^[01]+$/ : /^[0-9]+$/;
  if (!re.test(s)) return null;
  let x: bigint;
  try {
    x = radix === 'hex' ? BigInt(`0x${s}`) : radix === 'bin' ? BigInt(`0b${s}`) : BigInt(s);
  } catch {
    return null;
  }
  if (width <= 0 || x >> BigInt(width) !== 0n) return null;
  const out: number[] = [];
  for (let i = 0; i < width; i++) out.push(Number((x >> BigInt(i)) & 1n));
  return out;
}

/* ───── 串口显示 ───── */

/** 字节 → HEX 显示 */
export function bytesToHex(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] & 0xff).toString(16).toUpperCase().padStart(2, '0') + ' ';
  return s;
}

/** 把要发送的文本编码为字节（UTF-8）并附加行尾 */
export function encodeUartText(text: string, eol: 'none' | 'lf' | 'crlf' | 'cr'): number[] {
  const tail = eol === 'lf' ? '\n' : eol === 'crlf' ? '\r\n' : eol === 'cr' ? '\r' : '';
  return Array.from(new TextEncoder().encode(text + tail));
}

/** 解析 HEX 发送框：「48 65 6c」「0x48,0x65」 */
export function parseHexBytes(text: string): number[] | null {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((p) => p.replace(/^0x/i, ''));
  if (!parts.length) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,2}$/i.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}

/** 终端文本：处理 \r\n、退格、去掉其他控制字符；结果最多保留 maxChars 个字符 */
export function appendTerminalText(prev: string, chunk: string, maxChars = 200_000): string {
  let s = prev;
  for (const ch of chunk) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '\r') continue;
    if (c === 8 || c === 127) {
      if (s.length && !s.endsWith('\n')) s = s.slice(0, -1);
      continue;
    }
    if (c < 32 && ch !== '\n' && ch !== '\t') continue;
    s += ch;
  }
  if (s.length > maxChars) {
    const cut = s.indexOf('\n', s.length - maxChars);
    s = s.slice(cut >= 0 ? cut + 1 : s.length - maxChars);
  }
  return s;
}
