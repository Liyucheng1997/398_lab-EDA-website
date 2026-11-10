import { describe, expect, it } from 'vitest';
import { PcbBoard } from '../src/pcb/board';
import { runDrc } from '../src/pcb/drc';
import { buildExample } from '../src/pcb/example';
import { getFootprint } from '../src/pcb/footprints';
import { segSegDist, shapeDist } from '../src/pcb/geometry';
import { routeNets } from '../src/pcb/router';
import { executeTool } from '../src/pcb/tools';

describe('pcb geometry', () => {
  it('measures edge-to-edge distances', () => {
    expect(segSegDist(0, 0, 2, 0, 1, -1, 1, 1)).toBe(0);
    expect(segSegDist(0, 0, 2, 0, 0, 1, 2, 1)).toBe(1);
    expect(shapeDist({ kind: 'box', x1: 0, y1: 0, x2: 1, y2: 1 }, { kind: 'box', x1: 2, y1: 0, x2: 3, y2: 1 })).toBe(1);
    // 0.25 宽的走线从矩形焊盘右侧 0.5 处经过
    expect(shapeDist({ kind: 'box', x1: 0, y1: 0, x2: 1, y2: 1 }, { kind: 'capsule', x1: 1.5, y1: -2, x2: 1.5, y2: 2, r: 0.125 })).toBeCloseTo(0.375);
    expect(shapeDist({ kind: 'box', x1: 0, y1: 0, x2: 1, y2: 1 }, { kind: 'capsule', x1: 0.5, y1: 0.5, x2: 5, y2: 0.5, r: 0.1 })).toBe(0);
  });
});

