// 器件视图的数据模型：由 PlacementInfo 推出 tile 类型、每个 tile 的单元、各类型计数与利用率。纯函数，便于测试。
import type { PlacementInfo } from '@webeda/shared';

export type PlacedCell = PlacementInfo['cells'][number];

export const TILE_EMPTY = 0;
export const TILE_LOGIC = 1;
export const TILE_IO = 2;
export const TILE_RAM = 3;
export const TILE_DSP = 4;
export type TileKind = typeof TILE_EMPTY | typeof TILE_LOGIC | typeof TILE_IO | typeof TILE_RAM | typeof TILE_DSP;

export const TILE_KIND_LABEL: Record<TileKind, string> = {
  [TILE_EMPTY]: '空',
  [TILE_LOGIC]: '逻辑',
  [TILE_IO]: 'IO',
  [TILE_RAM]: 'RAM',
  [TILE_DSP]: 'DSP',
};

/** 单元类型的规范化分类（决定配色与图例顺序） */
export type CellCategory = 'logic' | 'IO' | 'RAM' | 'DSP' | 'PLL' | 'GB' | 'OTHER';

export function categoryOf(type: string): CellCategory {
  const t = type.toUpperCase();
  if (t === 'LC' || t === 'SLICE' || t === 'LUT' || t === 'FF' || t === 'LOGIC' || t === 'CARRY') return 'logic';
  if (t === 'IO' || t === 'PIO' || t === 'IOB' || t === 'SB_IO') return 'IO';
  if (t === 'RAM' || t === 'BRAM' || t === 'SPRAM' || t === 'DP16KD' || t === 'EBR') return 'RAM';
  if (t === 'DSP' || t === 'MAC16' || t === 'MULT18X18D' || t === 'ALU54B') return 'DSP';
  if (t === 'PLL' || t === 'EHXPLLL' || t === 'MMCM') return 'PLL';
  if (t === 'GB' || t === 'GBUF' || t === 'DCC' || t === 'BUFG') return 'GB';
  return 'OTHER';
}

export const CATEGORY_ORDER: CellCategory[] = ['logic', 'IO', 'RAM', 'DSP', 'PLL', 'GB', 'OTHER'];

/** 每个 tile 内某类型的默认槽位数（实际取 max(默认, 观测到的最大 z + 1)） */
export function defaultSlots(type: string): number {
  const t = type.toUpperCase();
  if (t === 'LC') return 8; // iCE40 PLB：8 个 LC
  if (t === 'SLICE') return 4; // ECP5 PLC：4 个 SLICE
  if (t === 'IO') return 2;
  return 1;
}

/** 已知器件的版图提示（与实际数据冲突时以数据为准） */
export interface DeviceHints {
  /** nextpnr 坐标 y=0 在底部（iCE40）还是顶部（ECP5） */
  originBottom: boolean;
  /** IO 所在的边：all = 四边；tb = 仅上下边 */
  ioSides: 'all' | 'tb';
  ramCols: number[];
  dspCols: number[];
}

export function deviceHints(device: string, width: number, height: number): DeviceHints {
  const d = device.toLowerCase();
  const ice40 = d.startsWith('ice40');
  const base: DeviceHints = { originBottom: ice40, ioSides: 'all', ramCols: [], dspCols: [] };
  // 仅当网格尺寸与已知芯片一致时才使用列信息，避免数据来源变化时画错
  if (d.includes('hx1k') && width === 14 && height === 18) return { ...base, ramCols: [3, 10] };
  if (d.includes('hx8k') && width === 34 && height === 34) return { ...base, ramCols: [8, 25] };
  if (d.includes('up5k') && width === 26 && height === 32) return { ...base, ioSides: 'tb', ramCols: [6, 19], dspCols: [0, 25] };
  return base;
}

export interface TileData {
  x: number;
  y: number;
  cells: PlacedCell[];
  /** 该 tile 的槽位数 */
  slots: number;
}

