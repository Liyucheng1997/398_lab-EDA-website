/**
 * nextpnr --write routed.json → PlacementInfo（器件视图）
 */
import type { DeviceFamily, DeviceId, PlacementInfo } from '@webeda/shared';
import { attrString, findTopModule, type YosysDesign } from './yosysJson';

/** 已知器件网格尺寸（tile 数）；实际坐标超出时自动扩大 */
const GRID: Partial<Record<DeviceId, { width: number; height: number }>> = {
  'ice40-hx1k-tq144': { width: 14, height: 18 },
  'ice40-hx8k-ct256': { width: 34, height: 34 },
  'ice40-up5k-sg48': { width: 26, height: 32 },
  'ecp5-25k-cabga256': { width: 73, height: 51 },
  'ecp5-85k-cabga381': { width: 127, height: 96 },
};

export const MAX_WIRES = 5000;

export function classifyCell(family: DeviceFamily, type: string): string {
  if (family === 'ice40') {
    if (type === 'ICESTORM_LC') return 'LC';
    if (type === 'SB_IO' || type === 'SB_GB_IO' || type.startsWith('SB_IO_')) return 'IO';
    if (type === 'ICESTORM_RAM' || type === 'ICESTORM_SPRAM' || type.startsWith('SB_RAM') || type === 'SB_SPRAM256KA') return 'RAM';
    if (type === 'ICESTORM_DSP' || type === 'SB_MAC16') return 'DSP';
    if (type === 'ICESTORM_PLL' || type.startsWith('SB_PLL')) return 'PLL';
    if (type === 'SB_GB') return 'GB';
    return 'OTHER';
  }
  if (family === 'ecp5') {
    if (/^TRELLIS_(COMB|FF|RAMW|SLICE)$/.test(type)) return 'SLICE';
    if (type === 'TRELLIS_IO' || type === 'SIOLOGIC' || type === 'IOLOGIC') return 'IO';
    if (type === 'DP16KD' || type === 'PDPW16KD') return 'RAM';
    if (type === 'MULT18X18D' || type === 'ALU54B') return 'DSP';
    if (type === 'EHXPLLL') return 'PLL';
    if (type === 'DCCA' || type === 'DCSC') return 'GB';
    return 'OTHER';
  }
  return 'OTHER';
}

/** BEL 名 → (x, y, z)："X14/Y22/lc5"、"X23/Y35/SLICEB.K1"、"X72/Y35/PIOC" */
export function parseBel(bel: string): { x: number; y: number; z: number } | undefined {
  const m = /^X(\d+)\/Y(\d+)\/(.*)$/.exec(bel);
  if (!m) return undefined;
  const rest = m[3];
  let z = 0;
  let s: RegExpExecArray | null;
  if ((s = /SLICE([A-D])(?:\.\w*?(\d+))?/.exec(rest))) z = (s[1].charCodeAt(0) - 65) * 2 + (s[2] ? Number(s[2]) : 0);
  else if ((s = /^PIO([A-D])/.exec(rest))) z = s[1].charCodeAt(0) - 65;
  else if ((s = /(\d+)$/.exec(rest))) z = Number(s[1]);
  return { x: Number(m[1]), y: Number(m[2]), z };
}

const TILE = /^X(\d+)\/Y(\d+)\//;
/** iCE40 pip："X14/Y22/14.22.lutff_3:cout.->.14.22.lutff_4:in_3" 中带有源/目的 tile 坐标 */
const ICE40_PIP = /^X\d+\/Y\d+\/(\d+)\.(\d+)\..*\.->\.(\d+)\.(\d+)\./;

/** 解析一条网络的 ROUTING 属性（"wire;pip;strength;wire;pip;strength;…"）为 tile 间连线段 */
export function routingSegments(routing: string): [number, number, number, number][] {
  const parts = routing.split(';');
  const segs: [number, number, number, number][] = [];
  const seen = new Set<string>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 === x2 && y1 === y2) return;
    const key = x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
    if (seen.has(key)) return;
    seen.add(key);
    segs.push([x1, y1, x2, y2]);
  };
  for (let i = 0; i + 1 < parts.length; i += 3) {
    const wire = parts[i];
    const pip = parts[i + 1];
    // 全局时钟网络是专用走线，画出来只会是从角落到每个 tile 的放射线
    if (!pip || pip.includes('glb_netwk')) continue;
    const ice = ICE40_PIP.exec(pip);
    if (ice) {
      add(Number(ice[1]), Number(ice[2]), Number(ice[3]), Number(ice[4]));
      continue;
    }
    const w = TILE.exec(wire);
    const p = TILE.exec(pip);
    if (w && p) add(Number(p[1]), Number(p[2]), Number(w[1]), Number(w[2]));
  }
  return segs;
}

export function parsePlacement(routed: YosysDesign, device: DeviceId, family: DeviceFamily, maxWires = MAX_WIRES): PlacementInfo {
  const topName = findTopModule(routed);
  const mod = topName ? routed.modules[topName] : undefined;
  const cells: PlacementInfo['cells'] = [];
  let maxX = 0;
  let maxY = 0;
  for (const [name, c] of Object.entries(mod?.cells ?? {})) {
    const bel = attrString(c.attributes?.NEXTPNR_BEL);
    if (!bel) continue;
    const pos = parseBel(bel);
    if (!pos) continue;
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
    cells.push({ name, type: classifyCell(family, c.type), ...pos });
  }

  const all: { x1: number; y1: number; x2: number; y2: number; net: string }[] = [];
  const doneRouting = new Set<string>();
  for (const [net, n] of Object.entries(mod?.netnames ?? {})) {
    const routing = attrString(n.attributes?.ROUTING);
    if (!routing || doneRouting.has(routing)) continue;
    doneRouting.add(routing);
    for (const [x1, y1, x2, y2] of routingSegments(routing)) {
      maxX = Math.max(maxX, x1, x2);
      maxY = Math.max(maxY, y1, y2);
      all.push({ x1, y1, x2, y2, net });
    }
  }
  let wires = all;
  if (all.length > maxWires) {
    wires = [];
    const step = all.length / maxWires;
    for (let i = 0; i < maxWires; i++) wires.push(all[Math.floor(i * step)]);
  }

  const grid = GRID[device];
  const info: PlacementInfo = {
    device,
    width: Math.max(grid?.width ?? 0, maxX + 1),
    height: Math.max(grid?.height ?? 0, maxY + 1),
    cells,
  };
  if (wires.length) info.wires = wires;
  return info;
}
