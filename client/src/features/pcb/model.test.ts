import { describe, expect, it } from 'vitest';
import type { PcbComponent, PcbDesign } from '@webeda/shared';
import { DEFAULT_PCB_RULES } from '@webeda/shared';
import { bomCsv, bomRows, compareRefs, designToSvg, pcbStats, safeBoardFileName } from './model';

function comp(ref: string, value: string, footprint: string): PcbComponent {
  return {
    ref,
    value,
    footprint,
    x: 5,
    y: 5,
    rotation: 0,
    pads: [
      { num: '1', x: 4, y: 5, w: 0.8, h: 0.9, shape: 'rect', net: 'A' },
      { num: '2', x: 6, y: 5, w: 1.6, h: 1.6, shape: 'round', drill: 0.8 },
    ],
    body: { x1: 3, y1: 4, x2: 7, y2: 6 },
  };
}

const design: PcbDesign = {
  name: '测试 <板>',
  description: '',
  width: 20,
  height: 10,
  holes: [{ x: 2, y: 2, diameter: 2 }],
  components: [comp('R10', '10k', '0603'), comp('R2', '10k', '0603'), comp('C1', '100nF, X7R', '0603')],
  nets: [
    { name: 'A', pins: ['R2.1', 'R10.1'], class: 'signal' },
    { name: 'B', pins: ['R2.2', 'C1.1'], class: 'power' },
    { name: 'NC', pins: ['C1.2'], class: 'signal' },
  ],
  traces: [{ net: 'A', layer: 'F.Cu', width: 0.25, points: [[0, 0], [3, 4], [3, 6]] }],
  vias: [{ net: 'A', x: 3, y: 6, diameter: 0.6, drill: 0.3 }],
  texts: [{ text: 'A&B', x: 10, y: 1, size: 1 }],
  rules: DEFAULT_PCB_RULES,
  customFootprints: [],
};

describe('pcb model', () => {
  it('sorts references naturally', () => {
    expect(['R10', 'C1', 'R2', 'U1'].sort(compareRefs)).toEqual(['C1', 'R2', 'R10', 'U1']);
  });

  it('groups the BOM by value and footprint', () => {
    expect(bomRows(design)).toEqual([
      { refs: ['C1'], value: '100nF, X7R', footprint: '0603' },
      { refs: ['R2', 'R10'], value: '10k', footprint: '0603' },
    ]);
    const csv = bomCsv(design);
    expect(csv).toContain('R2 R10,2,10k,0603');
    expect(csv).toContain('"100nF, X7R"');
  });

  it('counts routed nets from the ratsnest', () => {
    const stats = pcbStats(design, { violations: [], errors: 1, warnings: 0, unrouted: 1, ratsnest: [{ net: 'B', x1: 0, y1: 0, x2: 1, y2: 1 }] });
    expect(stats).toMatchObject({ components: 3, pads: 6, nets: 3, routedNets: 1, traceLength: 7, vias: 1 });
  });

  it('exports a standalone SVG with escaped text', () => {
    const svg = designToSvg(design);
    expect(svg).toContain('<title>测试 &lt;板&gt;</title>');
    expect(svg).toContain('A&amp;B');
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });

  it('makes safe file names', () => {
    expect(safeBoardFileName('NE555 闪灯: v1/2')).toBe('NE555_闪灯_v1_2');
    expect(safeBoardFileName('  ')).toBe('pcb');
  });
});
