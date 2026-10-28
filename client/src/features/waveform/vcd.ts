// VCD (IEEE 1364 Value Change Dump) 解析器：纯 TS，无 DOM 依赖，可在 Web Worker 与主线程运行。
//
// 设计要点：
// - 手写扫描器（charCodeAt），不做整行 split，50+ MB 文本也能线性扫描；
// - 同一个 id code 被多个 $var 引用（别名）时共享一条波形（Wave）；
// - 每条波形的跳变用紧凑数组保存：时间 Float64Array；标量 Uint8Array（0/1/x/z）；向量为左扩展后的位串；实数 Float64Array；
// - 截断的文件（仿真超时被杀）尽量解析：丢弃最后一个可能不完整的 token，并标记 truncated。

export type TimeUnit = 's' | 'ms' | 'us' | 'ns' | 'ps' | 'fs';

export interface Timescale {
  /** 1 / 10 / 100 */
  magnitude: number;
  unit: TimeUnit;
}

/** 波形类别：bit = 1 位标量；vec = 多位向量；real = 实数；event = 事件；string = 字符串（扩展） */
export type WaveKind = 'bit' | 'vec' | 'real' | 'event' | 'string';

/** 标量值编码 */
export const BIT_0 = 0;
export const BIT_1 = 1;
export const BIT_X = 2;
export const BIT_Z = 3;

export interface Wave {
  kind: WaveKind;
  width: number;
  /** 跳变时刻（timescale 单位），严格递增 */
  times: Float64Array;
  /** kind = bit / event：每个跳变的值（BIT_0..BIT_Z） */
  bits?: Uint8Array;
  /** kind = vec：位串（MSB 在前，长度 = width，字符 0/1/x/z）；kind = string：原始字符串 */
  vecs?: string[];
  /** kind = real */
  reals?: Float64Array;
}

export interface VcdVar {
  /** 变量名（不含位选择），如 "data" */
  name: string;
  /** 位选择/范围原文，如 "[7:0]"、"[3]"；没有则为 "" */
  range: string;
  /** $var 类型：wire / reg / logic / integer / real / parameter / event / ... */
  type: string;
  width: number;
  /** 范围的 MSB/LSB（解析 [msb:lsb] 或 [i]）；没有范围时为 null */
  msb: number | null;
  lsb: number | null;
  /** 层次全名（唯一），如 "tb.dut.data"；同作用域重名时追加范围 */
  path: string;
  /** 所属作用域路径（顶层变量为 ""） */
  scope: string;
  /** 波形下标（data.waves） */
  wave: number;
  code: string;
}

export interface VcdScope {
  name: string;
  /** module / task / function / begin / fork / ... ；虚拟根为 "root" */
  type: string;
  /** 层次路径（根为 ""） */
  path: string;
  scopes: VcdScope[];
  /** data.vars 的下标 */
  vars: number[];
}

export interface VcdData {
  timescale: Timescale;
  date: string;
  version: string;
  /** 虚拟根作用域：children 为顶层 $scope */
  root: VcdScope;
  vars: VcdVar[];
  waves: Wave[];
  /** 第一个时间戳（通常为 0） */
  startTime: number;
  /** 最后一个时间戳 */
  endTime: number;
  /** 总跳变数（所有波形之和） */
  changeCount: number;
  /** 文件看起来不完整（缺少 $enddefinitions、末尾残缺等） */
  truncated: boolean;
  warnings: string[];
}

export type ProgressFn = (fraction: number) => void;

const UNIT_SET = new Set<TimeUnit>(['s', 'ms', 'us', 'ns', 'ps', 'fs']);

/** 解析 "$timescale 1 ns $end" 的内容；无法识别时返回 null */
export function parseTimescale(text: string): Timescale | null {
  const m = /^\s*(1|10|100)(?:\.0*)?\s*(s|ms|us|µs|μs|ns|ps|fs)\s*$/i.exec(text);
  if (!m) return null;
  let unit = m[2].toLowerCase();
  if (unit === 'µs' || unit === 'μs') unit = 'us';
  if (!UNIT_SET.has(unit as TimeUnit)) return null;
  return { magnitude: Number(m[1]), unit: unit as TimeUnit };
}

