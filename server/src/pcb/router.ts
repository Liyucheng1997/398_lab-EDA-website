/**
 * 双层网格自动布线器（A*）。
 *
 * - 网格 0.127 mm；格点被占用 = 以该点为中心放一段本网络线宽的走线会违反间距。
 *   障碍膨胀时多留 0.71 格的余量，这样相邻格点之间的线段（含 45° 斜线）也满足间距。
 * - 焊盘不一定落在格点上：从焊盘中心到附近格点的「引出线」逐条做精确间距检查，
 *   线宽不超过焊盘宽度（细间距器件上自动收窄）。
 * - 多引脚网络：从一个连通块出发，每次接上最近的另一个连通块，直到全部连通。
 *
 * 布线器只保证尽力而为，最终是否合格以 DRC 为准。
 */
import type { PcbDesign, PcbLayer, PcbNet } from '@webeda/shared';
import {
  LAYER_B,
  LAYER_F,
  connectivity,
  copperItems,
  netClusters,
  pointShapeDist,
  round3,
  shapeBBox,
  shapeDist,
  type Capsule,
  type CopperItem,
  type Shape,
} from './geometry';

const GRID = 0.127;
const MARGIN = GRID * 0.71;
/** 一个过孔折算成多少 mm 的走线 */
const VIA_COST = 4;
/** 非优选方向的代价系数：顶层偏好水平，底层偏好垂直 */
const OFF_AXIS = 1.2;
const ESCAPE_RADIUS = 1.2;
const MAX_EXPANSIONS = 3_000_000;
const TIME_BUDGET_MS = 25_000;
const LAYERS: PcbLayer[] = ['F.Cu', 'B.Cu'];
const LAYER_BITS = [LAYER_F, LAYER_B];

export interface RouteNetResult {
  net: string;
  ok: boolean;
  /** 本次新接上的连接数 */
  routed: number;
  /** 仍然缺少的连接数 */
  missing: number;
  /** 本次新增走线长度 mm */
  length: number;
  vias: number;
  reason?: string;
}

