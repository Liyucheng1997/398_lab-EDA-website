/**
 * 电路板的编辑操作。AI 的每个工具调用最终都落到这里的一个方法上；
 * 参数不合法时抛出 BoardError，消息会原样返回给模型，让它自己改正。
 */
import {
  DEFAULT_PCB_RULES,
  type PcbComponent,
  type PcbDesign,
  type PcbFootprintDef,
  type PcbLayer,
  type PcbNetClass,
  type PcbPad,
  type PcbRotation,
} from '@webeda/shared';
import { getFootprint } from './footprints';
import { round3 } from './geometry';

export class BoardError extends Error {}

export const BOARD_LIMITS = {
  minSize: 5,
  maxSize: 160,
  maxComponents: 200,
  maxNets: 400,
  minTraceWidth: 0.15,
};

export function emptyDesign(): PcbDesign {
  return {
    name: '未命名电路板',
    description: '',
    width: 50,
    height: 40,
    holes: [],
    components: [],
    nets: [],
    traces: [],
    vias: [],
    texts: [],
    rules: { ...DEFAULT_PCB_RULES },
    customFootprints: [],
  };
}

const ROTATIONS = new Set([0, 90, 180, 270]);

/** 按元件位置与旋转展开封装（旋转在屏幕上为顺时针） */
function placeFootprint(fp: PcbFootprintDef, x: number, y: number, rotation: PcbRotation): Pick<PcbComponent, 'pads' | 'body'> {
  const rot = (px: number, py: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [-py, px];
      case 180:
        return [-px, -py];
      case 270:
        return [py, -px];
      default:
        return [px, py];
    }
  };
  const swap = rotation === 90 || rotation === 270;
  const pads: PcbPad[] = fp.pads.map((p) => {
    const [rx, ry] = rot(p.x, p.y);
    return { ...p, x: round3(x + rx), y: round3(y + ry), w: swap ? p.h : p.w, h: swap ? p.w : p.h };
  });
  const [ax, ay] = rot(fp.body.x1, fp.body.y1);
  const [bx, by] = rot(fp.body.x2, fp.body.y2);
  return {
    pads,
    body: {
      x1: round3(x + Math.min(ax, bx)),
      y1: round3(y + Math.min(ay, by)),
      x2: round3(x + Math.max(ax, bx)),
      y2: round3(y + Math.max(ay, by)),
    },
  };
}

function fmt(v: number): string {
  return String(round3(v));
}

export interface ComponentInput {
  ref: string;
  footprint: string;
  value?: string;
  x: number;
  y: number;
  rotation?: number;
}

export class PcbBoard {
  constructor(public design: PcbDesign = emptyDesign()) {}

  /* ───────── 板框 ───────── */

  setBoard(input: { name?: string; description?: string; width: number; height: number; holes?: { x: number; y: number; diameter: number }[] }): string {
    const { minSize, maxSize } = BOARD_LIMITS;
    if (!(input.width >= minSize && input.width <= maxSize && input.height >= minSize && input.height <= maxSize)) {
      throw new BoardError(`Board width and height must be between ${minSize} and ${maxSize} mm.`);
    }
    const d = this.design;
    d.width = round3(input.width);
    d.height = round3(input.height);
    if (input.name) d.name = input.name.slice(0, 80);
    if (input.description !== undefined) d.description = input.description.slice(0, 400);
    if (input.holes) {
      for (const h of input.holes) {
        if (!(h.diameter >= 0.5 && h.diameter <= 10)) throw new BoardError('Hole diameter must be between 0.5 and 10 mm.');
        if (h.x < 0 || h.y < 0 || h.x > d.width || h.y > d.height) throw new BoardError(`Hole at (${h.x}, ${h.y}) is outside the board.`);
      }
      d.holes = input.holes.map((h) => ({ x: round3(h.x), y: round3(h.y), diameter: round3(h.diameter) }));
    }
    return `Board "${d.name}" is ${fmt(d.width)} x ${fmt(d.height)} mm with ${d.holes.length} mounting hole(s).`;
  }

  /* ───────── 封装 ───────── */