export interface TypeCount {
  type: string;
  category: CellCategory;
  count: number;
}

export interface DeviceModel {
  width: number;
  height: number;
  originBottom: boolean;
  /** 行优先 kinds[y * width + x]（y 为器件坐标） */
  kinds: Uint8Array;
  /** key = y * width + x */
  tiles: Map<number, TileData>;
  /** 按分类顺序、再按数量降序 */
  typeCounts: TypeCount[];
  totalCells: number;
  /** 坐标越界被忽略的单元数 */
  outOfRange: number;
  tileTotals: Record<TileKind, number>;
  tileUsed: Record<TileKind, number>;
  /** 每种类型的槽位数 */
  slotsByType: Map<string, number>;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** 构建器件模型。width/height 不合法时按单元坐标推断网格尺寸 */
export function buildDeviceModel(p: PlacementInfo): DeviceModel {
  const cellsIn = Array.isArray(p.cells) ? p.cells : [];
  let width = isInt(p.width) && p.width > 0 ? Math.floor(p.width) : 0;
  let height = isInt(p.height) && p.height > 0 ? Math.floor(p.height) : 0;
  if (!width || !height) {
    let mx = 0;
    let my = 0;
    for (const c of cellsIn) {
      if (isInt(c.x) && isInt(c.y)) {
        mx = Math.max(mx, c.x);
        my = Math.max(my, c.y);
      }
    }
    width ||= mx + 1;
    height ||= my + 1;
  }
  // 防御性上限：避免畸形数据分配巨型数组
  width = Math.min(width, 4096);
  height = Math.min(height, 4096);
  const hints = deviceHints(String(p.device ?? ''), width, height);

  const slotsByType = new Map<string, number>();
  const tiles = new Map<number, TileData>();
  const counts = new Map<string, number>();
  let outOfRange = 0;
  let total = 0;
  for (const c of cellsIn) {
    if (!c || !isInt(c.x) || !isInt(c.y)) {
      outOfRange++;
      continue;
    }
    const x = Math.floor(c.x);
    const y = Math.floor(c.y);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      outOfRange++;
      continue;
    }
    const type = String(c.type || 'OTHER').toUpperCase();
    const z = isInt(c.z) && c.z >= 0 ? Math.floor(c.z) : 0;
    const cell: PlacedCell = { name: String(c.name ?? ''), type, x, y, z };
    total++;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    slotsByType.set(type, Math.max(slotsByType.get(type) ?? defaultSlots(type), Math.min(z + 1, 64)));
    const key = y * width + x;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { x, y, cells: [], slots: 1 }));
    t.cells.push(cell);
  }
  for (const t of tiles.values()) {
    let s = 1;
    for (const c of t.cells) s = Math.max(s, slotsByType.get(c.type) ?? 1);
    t.slots = s;
    t.cells.sort((a, b) => a.z - b.z || a.type.localeCompare(b.type));
  }

  // 列推断：出现过 RAM / DSP 单元的列
  const ramCols = new Set(hints.ramCols);
  const dspCols = new Set(hints.dspCols);
  for (const t of tiles.values()) {
    for (const c of t.cells) {
      const cat = categoryOf(c.type);
      if (cat === 'RAM') ramCols.add(t.x);
      else if (cat === 'DSP') dspCols.add(t.x);
    }
  }

  const kinds = new Uint8Array(width * height);
  const tileTotals: Record<TileKind, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  const tileUsed: Record<TileKind, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  const tiny = width < 3 || height < 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = y * width + x;
      const borderX = x === 0 || x === width - 1;
      const borderY = y === 0 || y === height - 1;
      let kind: TileKind;
      const data = tiles.get(key);
      const fromData = data ? kindFromCells(data.cells) : null;
      if (fromData != null) kind = fromData;
      else if (tiny) kind = TILE_LOGIC;
      else if (borderX && borderY) kind = TILE_EMPTY;
      else if (borderY) kind = TILE_IO;
      else if (borderX) kind = hints.ioSides === 'all' ? TILE_IO : dspCols.has(x) ? TILE_DSP : ramCols.has(x) ? TILE_RAM : TILE_LOGIC;
      else if (dspCols.has(x)) kind = TILE_DSP;
      else if (ramCols.has(x)) kind = TILE_RAM;
      else kind = TILE_LOGIC;
      kinds[key] = kind;
      tileTotals[kind]++;
      if (data) tileUsed[kind]++;
    }
  }

  const typeCounts: TypeCount[] = [...counts.entries()]
    .map(([type, count]) => ({ type, count, category: categoryOf(type) }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.count - a.count);

  return {
    width,
    height,
    originBottom: hints.originBottom,
    kinds,
    tiles,
    typeCounts,
    totalCells: total,
    outOfRange,
    tileTotals,
    tileUsed,
    slotsByType,
  };
}

