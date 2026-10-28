// 已添加信号（trace）→ 显示行（row）的纯逻辑：行布局、初始信号、重排、名称解析。

import type { Radix } from './format';
import type { RowMode } from './render';
import type { VcdData, VcdScope, VcdVar, Wave } from './vcd';
import { bitWave } from './waves';

export interface Trace {
  uid: number;
  path: string;
  radix: Radix;
  analog: boolean;
  expanded: boolean;
}

export interface Row {
  key: string;
  trace: Trace;
  v: VcdVar;
  /** 位展开子行：位下标（0 = MSB）；主行为 null */
  bit: number | null;
  wave: Wave;
  mode: RowMode;
  /** 显示名，如 "q[7:0]"、"q[3]" */
  label: string;
  top: number;
  height: number;
}

export const ROW_H = 26;
export const ANALOG_H = 72;

export function buildPathIndex(data: VcdData): Map<string, number> {
  const m = new Map<string, number>();
  data.vars.forEach((v, i) => m.set(v.path, i));
  return m;
}

/** 解析用户给的信号名：精确匹配，其次去掉位范围、忽略大小写 */
export function resolvePath(pathIndex: Map<string, number>, data: VcdData, name: string): number | undefined {
  const exact = pathIndex.get(name);
  if (exact !== undefined) return exact;
  const stripped = name.replace(/\s*\[[^\]]*\]$/, '');
  const s = pathIndex.get(stripped);
  if (s !== undefined) return s;
  const lower = stripped.toLowerCase();
  const i = data.vars.findIndex((v) => v.path.toLowerCase() === lower);
  return i >= 0 ? i : undefined;
}

/** 第一个含信号的作用域里的直接信号（最多 limit 个） */
export function autoSignals(data: VcdData, limit = 24): number[] {
  const visit = (s: VcdScope): number[] | null => {
    if (s.vars.length) return s.vars.slice(0, limit);
    for (const c of s.scopes) {
      const r = visit(c);
      if (r) return r;
    }
    return null;
  };
  for (const s of data.root.scopes) {
    const r = visit(s);
    if (r) return r;
  }
  return data.root.vars.slice(0, limit);
}

/** 第 k 位（0 = MSB）的 Verilog 下标 */
export function bitIndex(v: VcdVar, k: number): number {
  if (v.msb !== null && v.lsb !== null && v.msb !== v.lsb) return v.msb >= v.lsb ? v.msb - k : v.msb + k;
  if (v.msb !== null && v.lsb !== null && v.width === 1) return v.msb;
  return v.width - 1 - k;
}

export function defaultRadix(wave: Wave, fallback: Radix): Radix {
  return wave.kind === 'vec' ? fallback : 'hex';
}

export function modeFor(wave: Wave, analog: boolean): RowMode {
  switch (wave.kind) {
    case 'bit':
      return 'bit';
    case 'event':
      return 'event';
    case 'vec':
    case 'real':
      return analog ? 'analog' : 'bus';
    default:
      return 'bus';
  }
}

export function canAnalog(wave: Wave): boolean {
  return wave.kind === 'vec' || wave.kind === 'real';
}

export function canExpand(wave: Wave): boolean {
  return wave.kind === 'vec' && wave.width > 1;
}

/** 构建显示行；同名信号加上所属作用域前缀 */
export function buildRows(data: VcdData, pathIndex: Map<string, number>, traces: Trace[]): { rows: Row[]; total: number } {
  const rows: Row[] = [];
  const nameCount = new Map<string, number>();
  const resolved: { t: Trace; v: VcdVar }[] = [];
  for (const t of traces) {
    const vi = pathIndex.get(t.path);
    if (vi === undefined) continue;
    const v = data.vars[vi];
    resolved.push({ t, v });
    const nm = v.name + v.range;
    nameCount.set(nm, (nameCount.get(nm) ?? 0) + 1);
  }
  let y = 0;
  for (const { t, v } of resolved) {
    const wave = data.waves[v.wave];
    const mode = modeFor(wave, t.analog);
    let label = v.name + v.range;
    if ((nameCount.get(label) ?? 0) > 1 && v.scope) {
      const parent = v.scope.slice(v.scope.lastIndexOf('.') + 1);
      label = `${parent}.${label}`;
    }
    const height = mode === 'analog' ? ANALOG_H : ROW_H;
    rows.push({ key: `t${t.uid}`, trace: t, v, bit: null, wave, mode, label, top: y, height });
    y += height;
    if (t.expanded && canExpand(wave)) {
      for (let k = 0; k < wave.width; k++) {
        rows.push({
          key: `t${t.uid}.${k}`,
          trace: t,
          v,
          bit: k,
          wave: bitWave(wave, k),
          mode: 'bit',
          label: `${v.name}[${bitIndex(v, k)}]`,
          top: y,
          height: ROW_H,
        });
        y += ROW_H;
      }
    }
  }
  return { rows, total: y };
}

/** y（内容坐标）处的行下标；不在任何行内返回 -1 */
export function rowIndexAt(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = rows[mid];
    if (y < r.top) hi = mid - 1;
    else if (y >= r.top + r.height) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** 可见行范围 [first, last]（含），带 overscan */
export function visibleRange(rows: Row[], scrollTop: number, viewH: number, overscan = 4): [number, number] {
  if (rows.length === 0) return [0, -1];
  let first = rowIndexAt(rows, Math.max(0, scrollTop));
  if (first < 0) first = scrollTop <= 0 ? 0 : rows.length - 1;
  let last = rowIndexAt(rows, scrollTop + viewH);
  if (last < 0) last = rows.length - 1;
  return [Math.max(0, first - overscan), Math.min(rows.length - 1, last + overscan)];
}

/**
 * 把 uids 指定的 trace 移动到原数组位置 toIndex 之前（保持它们的相对顺序）。
 * toIndex 可为 traces.length（移到末尾）。
 */
export function moveTraces(traces: Trace[], uids: Set<number>, toIndex: number): Trace[] {
  const moving = traces.filter((t) => uids.has(t.uid));
  if (moving.length === 0) return traces;
  let insert = 0;
  for (let i = 0; i < Math.min(toIndex, traces.length); i++) if (!uids.has(traces[i].uid)) insert++;
  const rest = traces.filter((t) => !uids.has(t.uid));
  return [...rest.slice(0, insert), ...moving, ...rest.slice(insert)];
}

/** 由行下标得到"插入到哪个 trace 之前"：y 落在行上半部插在该 trace 前，下半部插在后 */
export function insertionTraceIndex(rows: Row[], traces: Trace[], y: number): number {
  if (rows.length === 0) return traces.length;
  const ri = rowIndexAt(rows, y);
  if (ri < 0) return y < 0 ? 0 : traces.length;
  const r = rows[ri];
  const ti = traces.findIndex((t) => t.uid === r.trace.uid);
  if (ti < 0) return traces.length;
  if (r.bit !== null) return ti + 1;
  return y < r.top + r.height / 2 ? ti : ti + 1;
}