  defineFootprint(input: { id: string; description?: string; pads: { num: string; x: number; y: number; w: number; h: number; shape?: 'rect' | 'round'; drill?: number }[]; body_width: number; body_height: number }): string {
    if (!/^[A-Za-z0-9][\w.\-+]{0,39}$/.test(input.id)) throw new BoardError('Footprint id must be 1-40 characters: letters, digits, "_", "-", ".", "+".');
    if (getFootprint(input.id)) throw new BoardError(`"${input.id}" is a built-in footprint; choose another id.`);
    if (!input.pads.length || input.pads.length > 200) throw new BoardError('A footprint needs between 1 and 200 pads.');
    const seen = new Set<string>();
    const pads: PcbPad[] = input.pads.map((p) => {
      if (!p.num || seen.has(p.num)) throw new BoardError(`Pad numbers must be unique and non-empty (problem: "${p.num}").`);
      seen.add(p.num);
      if (!(p.w >= 0.2 && p.h >= 0.2 && p.w <= 20 && p.h <= 20)) throw new BoardError(`Pad ${p.num}: width and height must be between 0.2 and 20 mm.`);
      if (p.drill !== undefined && !(p.drill >= 0.2 && p.drill < Math.min(p.w, p.h))) throw new BoardError(`Pad ${p.num}: drill must be at least 0.2 mm and smaller than the pad.`);
      return { num: p.num, x: round3(p.x), y: round3(p.y), w: round3(p.w), h: round3(p.h), shape: p.shape ?? 'rect', ...(p.drill ? { drill: round3(p.drill) } : {}) };
    });
    if (!(input.body_width > 0 && input.body_height > 0 && input.body_width <= 100 && input.body_height <= 100)) throw new BoardError('Body size must be between 0 and 100 mm.');
    const def: PcbFootprintDef = {
      id: input.id,
      description: (input.description ?? '').slice(0, 200),
      pads,
      body: { x1: -input.body_width / 2, y1: -input.body_height / 2, x2: input.body_width / 2, y2: input.body_height / 2 },
    };
    const d = this.design;
    if (d.components.some((c) => c.footprint === input.id)) throw new BoardError(`Footprint "${input.id}" is in use; remove those components before redefining it.`);
    d.customFootprints = [...d.customFootprints.filter((f) => f.id !== input.id), def];
    return `Defined footprint "${input.id}" with ${pads.length} pad(s).`;
  }

  /* ───────── 元件 ───────── */

