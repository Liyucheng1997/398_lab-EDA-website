// 电路板的派生数据：统计、BOM、导出（纯函数，便于测试）。
import type { PcbDesign, PcbDrcReport, PcbPad, PcbViolationType } from '@webeda/shared';

export interface PcbStats {
  components: number;
  pads: number;
  nets: number;
  /** 完全连通的网络数 */
  routedNets: number;
  /** 走线总长 mm */
  traceLength: number;
  vias: number;
}

export function pcbStats(design: PcbDesign, drc?: PcbDrcReport | null): PcbStats {
  let traceLength = 0;
  for (const t of design.traces) {
    for (let i = 0; i + 1 < t.points.length; i++) traceLength += Math.hypot(t.points[i + 1][0] - t.points[i][0], t.points[i + 1][1] - t.points[i][1]);
  }
  const open = new Set(drc?.ratsnest.map((r) => r.net));
  const multi = design.nets.filter((n) => n.pins.length >= 2);
  return {
    components: design.components.length,
    pads: design.components.reduce((n, c) => n + c.pads.length, 0),
    nets: design.nets.length,
    routedNets: drc ? multi.filter((n) => !open.has(n.name)).length : 0,
    traceLength: Math.round(traceLength * 10) / 10,
    vias: design.vias.length,
  };
}

export interface BomRow {
  refs: string[];
  value: string;
  footprint: string;
}

/** 位号的自然排序：R2 在 R10 之前 */
export function compareRefs(a: string, b: string): number {
  const ma = /^([A-Za-z]+)(\d+)$/.exec(a);
  const mb = /^([A-Za-z]+)(\d+)$/.exec(b);
  if (ma && mb) return ma[1].localeCompare(mb[1]) || Number(ma[2]) - Number(mb[2]);
  return a.localeCompare(b);
}

/** 按「值 + 封装」合并的物料清单 */
export function bomRows(design: PcbDesign): BomRow[] {
  const map = new Map<string, BomRow>();
  for (const c of design.components) {
    const key = `${c.value}\u0000${c.footprint}`;
    let row = map.get(key);
    if (!row) map.set(key, (row = { refs: [], value: c.value, footprint: c.footprint }));
    row.refs.push(c.ref);
  }
  const rows = [...map.values()];
  rows.forEach((r) => r.refs.sort(compareRefs));
  return rows.sort((a, b) => compareRefs(a.refs[0], b.refs[0]));
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomCsv(design: PcbDesign): string {
  const lines = ['Refs,Qty,Value,Footprint'];
  for (const r of bomRows(design)) lines.push([r.refs.join(' '), String(r.refs.length), r.value, r.footprint].map(csvCell).join(','));
  // BOM 让 Excel 按 UTF-8 打开中文
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const VIOLATION_LABELS: Record<PcbViolationType, string> = {
  unconnected: '未连通',
  short: '短路',
  clearance: '间距不足',
  overlap: '元件重叠',
  outside: '超出板框',
  edge: '离板边太近',
  hole: '压到安装孔',
};

/** 焊盘的 SVG 圆角：圆形/跑道形取短边的一半 */
export function padRadius(p: PcbPad): number {
  return p.shape === 'round' ? Math.min(p.w, p.h) / 2 : 0;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const EXPORT_COLORS = { bg: '#ffffff', board: '#f3f4f6', edge: '#1d1d1f', fcu: '#0071e3', bcu: '#8e8e93', pad: '#1d1d1f', silk: '#6e6e73', hole: '#ffffff' };

/** 生成独立的 SVG 文件内容（固定浅色配色，1 mm = 1 个用户单位） */
export function designToSvg(design: PcbDesign): string {
  const c = EXPORT_COLORS;
  const m = 2;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${design.width + 2 * m} ${design.height + 2 * m}" width="${design.width + 2 * m}mm" height="${design.height + 2 * m}mm">`,
    `<title>${esc(design.name)}</title>`,
    `<rect x="${-m}" y="${-m}" width="${design.width + 2 * m}" height="${design.height + 2 * m}" fill="${c.bg}"/>`,
    `<rect width="${design.width}" height="${design.height}" rx="0.6" fill="${c.board}" stroke="${c.edge}" stroke-width="0.15"/>`,
  );
  for (const layer of ['B.Cu', 'F.Cu'] as const) {
    const color = layer === 'F.Cu' ? c.fcu : c.bcu;
    for (const t of design.traces) {
      if (t.layer !== layer) continue;
      out.push(`<polyline points="${t.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${t.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  for (const comp of design.components) {
    const b = comp.body;
    out.push(`<rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" fill="none" stroke="${c.silk}" stroke-width="0.1"/>`);
    for (const p of comp.pads) {
      out.push(`<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" rx="${padRadius(p)}" fill="${c.pad}"/>`);
      if (p.drill) out.push(`<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" fill="${c.hole}"/>`);
    }
    out.push(`<text x="${b.x1}" y="${b.y1 - 0.25}" font-size="0.9" font-family="sans-serif" fill="${c.silk}">${esc(comp.ref)}</text>`);
  }
  for (const v of design.vias) {
    out.push(`<circle cx="${v.x}" cy="${v.y}" r="${v.diameter / 2}" fill="${c.pad}"/>`, `<circle cx="${v.x}" cy="${v.y}" r="${v.drill / 2}" fill="${c.hole}"/>`);
  }
  for (const h of design.holes) out.push(`<circle cx="${h.x}" cy="${h.y}" r="${h.diameter / 2}" fill="${c.hole}" stroke="${c.edge}" stroke-width="0.1"/>`);
  for (const t of design.texts) {
    out.push(`<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="${c.silk}">${esc(t.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

export function safeBoardFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'pcb';
}

export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