// ---------------------------------------------------------------------------
// 可增长的紧凑数组
class GrowF64 {
  a: Float64Array;
  n = 0;
  constructor(cap = 8) {
    this.a = new Float64Array(cap);
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Float64Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  finish(): Float64Array {
    return this.n === this.a.length ? this.a : this.a.slice(0, this.n);
  }
}

class GrowU8 {
  a: Uint8Array;
  n = 0;
  constructor(cap = 8) {
    this.a = new Uint8Array(cap);
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Uint8Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  finish(): Uint8Array {
    return this.n === this.a.length ? this.a : this.a.slice(0, this.n);
  }
}

interface WaveBuilder {
  kind: WaveKind;
  width: number;
  times: GrowF64;
  bits: GrowU8 | null;
  vecs: string[] | null;
  reals: GrowF64 | null;
}

function newBuilder(kind: WaveKind, width: number): WaveBuilder {
  return {
    kind,
    width,
    times: new GrowF64(),
    bits: kind === 'bit' || kind === 'event' ? new GrowU8() : null,
    vecs: kind === 'vec' || kind === 'string' ? [] : null,
    reals: kind === 'real' ? new GrowF64() : null,
  };
}

// ---------------------------------------------------------------------------
// 值规范化

/** 单字符状态 → BIT_*；支持 VHDL 九值（U/W/- → x，L → 0，H → 1） */
export function bitCode(ch: string): number {
  switch (ch) {
    case '0':
    case 'l':
    case 'L':
      return BIT_0;
    case '1':
    case 'h':
    case 'H':
      return BIT_1;
    case 'z':
    case 'Z':
      return BIT_Z;
    default:
      return BIT_X;
  }
}

const NON_CANON = /[^01xz]/;

function canonBits(v: string): string {
  if (!NON_CANON.test(v)) return v;
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    switch (c) {
      case '0':
      case '1':
      case 'x':
      case 'z':
        out += c;
        break;
      case 'Z':
        out += 'z';
        break;
      case 'l':
      case 'L':
        out += '0';
        break;
      case 'h':
      case 'H':
        out += '1';
        break;
      default:
        out += 'x';
    }
  }
  return out;
}

/**
 * 把向量值扩展/截断到 width 位（VCD 规则：最左位为 x/z 时用 x/z 扩展，0/1 用 0 扩展）。
 * 输入可含大写或九值字符。
 */
export function extendBits(raw: string, width: number): string {
  let v = canonBits(raw);
  if (v.length === 0) v = 'x';
  if (width <= 0) return v;
  if (v.length < width) {
    const c = v[0];
    const fill = c === 'x' || c === 'z' ? c : '0';
    return fill.repeat(width - v.length) + v;
  }
  if (v.length > width) return v.slice(v.length - width);
  return v;
}

const BIT_CHARS = ['0', '1', 'x', 'z'];

// ---------------------------------------------------------------------------

function parseRange(range: string): { msb: number | null; lsb: number | null } {
  const m = /^\[\s*(-?\d+)\s*(?::\s*(-?\d+)\s*)?\]$/.exec(range);
  if (!m) return { msb: null, lsb: null };
  const msb = Number(m[1]);
  const lsb = m[2] !== undefined ? Number(m[2]) : msb;
  return { msb, lsb };
}

function kindFor(type: string, width: number): WaveKind {
  const t = type.toLowerCase();
  if (t === 'real' || t === 'realtime' || t === 'shortreal' || t === 'real_parameter') return 'real';
  if (t === 'event') return 'event';
  if (t === 'string') return 'string';
  return width === 1 ? 'bit' : 'vec';
}

/**
 * 解析 VCD 文本。
 * @param onProgress 进度回调（0..1），约每 1 MB 调用一次
 */
export function parseVcd(text: string, onProgress?: ProgressFn): VcdData {
  const n = text.length;
  let p = 0;
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (key: string, msg: string) => {
    if (warnOnce.has(key)) return;
    warnOnce.add(key);
    if (warnings.length < 50) warnings.push(msg);
  };

  // 末尾不是空白 → 最后一个 token 可能被截断
  let end = n;
  let truncated = false;
  if (n > 0 && text.charCodeAt(n - 1) > 32) {
    let q = n;
    while (q > 0 && text.charCodeAt(q - 1) > 32) q--;
    const lastTok = text.slice(q, n);
    // "$end" 收尾或完整的 "#时间" 可以接受；其它视为可能残缺
    if (lastTok !== '$end' && !/^#\d+$/.test(lastTok)) {
      end = q;
      truncated = true;
    }
  }

  const next = (): string | null => {
    while (p < end && text.charCodeAt(p) <= 32) p++;
    if (p >= end) return null;
    const s = p;
    while (p < end && text.charCodeAt(p) > 32) p++;
    return text.slice(s, p);
  };

  /** 读到 $end 为止，返回中间的 token；遇到文件结束返回 null */
  const untilEnd = (): string[] | null => {
    const toks: string[] = [];
    for (;;) {
      const t = next();
      if (t === null) return null;
      if (t === '$end') return toks;
      toks.push(t);
    }
  };

  /** $comment / $date / $version 内容：保留原始文本 */
  const rawUntilEnd = (): string | null => {
    const idx = text.indexOf('$end', p);
    if (idx < 0 || idx >= end) {
      p = end;
      return null;
    }
    const s = text.slice(p, idx).trim();
    p = idx + 4;
    return s;
  };

  let timescale: Timescale = { magnitude: 1, unit: 'ns' };
  let timescaleSeen = false;
  let date = '';
  let version = '';
  const root: VcdScope = { name: '', type: 'root', path: '', scopes: [], vars: [] };
  const stack: VcdScope[] = [root];
  const vars: VcdVar[] = [];
  const builders: WaveBuilder[] = [];
  const codeMap = new Map<string, number>();
  const pathsInScope = new Map<VcdScope, Set<string>>();
  let headerDone = false;

  // ---- 头部 ----
  header: for (;;) {
    const t = next();
    if (t === null) break;
    switch (t) {
      case '$timescale': {
        const toks = untilEnd();
        if (toks === null) break header;
        const ts = parseTimescale(toks.join(' '));
        if (ts) {
          timescale = ts;
          timescaleSeen = true;
        } else warn('ts', `无法识别的 $timescale：${toks.join(' ')}，按 1 ns 处理`);
        break;
      }
      case '$date': {
        const s = rawUntilEnd();
        if (s === null) break header;
        date = s;
        break;
      }
      case '$version': {
        const s = rawUntilEnd();
        if (s === null) break header;
        version = s;
        break;
      }
      case '$comment': {
        if (rawUntilEnd() === null) break header;
        break;
      }
      case '$scope': {
        const toks = untilEnd();
        if (toks === null) break header;
        const parent = stack[stack.length - 1];
        const type = toks.length >= 2 ? toks[0] : 'module';
        const name = toks.length >= 2 ? toks.slice(1).join(' ') : (toks[0] ?? '?');
        let scope = parent.scopes.find((s) => s.name === name);
        if (!scope) {
          scope = { name, type, path: parent.path ? `${parent.path}.${name}` : name, scopes: [], vars: [] };
          parent.scopes.push(scope);
        }
        stack.push(scope);
        break;
      }
      case '$upscope': {
        if (untilEnd() === null) break header;
        if (stack.length > 1) stack.pop();
        else warn('upscope', '多余的 $upscope');
        break;
      }
      case '$var': {
        const toks = untilEnd();
        if (toks === null) break header;
        if (toks.length < 4) {
          warn('var', `无效的 $var 声明：${toks.join(' ')}`);
          break;
        }
        const type = toks[0];
        let width = Number.parseInt(toks[1], 10);
        if (!Number.isFinite(width) || width < 1) width = 1;
        const code = toks[2];
        let ref = toks.slice(3).join(' ');
        let range = '';
        const rm = /^(.*?)\s*(\[[^\]]*\](?:\s*\[[^\]]*\])*)$/.exec(ref);
        if (rm && rm[1].length > 0) {
          ref = rm[1];
          range = rm[2].replace(/\s+/g, '');
        }
        const { msb, lsb } = parseRange(range);
        const scope = stack[stack.length - 1];
        let set = pathsInScope.get(scope);
        if (!set) {
          set = new Set();
          pathsInScope.set(scope, set);
        }
        const isBitSelect = range !== '' && msb !== null && msb === lsb && !range.includes(':');
        let leaf = isBitSelect ? `${ref}${range}` : ref;
        if (set.has(leaf)) leaf = `${ref}${range}`;
        if (set.has(leaf)) {
          let k = 2;
          while (set.has(`${leaf}#${k}`)) k++;
          leaf = `${leaf}#${k}`;
        }
        set.add(leaf);
        let wave = codeMap.get(code);
        const realType = type.toLowerCase();
        if (wave === undefined) {
          wave = builders.length;
          builders.push(newBuilder(kindFor(type, width), width));
          codeMap.set(code, wave);
        } else if (builders[wave].kind === 'bit' && width > 1 && realType !== 'event') {
          // 别名宽度更大：升级为向量（极少见）
          builders[wave] = newBuilder('vec', width);
        }
        const idx = vars.length;
        vars.push({
          name: ref,
          range,
          type,
          width,
          msb,
          lsb,
          path: scope.path ? `${scope.path}.${leaf}` : leaf,
          scope: scope.path,
          wave,
          code,
        });
        scope.vars.push(idx);
        break;
      }
      case '$enddefinitions': {
        if (untilEnd() === null) break header;
        headerDone = true;
        break header;
      }
      default: {
        if (t.startsWith('$')) {
          // 未知头部关键字：跳到 $end
          if (rawUntilEnd() === null) break header;
          warn(`kw${t}`, `忽略未知关键字 ${t}`);
        } else if (t[0] === '#' || t[0] === '0' || t[0] === '1' || t[0] === 'b' || t[0] === 'r') {
          // 缺少 $enddefinitions 直接进入数据区：回退并开始解析数据
          p -= t.length;
          warn('noend', '缺少 $enddefinitions');
          headerDone = true;
          break header;
        } else {
          warn('junk', `头部中有无法识别的内容：${t.slice(0, 40)}`);
        }
      }
    }
  }
  if (!headerDone) {
    truncated = true;
    warn('hdr', 'VCD 头部不完整（文件可能被截断）');
  }
  if (!timescaleSeen) warn('nots', '缺少 $timescale，按 1 ns 处理');
  if (stack.length > 1 && headerDone) warn('scope', '$scope 与 $upscope 不匹配');

  // ---- 数据区 ----
  let cur = 0;
  let startTime = Number.NaN;
  let endTime = 0;
  let timeSeen = false;
  let changeCount = 0;
  /** 时间戳回退后，直到下一个有效时间戳之前的值变化都丢弃 */
  let skipping = false;
  const progressStep = 1 << 20;
  let nextProgress = p + progressStep;

  const unknownCode = (code: string) => warn(`code${code}`, `未声明的信号代码 ${code}`);

  /** 在 builder 末尾追加或覆盖同一时刻的值，返回写入位置；相同值则不追加 */
  const pushTime = (b: WaveBuilder): number => {
    const tn = b.times.n;
    if (tn > 0 && b.times.a[tn - 1] === cur) return tn - 1; // 同一时刻多次赋值：覆盖
    b.times.push(cur);
    return tn;
  };

  const setBit = (b: WaveBuilder, code: number) => {
    const bits = b.bits!;
    if (b.kind === 'event') {
      // 事件：每次触发都记录
      const tn = b.times.n;
      if (tn > 0 && b.times.a[tn - 1] === cur) return;
      b.times.push(cur);
      bits.push(code);
      changeCount++;
      return;
    }
    const tn = b.times.n;
    if (tn > 0) {
      if (b.times.a[tn - 1] === cur) {
        // 覆盖同一时刻
        bits.a[tn - 1] = code;
        if (tn > 1 && bits.a[tn - 2] === code) {
          b.times.n--;
          bits.n--;
          changeCount--;
        }
        return;
      }
      if (bits.a[tn - 1] === code) return;
    }
    b.times.push(cur);
    bits.push(code);
    changeCount++;
  };

  const setVec = (b: WaveBuilder, v: string) => {
    const vecs = b.vecs!;
    const tn = b.times.n;
    if (tn > 0) {
      if (b.times.a[tn - 1] === cur) {
        vecs[tn - 1] = v;
        if (tn > 1 && vecs[tn - 2] === v) {
          b.times.n--;
          vecs.pop();
          changeCount--;
        }
        return;
      }
      if (vecs[tn - 1] === v) return;
    }
    pushTime(b);
    vecs.push(v);
    changeCount++;
  };

  const setReal = (b: WaveBuilder, v: number) => {
    const reals = b.reals!;
    const tn = b.times.n;
    if (tn > 0) {
      if (b.times.a[tn - 1] === cur) {
        reals.a[tn - 1] = v;
        return;
      }
      const prev = reals.a[tn - 1];
      if (prev === v || (Number.isNaN(prev) && Number.isNaN(v))) return;
    }
    pushTime(b);
    reals.push(v);
    changeCount++;
  };

  const applyScalar = (code: number, id: string) => {
    const w = codeMap.get(id);
    if (w === undefined) return unknownCode(id);
    const b = builders[w];
    switch (b.kind) {
      case 'bit':
      case 'event':
        setBit(b, code);
        break;
      case 'vec':
        setVec(b, extendBits(BIT_CHARS[code], b.width));
        break;
      case 'real':
        setReal(b, code === BIT_0 ? 0 : code === BIT_1 ? 1 : Number.NaN);
        break;
      case 'string':
        setVec(b, BIT_CHARS[code]);
        break;
    }
  };

  const applyVector = (raw: string, id: string) => {
    const w = codeMap.get(id);
    if (w === undefined) return unknownCode(id);
    const b = builders[w];
    switch (b.kind) {
      case 'vec':
        setVec(b, extendBits(raw, b.width));
        break;
      case 'bit':
      case 'event':
        setBit(b, bitCode(raw.length ? raw[raw.length - 1] : 'x'));
        break;
      case 'real': {
        const v = canonBits(raw);
        setReal(b, /^[01]+$/.test(v) && v.length <= 53 ? Number.parseInt(v, 2) : Number.NaN);
        break;
      }
      case 'string':
        setVec(b, raw);
        break;
    }
  };

  const applyReal = (raw: string, id: string) => {
    const w = codeMap.get(id);
    if (w === undefined) return unknownCode(id);
    const b = builders[w];
    const v = Number.parseFloat(raw);
    const num = Number.isNaN(v) ? (/^[+-]?inf/i.test(raw) ? (raw[0] === '-' ? -Infinity : Infinity) : Number.NaN) : v;
    switch (b.kind) {
      case 'real':
        setReal(b, num);
        break;
      case 'vec':
        setVec(b, Number.isFinite(num) && num >= 0 ? extendBits(Math.round(num).toString(2), b.width) : 'x'.repeat(b.width));
        break;
      case 'bit':
      case 'event':
        setBit(b, Number.isNaN(num) ? BIT_X : num !== 0 ? BIT_1 : BIT_0);
        break;
      case 'string':
        setVec(b, raw);
        break;
    }
  };

  if (headerDone) {
    for (;;) {
      if (p >= nextProgress) {
        nextProgress = p + progressStep;
        onProgress?.(p / n);
      }
      const t = next();
      if (t === null) break;
      const c = t.charCodeAt(0);
      if (skipping && c !== 35 && c !== 36) {
        // 仍需消耗向量/实数值后面的 id token
        if (c === 98 || c === 66 || c === 114 || c === 82 || c === 115 || c === 83) next();
        else if (t.length === 1) next();
        continue;
      }
      switch (c) {
        case 35: {
          // '#'
          const v = Number(t.slice(1));
          if (!Number.isFinite(v)) {
            warn('time', `无效的时间戳 ${t.slice(0, 40)}`);
            break;
          }
          if (timeSeen && v < cur) {
            warn('back', `时间戳回退（${t}），已忽略该时刻的值变化`);
            skipping = true;
            break;
          }
          skipping = false;
          cur = v;
          if (!timeSeen) {
            startTime = v;
            timeSeen = true;
          }
          endTime = v;
          break;
        }
        case 48: // 0
        case 49: // 1
        case 120: // x
        case 88: // X
        case 122: // z
        case 90: // Z
        case 117: // u
        case 85: // U
        case 119: // w
        case 87: // W
        case 108: // l
        case 76: // L
        case 104: // h
        case 72: // H
        case 45: {
          // '-'
          let id = t.slice(1);
          if (id.length === 0) {
            const nt = next();
            if (nt === null) break;
            id = nt;
          }
          applyScalar(bitCode(t[0]), id);
          break;
        }
        case 98: // b
        case 66: {
          // B
          const id = next();
          if (id === null) break;
          applyVector(t.slice(1), id);
          break;
        }
        case 114: // r
        case 82: {
          // R
          const id = next();
          if (id === null) break;
          applyReal(t.slice(1), id);
          break;
        }
        case 115: // s
        case 83: {
          // S（字符串扩展）
          const id = next();
          if (id === null) break;
          const w = codeMap.get(id);
          if (w === undefined) {
            unknownCode(id);
            break;
          }
          const b = builders[w];
          if (b.kind === 'string' || b.kind === 'vec') setVec(b, b.kind === 'vec' ? 'x'.repeat(b.width) : t.slice(1));
          break;
        }
        case 36: {
          // '$'
          if (t === '$comment') {
            rawUntilEnd();
          } else if (t === '$dumpvars' || t === '$dumpall' || t === '$dumpon' || t === '$dumpoff' || t === '$end') {
            // 这些段落中的值变化按普通变化处理（$dumpoff 段里通常就是显式的 x）
          } else if (t === '$enddefinitions' || t === '$scope' || t === '$upscope' || t === '$var' || t === '$timescale') {
            warn(`late${t}`, `数据区出现 ${t}，已忽略`);
            untilEnd();
          } else {
            warn(`kw${t}`, `忽略未知关键字 ${t}`);
          }
          break;
        }
        default:
          warn('junk2', `无法识别的值变化：${t.slice(0, 40)}`);
      }
    }
  }
  onProgress?.(1);

  if (!timeSeen) {
    startTime = 0;
    endTime = 0;
  }

  const waves: Wave[] = builders.map((b) => {
    const w: Wave = { kind: b.kind, width: b.width, times: b.times.finish() };
    if (b.bits) w.bits = b.bits.finish();
    if (b.vecs) w.vecs = b.vecs;
    if (b.reals) w.reals = b.reals.finish();
    return w;
  });

  if (truncated && headerDone) warn('trunc', 'VCD 文件末尾不完整（仿真可能被中断），已解析到最后一个完整记录');

  return { timescale, date, version, root, vars, waves, startTime, endTime, changeCount, truncated, warnings };
}

/** Worker 传回结果时可转移的 ArrayBuffer 列表 */
export function transferables(data: VcdData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const seen = new Set<ArrayBufferLike>();
  const add = (a: ArrayBufferView | undefined) => {
    if (!a) return;
    const buf = a.buffer;
    if (buf instanceof ArrayBuffer && !seen.has(buf)) {
      seen.add(buf);
      out.push(buf);
    }
  };
  for (const w of data.waves) {
    add(w.times);
    add(w.bits);
    add(w.reals);
  }
  return out;
}