  private resolve(c: ComponentInput): PcbComponent {
    const fp = getFootprint(c.footprint, this.design.customFootprints);
    if (!fp) throw new BoardError(`Unknown footprint "${c.footprint}" for ${c.ref}. Use one from the catalog or define_footprint first.`);
    const rotation = (c.rotation ?? 0) as PcbRotation;
    if (!ROTATIONS.has(rotation)) throw new BoardError(`${c.ref}: rotation must be 0, 90, 180 or 270.`);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) throw new BoardError(`${c.ref}: x and y must be numbers.`);
    const x = round3(c.x);
    const y = round3(c.y);
    return { ref: c.ref, footprint: c.footprint, value: (c.value ?? '').slice(0, 60), x, y, rotation, ...placeFootprint(fp, x, y, rotation) };
  }

  private describeComponent(c: PcbComponent): string {
    const pads = c.pads.map((p) => `${p.num}@(${fmt(p.x)},${fmt(p.y)})`).join(' ');
    return `${c.ref} ${c.footprint}${c.value ? ` "${c.value}"` : ''} at (${fmt(c.x)},${fmt(c.y)}) rot ${c.rotation}, body x ${fmt(c.body.x1)}..${fmt(c.body.x2)} y ${fmt(c.body.y1)}..${fmt(c.body.y2)}; pads: ${pads}`;
  }

  addComponents(inputs: ComponentInput[]): string {
    const d = this.design;
    if (d.components.length + inputs.length > BOARD_LIMITS.maxComponents) throw new BoardError(`A board can hold at most ${BOARD_LIMITS.maxComponents} components.`);
    const refs = new Set(d.components.map((c) => c.ref));
    const added: PcbComponent[] = [];
    for (const input of inputs) {
      if (!/^[A-Z]{1,4}[0-9]{1,4}$/.test(input.ref)) throw new BoardError(`Invalid reference "${input.ref}". Use letters followed by digits, e.g. R1, U2, J10.`);
      if (refs.has(input.ref)) throw new BoardError(`Reference ${input.ref} already exists.`);
      refs.add(input.ref);
      added.push(this.resolve(input));
    }
    d.components.push(...added);
    return added.map((c) => this.describeComponent(c)).join('\n');
  }

  moveComponents(moves: { ref: string; x: number; y: number; rotation?: number }[]): string {
    const d = this.design;
    const out: string[] = [];
    const ripped = new Set<string>();
    for (const m of moves) {
      const i = d.components.findIndex((c) => c.ref === m.ref);
      if (i < 0) throw new BoardError(`Component ${m.ref} does not exist.`);
      const old = d.components[i];
      const next = this.resolve({ ref: old.ref, footprint: old.footprint, value: old.value, x: m.x, y: m.y, rotation: m.rotation ?? old.rotation });
      next.pads.forEach((p) => {
        p.net = old.pads.find((o) => o.num === p.num)?.net;
        if (p.net) ripped.add(p.net);
      });
      d.components[i] = next;
      out.push(this.describeComponent(next));
    }
    const removed = this.ripUp(ripped);
    if (removed) out.push(`Removed ${removed} trace(s)/via(s) of the nets attached to the moved components; route those nets again: ${[...ripped].join(', ')}`);
    return out.join('\n');
  }

  removeComponents(refs: string[]): string {
    const d = this.design;
    const ripped = new Set<string>();
    for (const ref of refs) {
      const c = d.components.find((x) => x.ref === ref);
      if (!c) throw new BoardError(`Component ${ref} does not exist.`);
      c.pads.forEach((p) => p.net && ripped.add(p.net));
    }
    const gone = new Set(refs);
    d.components = d.components.filter((c) => !gone.has(c.ref));
    for (const n of d.nets) n.pins = n.pins.filter((pin) => !gone.has(pin.split('.')[0]));
    this.ripUp(ripped);
    return `Removed ${refs.join(', ')}. Their pins were dropped from the nets and the affected nets were unrouted.`;
  }

  /* ───────── 网络 ───────── */

  private findPad(pin: string): PcbPad {
    const dot = pin.indexOf('.');
    const ref = dot > 0 ? pin.slice(0, dot) : '';
    const num = dot > 0 ? pin.slice(dot + 1) : '';
    const comp = this.design.components.find((c) => c.ref === ref);
    if (!comp) throw new BoardError(`Pin "${pin}": component ${ref || '?'} does not exist. Pins are written REF.PAD, e.g. U1.8.`);
    const pad = comp.pads.find((p) => p.num === num);
    if (!pad) throw new BoardError(`Pin "${pin}": ${ref} (${comp.footprint}) has no pad "${num}". Its pads are: ${comp.pads.map((p) => p.num).join(', ')}.`);
    return pad;
  }

  /** 按名字新增或替换网络；pins 为空表示删除该网络 */
  setNets(inputs: { name: string; pins: string[]; class?: PcbNetClass }[]): string {
    const d = this.design;
    const touched = new Set<string>();
    for (const input of inputs) {
      if (!/^[\w+\-./~#]{1,40}$/.test(input.name)) throw new BoardError(`Invalid net name "${input.name}". Use up to 40 letters, digits or _ + - . / ~ #.`);
      const pins = [...new Set(input.pins)];
      pins.forEach((pin) => this.findPad(pin));
      for (const other of d.nets) {
        if (other.name === input.name) continue;
        const clash = pins.find((pin) => other.pins.includes(pin));
        if (clash) throw new BoardError(`Pin ${clash} already belongs to net ${other.name}. Remove it there first, or merge the two nets.`);
      }
      touched.add(input.name);
      const rest = d.nets.filter((n) => n.name !== input.name);
      d.nets = pins.length ? [...rest, { name: input.name, pins, class: input.class ?? d.nets.find((n) => n.name === input.name)?.class ?? 'signal' }] : rest;
    }
    if (d.nets.length > BOARD_LIMITS.maxNets) throw new BoardError(`A board can hold at most ${BOARD_LIMITS.maxNets} nets.`);
    this.syncPadNets();
    const removed = this.ripUp(touched);
    const summary = inputs.map((n) => (n.pins.length ? `${n.name} (${new Set(n.pins).size} pins)` : `${n.name} (deleted)`)).join(', ');
    return `Nets updated: ${summary}.${removed ? ` Existing routing of these nets was removed.` : ''} The board now has ${d.nets.length} net(s).`;
  }

  private syncPadNets() {
    const byPin = new Map<string, string>();
    for (const n of this.design.nets) for (const pin of n.pins) byPin.set(pin, n.name);
    for (const c of this.design.components) {
      for (const p of c.pads) {
        const net = byPin.get(`${c.ref}.${p.num}`);
        if (net) p.net = net;
        else delete p.net;
      }
    }
  }

  private netOrThrow(name: string) {
    const net = this.design.nets.find((n) => n.name === name);
    if (!net) throw new BoardError(`Net "${name}" does not exist. Define it with set_nets first.`);
    return net;
  }

  traceWidthFor(netName: string): number {
    const net = this.design.nets.find((n) => n.name === netName);
    return net?.class === 'power' ? this.design.rules.powerTraceWidth : this.design.rules.traceWidth;
  }

  /* ───────── 走线 ───────── */

  private checkPoint(x: number, y: number, what: string) {
    const d = this.design;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > d.width || y > d.height) {
      throw new BoardError(`${what} (${x}, ${y}) is outside the ${fmt(d.width)} x ${fmt(d.height)} mm board.`);
    }
  }

  addTrace(input: { net: string; layer: PcbLayer; points: [number, number][]; width?: number }): string {
    this.netOrThrow(input.net);
    if (input.layer !== 'F.Cu' && input.layer !== 'B.Cu') throw new BoardError('layer must be "F.Cu" or "B.Cu".');
    if (input.points.length < 2) throw new BoardError('A trace needs at least two points.');
    const width = input.width ?? this.traceWidthFor(input.net);
    if (!(width >= BOARD_LIMITS.minTraceWidth && width <= 5)) throw new BoardError(`Trace width must be between ${BOARD_LIMITS.minTraceWidth} and 5 mm.`);
    input.points.forEach(([x, y]) => this.checkPoint(x, y, 'Trace point'));
    const points = input.points.map(([x, y]) => [round3(x), round3(y)] as [number, number]);
    this.design.traces.push({ net: input.net, layer: input.layer, width: round3(width), points });
    let len = 0;
    for (let i = 0; i + 1 < points.length; i++) len += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    return `Added ${fmt(len)} mm of ${fmt(width)} mm trace on ${input.layer} for ${input.net}.`;
  }

  addVia(input: { net: string; x: number; y: number }): string {
    this.netOrThrow(input.net);
    this.checkPoint(input.x, input.y, 'Via');
    const { viaDiameter, viaDrill } = this.design.rules;
    this.design.vias.push({ net: input.net, x: round3(input.x), y: round3(input.y), diameter: viaDiameter, drill: viaDrill });
    return `Added a via for ${input.net} at (${fmt(input.x)}, ${fmt(input.y)}).`;
  }

  /** 拆掉指定网络的走线与过孔；返回拆掉的数量 */
  ripUp(nets: Iterable<string>): number {
    const set = new Set(nets);
    if (!set.size) return 0;
    const d = this.design;
    const before = d.traces.length + d.vias.length;
    d.traces = d.traces.filter((t) => !set.has(t.net));
    d.vias = d.vias.filter((v) => !set.has(v.net));
    return before - d.traces.length - d.vias.length;
  }

  clearRoutes(nets?: string[]): string {
    const d = this.design;
    if (nets?.length) {
      nets.forEach((n) => this.netOrThrow(n));
      return `Removed ${this.ripUp(nets)} trace(s)/via(s) from ${nets.join(', ')}.`;
    }
    const count = d.traces.length + d.vias.length;
    d.traces = [];
    d.vias = [];
    return `Removed all routing (${count} trace(s)/via(s)).`;
  }

  /* ───────── 丝印 ───────── */

  setTexts(texts: { text: string; x: number; y: number; size?: number }[]): string {
    if (texts.length > 60) throw new BoardError('At most 60 silkscreen texts.');
    texts.forEach((t) => this.checkPoint(t.x, t.y, 'Text'));
    this.design.texts = texts.map((t) => ({ text: t.text.slice(0, 60), x: round3(t.x), y: round3(t.y), size: Math.min(5, Math.max(0.6, t.size ?? 1)) }));
    return `The silkscreen now has ${texts.length} text label(s).`;
  }

  /* ───────── 状态描述（给模型看） ───────── */

  describe(): string {
    const d = this.design;
    const lines: string[] = [];
    lines.push(`Board "${d.name}": ${fmt(d.width)} x ${fmt(d.height)} mm, 2 copper layers (F.Cu, B.Cu).`);
    if (d.description) lines.push(`Description: ${d.description}`);
    lines.push(
      `Rules: clearance ${d.rules.clearance}, signal trace ${d.rules.traceWidth}, power trace ${d.rules.powerTraceWidth}, via ${d.rules.viaDiameter}/${d.rules.viaDrill} (pad/drill), copper to board edge ${d.rules.edgeClearance} mm.`,
    );
    if (d.holes.length) lines.push(`Mounting holes: ${d.holes.map((h) => `Ø${fmt(h.diameter)}@(${fmt(h.x)},${fmt(h.y)})`).join(' ')}`);
    if (d.customFootprints.length) lines.push(`Custom footprints: ${d.customFootprints.map((f) => `${f.id} (${f.pads.length} pads)`).join(', ')}`);
    lines.push(`Components (${d.components.length}):`);
    for (const c of d.components) lines.push(`  ${this.describeComponent(c)}`);
    lines.push(`Nets (${d.nets.length}):`);
    for (const n of d.nets) lines.push(`  ${n.name} [${n.class}]: ${n.pins.join(' ')}`);
    const unassigned = d.components.flatMap((c) => c.pads.filter((p) => !p.net).map((p) => `${c.ref}.${p.num}`));
    if (unassigned.length) lines.push(`Pads not in any net (${unassigned.length}): ${unassigned.slice(0, 80).join(' ')}${unassigned.length > 80 ? ' …' : ''}`);
    lines.push(`Routing: ${d.traces.length} trace(s), ${d.vias.length} via(s).`);
    return lines.join('\n');
  }
}