class MinHeap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;

  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  pop(): number {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

interface Anchor {
  x: number;
  y: number;
  /** 引出线线宽 */
  width: number;
}

interface CellSet {
  /** 格点下标（含层）→ 引出线端点；走线/过孔上的格点为 null */
  cells: Map<number, Anchor | null>;
  /** 各连通块的格点包围盒 [i1, j1, i2, j2]，用于启发函数 */
  boxes: [number, number, number, number][];
}

/** 按网络依次布线，直接修改 design。nets 为空时布所有未连通的网络 */
export function routeNets(design: PcbDesign, names?: string[]): RouteNetResult[] {
  const started = Date.now();
  const { rules } = design;
  const nx = Math.floor(design.width / GRID) + 1;
  const ny = Math.floor(design.height / GRID) + 1;
  const n = nx * ny;
  const gScore = new Float32Array(2 * n);
  const from = new Int32Array(2 * n);
  const closed = new Uint8Array(2 * n);
  const blocked = [new Uint8Array(n), new Uint8Array(n)];
  const viaBlocked = new Uint8Array(n);

  const order = pickNets(design, names);
  const results: RouteNetResult[] = [];

  for (const net of order) {
    const result: RouteNetResult = { net: net.name, ok: false, routed: 0, missing: 0, length: 0, vias: 0 };
    results.push(result);
    let items = copperItems(design);
    let clusters = netClusters(items, connectivity(items), net.name);
    if (clusters.length <= 1) {
      result.ok = true;
      continue;
    }
    result.missing = clusters.length - 1;
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.reason = 'skipped: routing time budget used up; call route again for the remaining nets';
      continue;
    }

    const width = net.class === 'power' ? rules.powerTraceWidth : rules.traceWidth;
    const halfW = width / 2;
    const viaR = rules.viaDiameter / 2;
    const obstacles = items.filter((it) => it.net !== net.name);

    /* 障碍栅格 */
    blocked[0].fill(0);
    blocked[1].fill(0);
    viaBlocked.fill(0);
    const mark = (arr: Uint8Array, shape: Shape, inflate: number) => {
      const b = shapeBBox(shape);
      const i1 = Math.max(0, Math.ceil((b.x1 - inflate) / GRID));
      const i2 = Math.min(nx - 1, Math.floor((b.x2 + inflate) / GRID));
      const j1 = Math.max(0, Math.ceil((b.y1 - inflate) / GRID));
      const j2 = Math.min(ny - 1, Math.floor((b.y2 + inflate) / GRID));
      for (let j = j1; j <= j2; j++) {
        for (let i = i1; i <= i2; i++) {
          if (!arr[j * nx + i] && pointShapeDist(i * GRID, j * GRID, shape) < inflate) arr[j * nx + i] = 1;
        }
      }
    };
    const markEdge = (arr: Uint8Array, keepOut: number) => {
      const i1 = Math.ceil((keepOut - 1e-9) / GRID);
      const i2 = Math.floor((design.width - keepOut + 1e-9) / GRID);
      const j1 = Math.ceil((keepOut - 1e-9) / GRID);
      const j2 = Math.floor((design.height - keepOut + 1e-9) / GRID);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (i < i1 || i > i2 || j < j1 || j > j2) arr[j * nx + i] = 1;
        }
      }
    };
    markEdge(blocked[0], rules.edgeClearance + halfW);
    markEdge(blocked[1], rules.edgeClearance + halfW);
    markEdge(viaBlocked, rules.edgeClearance + viaR);
    for (const it of obstacles) {
      if (it.layers & LAYER_F) mark(blocked[0], it.shape, halfW + rules.clearance + MARGIN);
      if (it.layers & LAYER_B) mark(blocked[1], it.shape, halfW + rules.clearance + MARGIN);
      mark(viaBlocked, it.shape, viaR + rules.clearance + MARGIN);
    }
    for (const h of design.holes) {
      const hole: Capsule = { kind: 'capsule', x1: h.x, y1: h.y, x2: h.x, y2: h.y, r: h.diameter / 2 };
      mark(blocked[0], hole, halfW + rules.clearance + MARGIN);
      mark(blocked[1], hole, halfW + rules.clearance + MARGIN);
      mark(viaBlocked, hole, viaR + rules.clearance + MARGIN);
    }

    /* 一个连通块可以从哪些格点出发/到达 */
    const cellsOf = (cluster: CopperItem[]): CellSet => {
      const cells = new Map<number, Anchor | null>();
      let bi1 = Infinity;
      let bj1 = Infinity;
      let bi2 = -Infinity;
      let bj2 = -Infinity;
      const put = (layer: number, i: number, j: number, anchor: Anchor | null) => {
        const idx = layer * n + j * nx + i;
        if (anchor && cells.get(idx) === null) return; // 已经直接落在本网络的走线上，不需要引出线
        if (anchor && cells.has(idx)) {
          const prev = cells.get(idx)!;
          if (Math.hypot(prev.x - i * GRID, prev.y - j * GRID) <= Math.hypot(anchor.x - i * GRID, anchor.y - j * GRID)) return;
        }
        cells.set(idx, anchor);
        if (i < bi1) bi1 = i;
        if (i > bi2) bi2 = i;
        if (j < bj1) bj1 = j;
        if (j > bj2) bj2 = j;
      };
      for (const it of cluster) {
        const b = it.bbox;
        if (it.kind === 'pad') {
          const minDim = Math.min(b.x2 - b.x1, b.y2 - b.y1);
          const stubW = Math.min(width, Math.max(minDim, rules.traceWidth));
          const reach = Math.max(ESCAPE_RADIUS, Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 + 0.5);
          const near = obstacles.filter(
            (o) => o.bbox.x1 < it.cx + reach + 1 && o.bbox.x2 > it.cx - reach - 1 && o.bbox.y1 < it.cy + reach + 1 && o.bbox.y2 > it.cy - reach - 1,
          );
          const i1 = Math.max(0, Math.ceil((it.cx - reach) / GRID));
          const i2 = Math.min(nx - 1, Math.floor((it.cx + reach) / GRID));
          const j1 = Math.max(0, Math.ceil((it.cy - reach) / GRID));
          const j2 = Math.min(ny - 1, Math.floor((it.cy + reach) / GRID));
          for (let layer = 0; layer < 2; layer++) {
            if (!(it.layers & LAYER_BITS[layer])) continue;
            for (let j = j1; j <= j2; j++) {
              for (let i = i1; i <= i2; i++) {
                if (blocked[layer][j * nx + i]) continue;
                const px = i * GRID;
                const py = j * GRID;
                if (Math.hypot(px - it.cx, py - it.cy) > reach) continue;
                const stub: Capsule = { kind: 'capsule', x1: it.cx, y1: it.cy, x2: px, y2: py, r: stubW / 2 };
                let clear = true;
                for (const o of near) {
                  if (!(o.layers & LAYER_BITS[layer])) continue;
                  if (shapeDist(stub, o.shape) < rules.clearance - 1e-6) {
                    clear = false;
                    break;
                  }
                }
                if (clear) put(layer, i, j, { x: it.cx, y: it.cy, width: stubW });
              }
            }
          }
        } else {
          const i1 = Math.max(0, Math.ceil(b.x1 / GRID));
          const i2 = Math.min(nx - 1, Math.floor(b.x2 / GRID));
          const j1 = Math.max(0, Math.ceil(b.y1 / GRID));
          const j2 = Math.min(ny - 1, Math.floor(b.y2 / GRID));
          for (let layer = 0; layer < 2; layer++) {
            if (!(it.layers & LAYER_BITS[layer])) continue;
            for (let j = j1; j <= j2; j++) {
              for (let i = i1; i <= i2; i++) {
                if (blocked[layer][j * nx + i]) continue;
                if (pointShapeDist(i * GRID, j * GRID, it.shape) <= 0) put(layer, i, j, null);
              }
            }
          }
        }
      }
      return { cells, boxes: cells.size ? [[bi1, bj1, bi2, bj2]] : [] };
    };

    let treePin = clusters.slice().sort((a, b) => b.length - a.length)[0].find((it) => it.kind === 'pad')!.pin!;

    while (clusters.length > 1) {
      const tree = clusters.find((c) => c.some((it) => it.pin === treePin))!;
      const source = cellsOf(tree);
      const target: CellSet = { cells: new Map(), boxes: [] };
      for (const c of clusters) {
        if (c === tree) continue;
        const set = cellsOf(c);
        set.cells.forEach((a, idx) => target.cells.set(idx, a));
        target.boxes.push(...set.boxes);
      }
      if (!source.cells.size || !target.cells.size) {
        result.reason = 'no clear way out of a pad (surrounded by other copper); move the component or free some space';
        break;
      }

      /* A* */
      gScore.fill(Infinity);
      from.fill(-1);
      closed.fill(0);
      const heap = new MinHeap();
      const heuristic = (i: number, j: number): number => {
        let best = Infinity;
        for (const [i1, j1, i2, j2] of target.boxes) {
          const dx = Math.max(0, i1 - i, i - i2);
          const dy = Math.max(0, j1 - j, j - j2);
          const h = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
          if (h < best) best = h;
        }
        return best * GRID;
      };
      source.cells.forEach((anchor, idx) => {
        const cell = idx % n;
        const i = cell % nx;
        const j = (cell - i) / nx;
        const g0 = anchor ? Math.hypot(anchor.x - i * GRID, anchor.y - j * GRID) : 0;
        gScore[idx] = g0;
        heap.push(g0 + heuristic(i, j), idx);
      });
      let goal = -1;
      let expansions = 0;
      while (heap.size) {
        const idx = heap.pop();
        if (closed[idx]) continue;
        closed[idx] = 1;
        if (target.cells.has(idx)) {
          goal = idx;
          break;
        }
        if (++expansions > MAX_EXPANSIONS) break;
        const layer = idx >= n ? 1 : 0;
        const cell = idx - layer * n;
        const i = cell % nx;
        const j = (cell - i) / nx;
        const g = gScore[idx];
        const grid = blocked[layer];
        for (let dj = -1; dj <= 1; dj++) {
          const nj = j + dj;
          if (nj < 0 || nj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di;
            if (ni < 0 || ni >= nx) continue;
            const ncell = nj * nx + ni;
            if (grid[ncell]) continue;
            const nidx = layer * n + ncell;
            if (closed[nidx]) continue;
            let step = di && dj ? Math.SQRT2 : 1;
            if (!(di && dj) && (layer === 0 ? dj !== 0 : di !== 0)) step *= OFF_AXIS;
            const ng = g + step * GRID;
            if (ng < gScore[nidx]) {
              gScore[nidx] = ng;
              from[nidx] = idx;
              heap.push(ng + heuristic(ni, nj), nidx);
            }
          }
        }
        const other = 1 - layer;
        if (!viaBlocked[cell] && !blocked[other][cell]) {
          const nidx = other * n + cell;
          if (!closed[nidx]) {
            const ng = g + VIA_COST;
            if (ng < gScore[nidx]) {
              gScore[nidx] = ng;
              from[nidx] = idx;
              heap.push(ng + heuristic(i, j), nidx);
            }
          }
        }
      }
      if (goal < 0) {
        result.reason = expansions > MAX_EXPANSIONS ? 'search limit reached before a path was found' : 'no path: the remaining pins are walled off by other copper or components';
        break;
      }

      /* 回溯并写入走线 */
      const path: number[] = [];
      for (let idx = goal; idx >= 0; idx = from[idx]) path.push(idx);
      path.reverse();
      const pointOf = (idx: number): [number, number] => {
        const cell = idx % n;
        const i = cell % nx;
        return [round3(i * GRID), round3(((cell - i) / nx) * GRID)];
      };
      const layerOf = (idx: number) => (idx >= n ? 1 : 0);
      const addTrace = (layer: number, w: number, pts: [number, number][]) => {
        const simplified = simplify(pts);
        if (simplified.length < 2) return;
        design.traces.push({ net: net.name, layer: LAYERS[layer], width: round3(w), points: simplified });
        for (let k = 0; k + 1 < simplified.length; k++) result.length += Math.hypot(simplified[k + 1][0] - simplified[k][0], simplified[k + 1][1] - simplified[k][1]);
      };
      const startAnchor = source.cells.get(path[0]);
      if (startAnchor) addTrace(layerOf(path[0]), startAnchor.width, [[startAnchor.x, startAnchor.y], pointOf(path[0])]);
      let run: [number, number][] = [pointOf(path[0])];
      for (let k = 1; k < path.length; k++) {
        if (layerOf(path[k]) !== layerOf(path[k - 1])) {
          addTrace(layerOf(path[k - 1]), width, run);
          const [vx, vy] = pointOf(path[k]);
          design.vias.push({ net: net.name, x: vx, y: vy, diameter: rules.viaDiameter, drill: rules.viaDrill });
          result.vias++;
          run = [[vx, vy]];
        } else {
          run.push(pointOf(path[k]));
        }
      }
      addTrace(layerOf(goal), width, run);
      const endAnchor = target.cells.get(goal);
      if (endAnchor) addTrace(layerOf(goal), endAnchor.width, [pointOf(goal), [endAnchor.x, endAnchor.y]]);

      items = copperItems(design);
      const next = netClusters(items, connectivity(items), net.name);
      if (next.length >= clusters.length) {
        result.reason = 'internal: a routed path did not join the net';
        clusters = next;
        break;
      }
      result.routed += clusters.length - next.length;
      clusters = next;
      treePin = clusters.find((c) => c.some((it) => it.pin === treePin))!.find((it) => it.kind === 'pad')!.pin!;
    }
    result.missing = clusters.length - 1;
    result.ok = result.missing === 0;
    result.length = round3(result.length);
  }
  return results;
}

