/**
 * 内置示例板：NE555 闪灯电路。它不是 AI 生成的——是一段固定的工具调用脚本，
 * 用来在没有 API 凭据时预览界面，也作为布线器与 DRC 的回归用例。
 */
import type { PcbSnapshot } from '@webeda/shared';
import { PcbBoard } from './board';
import { runDrc } from './drc';
import { executeTool } from './tools';

export const EXAMPLE_SCRIPT: { name: string; input: unknown }[] = [
  {
    name: 'set_board',
    input: {
      name: 'NE555 闪灯',
      description: 'NE555 无稳态多谐振荡器驱动一颗 LED，约 1.5 Hz 闪烁，5 V 供电。',
      width: 30,
      height: 20,
      holes: [
        { x: 2.5, y: 2.5, diameter: 2.2 },
        { x: 27.5, y: 17.5, diameter: 2.2 },
      ],
    },
  },
  {
    name: 'add_components',
    input: {
      components: [
        { ref: 'J1', footprint: 'HDR-1x2', value: '5V', x: 3.5, y: 11 },
        { ref: 'U1', footprint: 'SOIC-8', value: 'NE555', x: 15, y: 10 },
        { ref: 'C3', footprint: '0603', value: '100nF', x: 9, y: 5.5 },
        { ref: 'R1', footprint: '0603', value: '1k', x: 21, y: 6.5 },
        { ref: 'R2', footprint: '0603', value: '470k', x: 21, y: 9.5 },
        { ref: 'C1', footprint: '0805', value: '1uF', x: 9, y: 14.5 },
        { ref: 'C2', footprint: '0603', value: '10nF', x: 21, y: 13.5 },
        { ref: 'R3', footprint: '0603', value: '330', x: 14, y: 16.5 },
        { ref: 'D1', footprint: 'LED-0805', value: '红色', x: 21, y: 16.5 },
      ],
    },
  },
  {
    name: 'set_nets',
    input: {
      nets: [
        { name: 'VCC', class: 'power', pins: ['J1.1', 'U1.8', 'U1.4', 'R1.1', 'C3.1'] },
        { name: 'GND', class: 'power', pins: ['J1.2', 'U1.1', 'C1.2', 'C2.2', 'C3.2', 'D1.1'] },
        { name: 'DIS', pins: ['U1.7', 'R1.2', 'R2.1'] },
        { name: 'THR', pins: ['U1.6', 'U1.2', 'R2.2', 'C1.1'] },
        { name: 'CTRL', pins: ['U1.5', 'C2.1'] },
        { name: 'OUT', pins: ['U1.3', 'R3.1'] },
        { name: 'LED_A', pins: ['R3.2', 'D1.2'] },
      ],
    },
  },
  { name: 'route', input: {} },
  {
    name: 'set_silkscreen',
    input: {
      texts: [
        { text: 'NE555 BLINK', x: 15, y: 2.2, size: 1.2 },
        { text: '+5V', x: 7, y: 9.7, size: 0.9 },
        { text: 'GND', x: 7, y: 12.3, size: 0.9 },
      ],
    },
  },
];

let cached: PcbSnapshot | null = null;

export function buildExample(): PcbSnapshot {
  if (cached) return structuredClone(cached);
  const board = new PcbBoard();
  for (const step of EXAMPLE_SCRIPT) {
    const r = executeTool(board, step.name, step.input);
    if (!r.ok) throw new Error(`示例板脚本出错（${step.name}）：${r.text}`);
  }
  cached = { design: board.design, drc: runDrc(board.design) };
  return structuredClone(cached);
}
