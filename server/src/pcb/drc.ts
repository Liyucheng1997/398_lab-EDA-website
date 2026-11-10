/**
 * 设计规则检查：连通性（飞线）、间距/短路、元件重叠、板框与安装孔。
 * 这是判断一块板「画完没有」的唯一依据——自动布线器和 AI 的手工走线都由它验收。
 */
import type { PcbDesign, PcbDrcReport, PcbViolation } from '@webeda/shared';
import { EPS, bboxGap, connectivity, copperItems, netClusters, pointShapeDist, round3, shapeDist, type CopperItem } from './geometry';

/** 报告里最多列出的违例条数（同类过多时截断，计数仍然准确） */
const MAX_LISTED = 80;

function itemLabel(it: CopperItem): string {
  if (it.kind === 'pad') return `pad ${it.pin}`;
  return `${it.kind} of ${it.net ?? '?'}`;
}

export function runDrc(design: PcbDesign): PcbDrcReport {
  const violations: PcbViolation[] = [];
  const add = (v: PcbViolation) => violations.push({ ...v, x: v.x === undefined ? undefined : round3(v.x), y: v.y === undefined ? undefined : round3(v.y) });
  const { rules } = design;
  const items = copperItems(design);
  const group = connectivity(items);

  /* 连通性 */
  const ratsnest: PcbDrcReport['ratsnest'] = [];
  let unrouted = 0;
  for (const net of design.nets) {
    if (net.pins.length < 2) continue;
    const clusters = netClusters(items, group, net.name);
    if (clusters.length <= 1) continue;
    unrouted += clusters.length - 1;
    // 飞线：依次把最近的未连通块接到已连通集合上（Prim）
    const padsOf = (c: CopperItem[]) => c.filter((it) => it.kind === 'pad');
    const connected = [...padsOf(clusters[0])];
    const rest = clusters.slice(1).map(padsOf);
    while (rest.length) {
      let best = { d: Infinity, i: 0, a: connected[0], b: rest[0][0] };
      rest.forEach((cluster, i) => {
        for (const b of cluster) {
          for (const a of connected) {
            const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
            if (d < best.d) best = { d, i, a, b };
          }
        }
      });
      ratsnest.push({ net: net.name, x1: best.a.cx, y1: best.a.cy, x2: best.b.cx, y2: best.b.cy });
      connected.push(...rest[best.i]);
      rest.splice(best.i, 1);
    }
    const groups = clusters.map((c) => padsOf(c).map((it) => it.pin).join(' ')).join(' | ');
    const first = ratsnest[ratsnest.length - 1];
    add({
      type: 'unconnected',
      severity: 'error',
      message: `Net ${net.name} is split into ${clusters.length} unconnected groups: ${groups}`,
      x: (first.x1 + first.x2) / 2,
      y: (first.y1 + first.y2) / 2,
      nets: [net.name],
    });
  }

  /* 间距与短路 */
  for (let a = 0; a < items.length; a++) {
    const ia = items[a];
    for (let b = a + 1; b < items.length; b++) {
      const ib = items[b];
      if (!(ia.layers & ib.layers)) continue;
      if (ia.net && ia.net === ib.net) continue;
      // 同一元件的焊盘间距由封装决定
      if (ia.kind === 'pad' && ib.kind === 'pad' && ia.ref === ib.ref) continue;
      if (bboxGap(ia.bbox, ib.bbox) >= rules.clearance) continue;
      const d = shapeDist(ia.shape, ib.shape);
      if (d >= rules.clearance - 1e-4) continue;
      const short = d <= EPS;
      add({
        type: short ? 'short' : 'clearance',
        severity: 'error',
        message: short
          ? `Short: ${itemLabel(ia)} touches ${itemLabel(ib)}`
          : `Clearance ${d.toFixed(3)} mm < ${rules.clearance} mm between ${itemLabel(ia)} and ${itemLabel(ib)}`,
        x: (ia.cx + ib.cx) / 2,
        y: (ia.cy + ib.cy) / 2,
        nets: [ia.net, ib.net].filter((n): n is string => !!n),
        refs: [ia.ref, ib.ref].filter((r): r is string => !!r),
      });
    }
  }

  /* 铜到板边、铜到安装孔 */
  for (const it of items) {
    const b = it.bbox;
    const e = rules.edgeClearance - 1e-4;
    if (b.x1 < e || b.y1 < e || b.x2 > design.width - e || b.y2 > design.height - e) {
      add({ type: 'edge', severity: 'error', message: `${itemLabel(it)} is closer than ${rules.edgeClearance} mm to the board edge`, x: it.cx, y: it.cy, nets: it.net ? [it.net] : undefined, refs: it.ref ? [it.ref] : undefined });
    }
    for (const h of design.holes) {
      if (pointShapeDist(h.x, h.y, it.shape) < h.diameter / 2 + rules.clearance - 1e-4) {
        add({ type: 'hole', severity: 'error', message: `${itemLabel(it)} is too close to the mounting hole at (${h.x}, ${h.y})`, x: h.x, y: h.y, nets: it.net ? [it.net] : undefined, refs: it.ref ? [it.ref] : undefined });
      }
    }
  }

  /* 元件占位 */
  const comps = design.components;
  for (let a = 0; a < comps.length; a++) {
    const ca = comps[a];
    const ba = ca.body;
    if (ba.x1 < -1e-4 || ba.y1 < -1e-4 || ba.x2 > design.width + 1e-4 || ba.y2 > design.height + 1e-4) {
      add({ type: 'outside', severity: 'error', message: `${ca.ref} extends beyond the board outline`, x: ca.x, y: ca.y, refs: [ca.ref] });
    }
    for (const h of design.holes) {
      const dx = Math.max(0, ba.x1 - h.x, h.x - ba.x2);
      const dy = Math.max(0, ba.y1 - h.y, h.y - ba.y2);
      if (Math.hypot(dx, dy) < h.diameter / 2) {
        add({ type: 'hole', severity: 'error', message: `${ca.ref} overlaps the mounting hole at (${h.x}, ${h.y})`, x: h.x, y: h.y, refs: [ca.ref] });
      }
    }
    for (let b = a + 1; b < comps.length; b++) {
      const cb = comps[b];
      const bb = cb.body;
      const ox = Math.min(ba.x2, bb.x2) - Math.max(ba.x1, bb.x1);
      const oy = Math.min(ba.y2, bb.y2) - Math.max(ba.y1, bb.y1);
      if (ox > 1e-4 && oy > 1e-4) {
        add({
          type: 'overlap',
          severity: 'error',
          message: `${ca.ref} and ${cb.ref} overlap by ${ox.toFixed(2)} x ${oy.toFixed(2)} mm`,
          x: (Math.max(ba.x1, bb.x1) + Math.min(ba.x2, bb.x2)) / 2,
          y: (Math.max(ba.y1, bb.y1) + Math.min(ba.y2, bb.y2)) / 2,
          refs: [ca.ref, cb.ref],
        });
      }
    }
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;
  return { violations: violations.slice(0, MAX_LISTED), errors, warnings, unrouted, ratsnest: ratsnest.map((r) => ({ ...r, x1: round3(r.x1), y1: round3(r.y1), x2: round3(r.x2), y2: round3(r.y2) })) };
}

/** 给模型看的 DRC 文本 */
export function formatDrc(report: PcbDrcReport): string {
  if (!report.errors && !report.warnings) return 'DRC clean: every net is fully connected and there are no rule violations.';
  const lines = [`DRC: ${report.errors} error(s), ${report.warnings} warning(s), ${report.unrouted} missing connection(s).`];
  const shown = report.violations.slice(0, 40);
  for (const v of shown) lines.push(`- [${v.type}] ${v.message}${v.x !== undefined ? ` near (${v.x}, ${v.y})` : ''}`);
  const hidden = report.errors + report.warnings - shown.length;
  if (hidden > 0) lines.push(`… and ${hidden} more.`);
  return lines.join('\n');
}
