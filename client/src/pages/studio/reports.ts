/**
 * 报告与运行记录的纯函数：资源利用率百分比、时序摘要、RunRecord 摘要、时间格式化。
 */
import type { Diagnostic, JobResult, RunRecord, TimingReport, UtilizationReport, UtilizationRow } from '@webeda/shared';

/* ───────────────────────── 利用率 ───────────────────────── */

/** 百分比（0–∞）；可用量未知或为 0 时返回 null */
export function utilPercent(used: number, available: number | null | undefined): number | null {
  if (available == null || !Number.isFinite(available) || available <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;
  return (used / available) * 100;
}

/** 百分比文本：null → "—"；很小的非零值 → "<0.1%"；其余保留 1 位（≥100 取整） */
export function formatPercent(p: number | null): string {
  if (p == null) return '—';
  if (p === 0) return '0%';
  if (p < 0.1) return '<0.1%';
  if (p >= 100) return `${Math.round(p)}%`;
  return `${p.toFixed(1)}%`;
}

/** 进度条的状态类：>100% over，>80% warn */
export function meterClass(p: number | null): '' | 'warn' | 'over' {
  if (p == null) return '';
  if (p > 100) return 'over';
  if (p > 80) return 'warn';
  return '';
}

/** 进度条填充宽度（0–100） */
export function meterWidth(p: number | null): number {
  if (p == null) return 0;
  if (p > 0 && p < 1) return 1;
  return Math.max(0, Math.min(100, p));
}

export type KeyResource = 'LUT' | 'FF' | 'BRAM' | 'DSP' | 'IO';
export const KEY_RESOURCES: KeyResource[] = ['LUT', 'FF', 'BRAM', 'DSP', 'IO'];

const RESOURCE_MATCH: Record<KeyResource, RegExp[]> = {
  LUT: [/^LUT\d*$/i, /^LC$/i, /^SLICE_?LUTS?$/i],
  FF: [/^FF$/i, /^DFF$/i, /^REG(ISTER)?S?$/i],
  BRAM: [/^BRAM$/i, /^BSRAM$/i, /^EBR$/i, /^RAMB?\d*$/i],
  DSP: [/^DSP\d*$/i, /^MULT\w*$/i],
  IO: [/^IO$/i, /^IOB$/i, /^PIO$/i],
};

/** 从利用率行中挑出关键资源（按候选优先级取第一个匹配的行） */
export function pickResource(rows: UtilizationRow[] | undefined, key: KeyResource): UtilizationRow | null {
  if (!rows?.length) return null;
  for (const re of RESOURCE_MATCH[key]) {
    const hit = rows.find((r) => re.test(r.resource));
    if (hit) return hit;
  }
  return null;
}

/** 利用率行排序：关键资源在前，其余按名字 */
export function sortUtilRows(rows: UtilizationRow[]): UtilizationRow[] {
  const keyRows = KEY_RESOURCES.map((k) => pickResource(rows, k)).filter((r): r is UtilizationRow => !!r);
  const rest = rows.filter((r) => !keyRows.includes(r)).sort((a, b) => a.resource.localeCompare(b.resource));
  return [...keyRows, ...rest];
}

/** 单元类型计数表（降序） */
export function sortedCells(report: UtilizationReport | undefined): { type: string; count: number }[] {
  if (!report?.cells) return [];
  return Object.entries(report.cells)
    .map(([type, count]) => ({ type, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/* ───────────────────────── 时序 ───────────────────────── */

export interface TimingSummary {
  clock: string;
  /** 最差 slack（ns） */
  wns: number;
  fmax: number;
  constraintMHz: number;
  passed: boolean;
}

/** 取最差的时钟（slack 最小）作为摘要；没有时钟时返回 null */
export function timingSummary(t: TimingReport | undefined | null): TimingSummary | null {
  const clocks = (t?.clocks ?? []).filter((c) => Number.isFinite(c.achievedMHz));
  if (!clocks.length) return null;
  const worst = clocks.reduce((a, b) => (b.slackNs < a.slackNs ? b : a));
  return {
    clock: worst.clock,
    wns: worst.slackNs,
    fmax: worst.achievedMHz,
    constraintMHz: worst.constraintMHz,
    passed: clocks.every((c) => c.passed),
  };
}

export function formatNs(ns: number | null | undefined, digits = 3): string {
  if (ns == null || !Number.isFinite(ns)) return '—';
  return `${ns.toFixed(digits)} ns`;
}

export function formatMHz(mhz: number | null | undefined): string {
  if (mhz == null || !Number.isFinite(mhz)) return '—';
  return `${mhz >= 100 ? mhz.toFixed(1) : mhz.toFixed(2)} MHz`;
}

/* ───────────────────────── 运行记录 ───────────────────────── */

export type RunKind = RunRecord['kind'];

export const RUN_PREFIX: Record<RunKind, string> = { synthesize: 'synth', implement: 'impl', simulate: 'sim' };

/** 下一个运行名：synth_1、synth_2…（取已有最大编号 + 1） */
export function nextRunName(runs: RunRecord[], kind: RunKind): string {
  const prefix = RUN_PREFIX[kind];
  let max = 0;
  for (const r of runs) {
    const m = new RegExp(`^${prefix}_(\\d+)$`).exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}_${max + 1}`;
}

/** 从任务结果生成 RunRecord.summary */
export function summarizeResult(result: JobResult | undefined | null): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!result) return out;
  const diags = result.diagnostics ?? [];
  out.errors = diags.filter((d) => d.severity === 'error').length;
  out.warnings = diags.filter((d) => d.severity === 'warning').length;
  if (result.kind === 'synthesize' || result.kind === 'implement') {
    for (const k of KEY_RESOURCES) {
      const row = pickResource(result.utilization?.rows, k);
      if (row) out[k] = row.used;
    }
  }
  if (result.kind === 'implement') {
    const t = timingSummary(result.timing);
    if (t) {
      out.Fmax = Number(t.fmax.toFixed(2));
      out.WNS = Number(t.wns.toFixed(3));
      out.timingMet = t.passed ? 1 : 0;
    }
    if (result.bitstream) out.bitstream = result.bitstream;
  }
  if (result.kind === 'simulate') {
    if (result.exitCode != null) out.exitCode = result.exitCode;
    if (result.timedOut) out.timedOut = 1;
  }
  return out;
}

/** 某类运行中最新的一条记录 */
export function latestRun(runs: RunRecord[], kind: RunKind, pred?: (r: RunRecord) => boolean): RunRecord | undefined {
  let best: RunRecord | undefined;
  for (const r of runs) {
    if (r.kind !== kind || (pred && !pred(r))) continue;
    if (!best || r.startedAt >= best.startedAt) best = r;
  }
  return best;
}

/** 运行记录按开始时间倒序 */
export function sortRuns(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/* ───────────────────────── 诊断 ───────────────────────── */

export function countDiagnostics(diags: Diagnostic[]): { errors: number; warnings: number; infos: number } {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const d of diags) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

/* ───────────────────────── 时间 ───────────────────────── */

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}:${String(rs).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(rs).padStart(2, '0')}`;
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 具体日期 */
export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return formatDateTime(iso, true);
}

export function formatDateTime(iso: string | undefined, dateOnly = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return dateOnly ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 字节数格式化 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 运行记录摘要 → 关键资源利用率行（产物已过期、只剩摘要时用器件资源总量补全可用量） */
export function rowsFromSummary(
  summary: Record<string, string | number> | undefined,
  resources: Record<string, number> | undefined,
): UtilizationRow[] {
  if (!summary) return [];
  const devRows: UtilizationRow[] = Object.entries(resources ?? {}).map(([resource, n]) => ({ resource, used: 0, available: n }));
  const out: UtilizationRow[] = [];
  for (const k of KEY_RESOURCES) {
    const v = summary[k];
    if (typeof v !== 'number') continue;
    const dev = pickResource(devRows, k);
    out.push({ resource: dev?.resource ?? k, used: v, available: dev?.available ?? null });
  }
  return out;
}

/** 关键资源行（摘要卡片用）：按 LUT/FF/BRAM/DSP/IO 顺序，缺失的跳过 */
export function keyRows(rows: UtilizationRow[] | undefined): { key: KeyResource; row: UtilizationRow }[] {
  return KEY_RESOURCES.map((key) => ({ key, row: pickResource(rows, key) })).filter(
    (x): x is { key: KeyResource; row: UtilizationRow } => !!x.row,
  );
}
