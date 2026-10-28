// 数值格式化：进制转换（含 x/z 处理）、实数、时间。

export type Radix = 'bin' | 'oct' | 'hex' | 'dec' | 'sdec' | 'ascii';

export const RADIXES: { id: Radix; label: string; short: string }[] = [
  { id: 'bin', label: '二进制', short: 'Bin' },
  { id: 'oct', label: '八进制', short: 'Oct' },
  { id: 'hex', label: '十六进制', short: 'Hex' },
  { id: 'dec', label: '无符号十进制', short: 'Dec' },
  { id: 'sdec', label: '有符号十进制', short: 'Signed' },
  { id: 'ascii', label: 'ASCII', short: 'ASCII' },
];

export function isRadix(v: unknown): v is Radix {
  return typeof v === 'string' && RADIXES.some((r) => r.id === v);
}

const HAS_XZ = /[xz]/;
const HAS_X = /x/;
const ALL_Z = /^z+$/;
const ALL_X = /^x+$/;

/** 位串状态：ok = 全为 0/1；x = 含 x（或 x/z 混合）；z = 含 z 不含 x */
export function bitsState(bits: string): 'ok' | 'x' | 'z' {
  if (!HAS_XZ.test(bits)) return 'ok';
  return HAS_X.test(bits) ? 'x' : 'z';
}

function groupFormat(bits: string, groupBits: number): string {
  const digits = Math.ceil(bits.length / groupBits);
  if (!HAS_XZ.test(bits)) {
    const s =
      bits.length <= 52 ? Number.parseInt(bits, 2).toString(groupBits === 4 ? 16 : 8) : BigInt(`0b${bits}`).toString(groupBits === 4 ? 16 : 8);
    return s.toUpperCase().padStart(digits, '0');
  }
  let out = '';
  for (let g = digits - 1; g >= 0; g--) {
    const hi = bits.length - g * groupBits;
    const lo = Math.max(0, hi - groupBits);
    const chunk = bits.slice(lo, hi);
    if (ALL_X.test(chunk)) out += 'x';
    else if (ALL_Z.test(chunk)) out += 'z';
    else if (HAS_X.test(chunk)) out += 'X';
    else if (chunk.includes('z')) out += 'Z';
    else out += Number.parseInt(chunk, 2).toString(groupBits === 4 ? 16 : 8).toUpperCase();
  }
  return out;
}

function unknownValue(bits: string): string {
  return ALL_Z.test(bits) ? 'z' : 'x';
}

function toUnsignedString(bits: string): string {
  if (bits.length <= 53) return String(Number.parseInt(bits, 2));
  return BigInt(`0b${bits}`).toString();
}

function toSignedString(bits: string): string {
  if (bits[0] !== '1') return toUnsignedString(bits);
  if (bits.length <= 52) return String(Number.parseInt(bits, 2) - 2 ** bits.length);
  return (BigInt(`0b${bits}`) - (1n << BigInt(bits.length))).toString();
}

function toAscii(bits: string): string {
  const bytes = Math.ceil(bits.length / 8);
  let out = '';
  let leading = true;
  for (let i = bytes - 1; i >= 0; i--) {
    const hi = bits.length - i * 8;
    const lo = Math.max(0, hi - 8);
    const chunk = bits.slice(lo, hi);
    if (HAS_XZ.test(chunk)) {
      leading = false;
      out += '?';
      continue;
    }
    const code = Number.parseInt(chunk, 2);
    if (code === 0 && leading) continue; // Verilog 字符串左侧补零
    leading = false;
    out += code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
  }
  return out;
}

/** 位串（MSB 在前）按进制格式化 */
export function formatBits(bits: string, radix: Radix): string {
  if (bits.length === 0) return '';
  if (bits.length === 1 && radix !== 'ascii') return bits;
  switch (radix) {
    case 'bin':
      return bits;
    case 'oct':
      return groupFormat(bits, 3);
    case 'hex':
      return groupFormat(bits, 4);
    case 'dec':
      return HAS_XZ.test(bits) ? unknownValue(bits) : toUnsignedString(bits);
    case 'sdec':
      return HAS_XZ.test(bits) ? unknownValue(bits) : toSignedString(bits);
    case 'ascii':
      return toAscii(bits);
  }
}

/** 位串 → 数值（模拟波形用）；含 x/z 返回 NaN */
export function bitsToNumber(bits: string, signed: boolean): number {
  if (bits.length === 0 || HAS_XZ.test(bits)) return Number.NaN;
  if (bits.length <= 52) {
    const u = Number.parseInt(bits, 2);
    return signed && bits[0] === '1' && bits.length > 1 ? u - 2 ** bits.length : u;
  }
  let b = BigInt(`0b${bits}`);
  if (signed && bits[0] === '1') b -= 1n << BigInt(bits.length);
  return Number(b);
}

/** 实数显示：尽量短且不丢有效位 */
export function formatReal(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e15) return String(v);
  if (a >= 1e-4 && a < 1e15) {
    return String(Number.parseFloat(v.toPrecision(10)));
  }
  return v.toExponential(6).replace(/\.?0+e/, 'e');
}

// ---------------------------------------------------------------------------
// 时间

export const UNIT_FS: Record<string, number> = { s: 1e15, ms: 1e12, us: 1e9, ns: 1e6, ps: 1e3, fs: 1 };
const UNITS_DESC = ['s', 'ms', 'us', 'ns', 'ps', 'fs'] as const;
export type DisplayUnit = (typeof UNITS_DESC)[number];

const UNIT_LABEL: Record<DisplayUnit, string> = { s: 's', ms: 'ms', us: 'μs', ns: 'ns', ps: 'ps', fs: 'fs' };

export function unitLabel(u: DisplayUnit): string {
  return UNIT_LABEL[u];
}

/** 选择显示单位：不大于 fs 值的最大单位（0 时用 fallback） */
export function pickUnit(fs: number, fallback: DisplayUnit = 'ns'): DisplayUnit {
  const a = Math.abs(fs);
  if (a === 0 || !Number.isFinite(a)) return fallback;
  for (const u of UNITS_DESC) if (a >= UNIT_FS[u] * 0.9999999) return u;
  return 'fs';
}

/** 去掉多余的小数 0 */
export function trimNumber(v: number, maxDecimals = 6): string {
  if (!Number.isFinite(v)) return String(v);
  let s = v.toFixed(maxDecimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/**
 * 时间（以 fs 计）格式化为 "125 ns"。
 * unit 缺省时自动选择最合适的单位。
 */
export function formatFs(fs: number, unit?: DisplayUnit, maxDecimals = 6): string {
  const u = unit ?? pickUnit(fs, 'ns');
  return `${trimNumber(fs / UNIT_FS[u], maxDecimals)} ${UNIT_LABEL[u]}`;
}