/** 由 tile 中的单元决定 tile 类型（多数优先：RAM/DSP > IO > 逻辑） */
function kindFromCells(cells: PlacedCell[]): TileKind | null {
  let logic = false;
  let io = false;
  for (const c of cells) {
    const cat = categoryOf(c.type);
    if (cat === 'RAM') return TILE_RAM;
    if (cat === 'DSP') return TILE_DSP;
    if (cat === 'IO') io = true;
    else if (cat === 'logic') logic = true;
  }
  if (io) return TILE_IO;
  if (logic) return TILE_LOGIC;
  return null;
}

/** 器件坐标 → 画面行（内容坐标的 y，单位 tile） */
export function tileRow(m: Pick<DeviceModel, 'height' | 'originBottom'>, y: number): number {
  return m.originBottom ? m.height - 1 - y : y;
}

/** 内容坐标（单位 tile）→ 器件 tile 坐标；越界返回 null */
export function hitTile(
  m: Pick<DeviceModel, 'width' | 'height' | 'originBottom'>,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const col = Math.floor(cx);
  const row = Math.floor(cy);
  if (col < 0 || row < 0 || col >= m.width || row >= m.height) return null;
  return { x: col, y: m.originBottom ? m.height - 1 - row : row };
}

/** 槽位排布：n 个 BEL 在 tile 内的列×行 */
export function slotGrid(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 8) return { cols: 2, rows: 4 };
  if (n <= 16) return { cols: 4, rows: 4 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * 第 z 个槽位在 tile 内的小方块（相对 tile 左上角，单位与 tileSize 相同）。
 * inset 为 tile 四周留白比例。
 */
export function slotRect(z: number, n: number, tileSize: number, inset = 0.14): { x: number; y: number; size: number } {
  const { cols, rows } = slotGrid(n);
  const idx = ((z % (cols * rows)) + cols * rows) % (cols * rows);
  const pad = tileSize * inset;
  const inner = tileSize - pad * 2;
  const cw = inner / cols;
  const ch = inner / rows;
  const size = Math.min(cw, ch) * 0.78;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return { x: pad + col * cw + (cw - size) / 2, y: pad + row * ch + (ch - size) / 2, size };
}

/** 解析 CSS 颜色（#rgb/#rgba/#rrggbb/#rrggbbaa/rgb()/rgba()）并套上新的不透明度 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const a = Math.max(0, Math.min(1, alpha * rgb[3]));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${+a.toFixed(3)})`;
}

export function parseColor(color: string): [number, number, number, number] | null {
  const c = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((d) => parseInt(d + d, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2) || 'ff', 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(c);
  if (m) {
    let a = 1;
    if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number.isFinite(a) ? a : 1];
  }
  return null;
}

/** 类型显示名 */
export function typeLabel(type: string): string {
  const t = type.toUpperCase();
  const map: Record<string, string> = { LC: 'LC', SLICE: 'SLICE', IO: 'IO', RAM: 'RAM', DSP: 'DSP', PLL: 'PLL', GB: 'GB 全局缓冲', OTHER: '其他' };
  return map[t] ?? t;
}