describe('pcb footprints', () => {
  it('numbers dual-row packages counter-clockwise from the top left', () => {
    const fp = getFootprint('SOIC-8')!;
    expect(fp.pads.map((p) => p.num)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const [p1, p4, p5, p8] = [fp.pads[0], fp.pads[3], fp.pads[4], fp.pads[7]];
    expect(p1.x).toBeLessThan(0);
    expect(p1.y).toBeLessThan(p4.y);
    expect(p5.x).toBeGreaterThan(0);
    expect(p5.y).toBeCloseTo(p4.y);
    expect(p8.y).toBeCloseTo(p1.y);
  });

  it('generates parametric families and rejects unknown ids', () => {
    expect(getFootprint('DIP-28')!.pads).toHaveLength(28);
    expect(getFootprint('HDR-2x5')!.pads).toHaveLength(10);
    expect(getFootprint('TQFP-32')!.pads).toHaveLength(32);
    expect(getFootprint('TSSOP-20')!.pads).toHaveLength(20);
    expect(getFootprint('DIP-7')).toBeNull();
    expect(getFootprint('BGA-256')).toBeNull();
  });
});

describe('pcb board editing', () => {
  it('rotates pads clockwise and keeps nets through a move', () => {
    const board = new PcbBoard();
    board.setBoard({ width: 20, height: 20 });
    board.addComponents([{ ref: 'R1', footprint: '0603', x: 10, y: 10, rotation: 90 }]);
    const r1 = board.design.components[0];
    // 旋转 90°（顺时针）后 1 脚在上方
    expect(r1.pads[0].x).toBeCloseTo(10);
    expect(r1.pads[0].y).toBeCloseTo(9.175);
    expect(r1.pads[0].w).toBeCloseTo(0.95);
    board.addComponents([{ ref: 'R2', footprint: '0603', x: 10, y: 15 }]);
    board.setNets([{ name: 'A', pins: ['R1.1', 'R2.1'] }]);
    board.moveComponents([{ ref: 'R1', x: 5, y: 5 }]);
    expect(board.design.components[0].pads[0].net).toBe('A');
  });

  it('reports bad input as tool errors instead of throwing', () => {
    const board = new PcbBoard();
    expect(executeTool(board, 'add_components', { components: [{ ref: 'R1', footprint: 'NOPE', x: 1, y: 1 }] }).ok).toBe(false);
    expect(executeTool(board, 'add_components', { components: 'oops' }).ok).toBe(false);
    expect(executeTool(board, 'set_nets', { nets: [{ name: 'A', pins: ['R9.1'] }] }).text).toMatch(/does not exist/);
    expect(executeTool(board, 'no_such_tool', {}).ok).toBe(false);
  });
});

describe('pcb DRC', () => {
  it('flags unconnected nets, shorts, overlaps and parts outside the outline', () => {
    const board = new PcbBoard();
    board.setBoard({ width: 20, height: 10 });
    board.addComponents([
      { ref: 'R1', footprint: '0603', x: 5, y: 5 },
      { ref: 'R2', footprint: '0603', x: 15, y: 5 },
      { ref: 'R3', footprint: '0603', x: 15.5, y: 5 },
      { ref: 'R4', footprint: '0603', x: 19.5, y: 9 },
    ]);
    board.setNets([
      { name: 'A', pins: ['R1.2', 'R2.1'] },
      { name: 'B', pins: ['R1.1', 'R4.1'] },
    ]);
    // 网络 B 的走线横穿网络 A 的焊盘
    board.addTrace({ net: 'B', layer: 'F.Cu', points: [[4.175, 5], [8, 5]] });
    const types = new Set(runDrc(board.design).violations.map((v) => v.type));
    expect(types).toContain('unconnected');
    expect(types).toContain('short');
    expect(types).toContain('overlap');
    expect(types).toContain('outside');
  });

  it('treats a trace between two pad centres as a connection', () => {
    const board = new PcbBoard();
    board.setBoard({ width: 20, height: 10 });
    board.addComponents([
      { ref: 'R1', footprint: '0603', x: 5, y: 5 },
      { ref: 'R2', footprint: '0603', x: 12, y: 5 },
    ]);
    board.setNets([{ name: 'A', pins: ['R1.2', 'R2.1'] }]);
    expect(runDrc(board.design).unrouted).toBe(1);
    board.addTrace({ net: 'A', layer: 'F.Cu', points: [[5.825, 5], [11.175, 5]] });
    const report = runDrc(board.design);
    expect(report.unrouted).toBe(0);
    expect(report.errors).toBe(0);
  });
});

describe('pcb autorouter', () => {
  it('routes around an obstacle and uses a via when the top layer is walled off', () => {
    const board = new PcbBoard();
    board.setBoard({ width: 20, height: 12 });
    board.addComponents([
      { ref: 'R1', footprint: '0603', x: 4, y: 6 },
      { ref: 'R2', footprint: '0603', x: 16, y: 6 },
      { ref: 'J1', footprint: 'HDR-1x2', x: 10, y: 3 },
      { ref: 'J2', footprint: 'HDR-1x2', x: 10, y: 9 },
    ]);
    board.setNets([
      { name: 'SIG', pins: ['R1.2', 'R2.1'] },
      { name: 'WALL', pins: ['J1.1', 'J1.2', 'J2.1', 'J2.2'] },
    ]);
    // 顶层有一道贯穿全板的墙，只能打过孔从底层绕过去
    board.addTrace({ net: 'WALL', layer: 'F.Cu', points: [[10, 0.6], [10, 11.4]] });
    const [sig] = routeNets(board.design, ['SIG']);
    expect(sig.ok).toBe(true);
    expect(sig.vias).toBeGreaterThanOrEqual(2);
    const report = runDrc(board.design);
    expect(report.violations.filter((v) => v.type !== 'unconnected')).toEqual([]);
  });

  it('escapes fine-pitch TSSOP pads without clearance violations', () => {
    const board = new PcbBoard();
    board.setBoard({ width: 30, height: 20 });
    board.addComponents([
      { ref: 'U1', footprint: 'TSSOP-14', x: 15, y: 10 },
      { ref: 'J1', footprint: 'HDR-1x7', x: 4, y: 10 },
      { ref: 'J2', footprint: 'HDR-1x7', x: 26, y: 10 },
    ]);
    const nets = [];
    for (let i = 1; i <= 7; i++) {
      nets.push({ name: `L${i}`, pins: [`U1.${i}`, `J1.${i}`] });
      nets.push({ name: `R${i}`, pins: [`U1.${15 - i}`, `J2.${i}`] });
    }
    board.setNets(nets);
    const results = routeNets(board.design);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(runDrc(board.design).errors).toBe(0);
  });

  it('builds the bundled example board with a clean DRC', () => {
    const { design, drc } = buildExample();
    expect(design.components).toHaveLength(9);
    expect(drc.violations).toEqual([]);
    expect(drc.unrouted).toBe(0);
    expect(design.traces.length).toBeGreaterThan(0);
  });
});