/** 去掉折线上共线的中间点 */
function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last[0] - a[0]) * (p[1] - last[1]) - (last[1] - a[1]) * (p[0] - last[0]);
      const dot = (last[0] - a[0]) * (p[0] - last[0]) + (last[1] - a[1]) * (p[1] - last[1]);
      if (Math.abs(cross) < 1e-6 && dot > 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** 布线顺序：指定了就按指定顺序；否则信号线按引脚包围盒从小到大，电源线放最后 */
function pickNets(design: PcbDesign, names?: string[]): PcbNet[] {
  if (names?.length) {
    return names.map((name) => {
      const net = design.nets.find((x) => x.name === name);
      if (!net) throw new Error(`Net "${name}" does not exist.`);
      return net;
    });
  }
  const padPos = new Map<string, [number, number]>();
  for (const c of design.components) for (const p of c.pads) padPos.set(`${c.ref}.${p.num}`, [p.x, p.y]);
  const span = (net: PcbNet): number => {
    const pts = net.pins.map((pin) => padPos.get(pin)).filter((p): p is [number, number] => !!p);
    if (!pts.length) return 0;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  };
  return design.nets
    .filter((net) => net.pins.length >= 2)
    .sort((a, b) => Number(a.class === 'power') - Number(b.class === 'power') || span(a) - span(b));
}
