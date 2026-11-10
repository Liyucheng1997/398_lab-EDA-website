/**
 * PCB 几何：铜皮形状只有两种——轴对齐矩形（矩形焊盘）和胶囊（走线段、过孔、圆形/跑道形焊盘）。
 * 所有距离都是「边到边」的距离，重叠时为 0。
 */
import type { PcbDesign, PcbPad } from '@webeda/shared';

export interface Box {
  kind: 'box';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Capsule {
  kind: 'capsule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

export type Shape = Box | Capsule;

/** 判定「相碰」的容差（mm） */
export const EPS = 1e-6;

export function shapeBBox(s: Shape): Box {
  if (s.kind === 'box') return s;
  return {
    kind: 'box',
    x1: Math.min(s.x1, s.x2) - s.r,
    y1: Math.min(s.y1, s.y2) - s.r,
    x2: Math.max(s.x1, s.x2) + s.r,
    y2: Math.max(s.y1, s.y2) + s.r,
  };
}

export function pointSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** 两条线段的最短距离（相交为 0） */
export function segSegDist(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const aDegenerate = ax === bx && ay === by;
  const cDegenerate = cx === dx && cy === dy;
  if (!aDegenerate && !cDegenerate) {
    const d1 = cross(cx, cy, dx, dy, ax, ay);
    const d2 = cross(cx, cy, dx, dy, bx, by);
    const d3 = cross(ax, ay, bx, by, cx, cy);
    const d4 = cross(ax, ay, bx, by, dx, dy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  }
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by),
  );
}

function pointInBox(px: number, py: number, b: Box): boolean {
  return px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2;
}

function segBoxDist(x1: number, y1: number, x2: number, y2: number, b: Box): number {
  if (pointInBox(x1, y1, b) || pointInBox(x2, y2, b)) return 0;
  return Math.min(
    segSegDist(x1, y1, x2, y2, b.x1, b.y1, b.x2, b.y1),
    segSegDist(x1, y1, x2, y2, b.x2, b.y1, b.x2, b.y2),
    segSegDist(x1, y1, x2, y2, b.x2, b.y2, b.x1, b.y2),
    segSegDist(x1, y1, x2, y2, b.x1, b.y2, b.x1, b.y1),
  );
}

/** 两个形状的边到边距离；重叠或相碰时为 0 */
export function shapeDist(a: Shape, b: Shape): number {
  if (a.kind === 'box' && b.kind === 'box') {
    const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
    const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
    return Math.hypot(dx, dy);
  }
  if (a.kind === 'capsule' && b.kind === 'capsule') {
    return Math.max(0, segSegDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) - a.r - b.r);
  }
  const box = (a.kind === 'box' ? a : b) as Box;
  const cap = (a.kind === 'capsule' ? a : b) as Capsule;
  return Math.max(0, segBoxDist(cap.x1, cap.y1, cap.x2, cap.y2, box) - cap.r);
}

/** 点到形状的距离（点在形状内为 0） */
export function pointShapeDist(px: number, py: number, s: Shape): number {
  if (s.kind === 'box') {
    const dx = Math.max(0, s.x1 - px, px - s.x2);
    const dy = Math.max(0, s.y1 - py, py - s.y2);
    return Math.hypot(dx, dy);
  }
  return Math.max(0, pointSegDist(px, py, s.x1, s.y1, s.x2, s.y2) - s.r);
}

export function padShape(p: PcbPad): Shape {
  if (p.shape === 'rect') return { kind: 'box', x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 };
  const r = Math.min(p.w, p.h) / 2;
  const half = Math.abs(p.w - p.h) / 2;
  return p.w >= p.h
    ? { kind: 'capsule', x1: p.x - half, y1: p.y, x2: p.x + half, y2: p.y, r }
    : { kind: 'capsule', x1: p.x, y1: p.y - half, x2: p.x, y2: p.y + half, r };
}

/* ───────────────────────── 铜皮清单与连通性 ───────────────────────── */

export const LAYER_F = 1;
export const LAYER_B = 2;

export interface CopperItem {
  shape: Shape;
  bbox: Box;
  /** 位掩码：LAYER_F | LAYER_B */
  layers: number;
  net?: string;
  kind: 'pad' | 'trace' | 'via';
  /** 焊盘：位号与 "位号.引脚号" */
  ref?: string;
  pin?: string;
  /** 代表点（焊盘中心 / 线段中点 / 过孔中心） */
  cx: number;
  cy: number;
}

/** 把设计展开成铜皮清单（每条走线的每一段是一项） */
export function copperItems(design: PcbDesign): CopperItem[] {
  const items: CopperItem[] = [];
  const push = (shape: Shape, rest: Omit<CopperItem, 'shape' | 'bbox'>) => items.push({ shape, bbox: shapeBBox(shape), ...rest });
  for (const c of design.components) {
    for (const p of c.pads) {
      push(padShape(p), {
        layers: p.drill ? LAYER_F | LAYER_B : LAYER_F,
        net: p.net,
        kind: 'pad',
        ref: c.ref,
        pin: `${c.ref}.${p.num}`,
        cx: p.x,
        cy: p.y,
      });
    }
  }
  for (const t of design.traces) {
    const layers = t.layer === 'F.Cu' ? LAYER_F : LAYER_B;
    for (let i = 0; i + 1 < t.points.length; i++) {
      const [x1, y1] = t.points[i];
      const [x2, y2] = t.points[i + 1];
      push({ kind: 'capsule', x1, y1, x2, y2, r: t.width / 2 }, { layers, net: t.net, kind: 'trace', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
    }
  }
  for (const v of design.vias) {
    push({ kind: 'capsule', x1: v.x, y1: v.y, x2: v.x, y2: v.y, r: v.diameter / 2 }, { layers: LAYER_F | LAYER_B, net: v.net, kind: 'via', cx: v.x, cy: v.y });
  }
  return items;
}

export function bboxGap(a: Box, b: Box): number {
  return Math.max(a.x1 - b.x2, b.x1 - a.x2, a.y1 - b.y2, b.y1 - a.y2);
}

/**
 * 同一网络内相碰的铜皮归为一个连通块。
 * 返回 group[i] = 第 i 项所在连通块的代表下标（没有网络的项自成一块）。
 */
export function connectivity(items: CopperItem[]): Int32Array {
  const parent = new Int32Array(items.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const byNet = new Map<string, number[]>();
  items.forEach((it, i) => {
    if (!it.net) return;
    let list = byNet.get(it.net);
    if (!list) byNet.set(it.net, (list = []));
    list.push(i);
  });
  for (const list of byNet.values()) {
    for (let a = 0; a < list.length; a++) {
      const ia = items[list[a]];
      for (let b = a + 1; b < list.length; b++) {
        const ib = items[list[b]];
        if (!(ia.layers & ib.layers)) continue;
        if (bboxGap(ia.bbox, ib.bbox) > EPS) continue;
        if (shapeDist(ia.shape, ib.shape) > EPS) continue;
        const ra = find(list[a]);
        const rb = find(list[b]);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }
  const group = new Int32Array(items.length);
  for (let i = 0; i < group.length; i++) group[i] = find(i);
  return group;
}

/** 某个网络按连通块分组后的铜皮项（只保留含焊盘的块） */
export function netClusters(items: CopperItem[], group: Int32Array, net: string): CopperItem[][] {
  const map = new Map<number, CopperItem[]>();
  items.forEach((it, i) => {
    if (it.net !== net) return;
    let list = map.get(group[i]);
    if (!list) map.set(group[i], (list = []));
    list.push(it);
  });
  return [...map.values()].filter((c) => c.some((it) => it.kind === 'pad'));
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
