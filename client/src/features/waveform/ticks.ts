// 时间标尺刻度计算。时间轴内部单位 = VCD timescale 单位；显示时换算成 fs 再选单位。

import { formatFs, pickUnit, UNIT_FS, unitLabel, trimNumber, type DisplayUnit } from './format';
import type { Timescale } from './vcd';

/** 一个 timescale 单位等于多少 fs */
export function fsPerUnit(ts: Timescale): number {
  return ts.magnitude * UNIT_FS[ts.unit];
}

/** 不小于 raw 的 {1,2,5}×10^k */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const m = raw / base;
  // 浮点误差容忍
  const mant = m <= 1.000001 ? 1 : m <= 2.000001 ? 2 : m <= 5.000001 ? 5 : 10;
  return mant * base;
}

export interface Ticks {
  /** 主刻度间隔（timescale 单位） */
  step: number;
  /** 次刻度间隔（timescale 单位） */
  minor: number;
  /** 标签显示单位 */
  unit: DisplayUnit;
  /** 标签小数位 */
  decimals: number;
  /** 可见范围内的主刻度时间 */
  majors: number[];
}

/**
 * 计算刻度。
 * @param start 可见起点（timescale 单位）
 * @param end 可见终点
 * @param widthPx 像素宽度
 * @param fsUnit fsPerUnit(timescale)
 * @param minPx 主刻度最小像素间距
 */
export function computeTicks(start: number, end: number, widthPx: number, fsUnit: number, minPx = 90): Ticks {
  const span = Math.max(end - start, 1e-12);
  const w = Math.max(widthPx, 1);
  const rawFs = (span / w) * minPx * fsUnit;
  const stepFs = niceStep(rawFs);
  const step = stepFs / fsUnit;
  const mant = Math.round(stepFs / 10 ** Math.floor(Math.log10(stepFs) + 1e-9));
  const minor = mant === 2 ? step / 4 : step / 5;
  const unit = pickUnit(stepFs, 'ns');
  const ratio = stepFs / UNIT_FS[unit];
  const decimals = ratio >= 1 ? 0 : Math.min(9, Math.ceil(-Math.log10(ratio) - 1e-9));
  const majors: number[] = [];
  const k0 = Math.ceil(start / step - 1e-9);
  for (let k = k0; majors.length < 2000; k++) {
    const v = k * step + 0; // + 0：把 -0 规范为 0
    if (v > end + step * 1e-9) break;
    majors.push(v);
  }
  return { step, minor, unit, decimals, majors };
}

/** 刻度标签 */
export function tickLabel(t: number, ticks: Ticks, fsUnit: number): string {
  const v = (t * fsUnit) / UNIT_FS[ticks.unit];
  return `${trimNumber(v, ticks.decimals)} ${unitLabel(ticks.unit)}`;
}

/** 时间（timescale 单位）→ 自动单位文本，如 "125 ns" */
export function formatTime(t: number, fsUnit: number): string {
  // 0 没有量级可言：用 timescale 自身的单位显示
  return formatFs(t * fsUnit, t === 0 ? pickUnit(fsUnit) : undefined);
}
