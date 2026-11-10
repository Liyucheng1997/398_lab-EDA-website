/**
 * AI 设计电路板时可以调用的工具。每个工具 = 名称 + 给模型看的说明 + 参数 schema + 在 PcbBoard 上的执行函数。
 * text 返回给模型；summary 是界面活动日志里的一句中文。
 */
import { z } from 'zod';
import { PcbBoard, BoardError } from './board';
import { formatDrc, runDrc } from './drc';
import { routeNets } from './router';

export interface ToolOutcome {
  text: string;
  summary: string;
}

export interface PcbTool {
  name: string;
  description: string;
  schema: z.ZodType;
  /** 是否会修改设计（修改后向前端推送新的快照） */
  mutates: boolean;
  run(board: PcbBoard, input: never): ToolOutcome;
}

function tool<S extends z.ZodType>(def: { name: string; description: string; schema: S; mutates: boolean; run(board: PcbBoard, input: z.infer<S>): ToolOutcome }): PcbTool {
  return def as unknown as PcbTool;
}

const point = z.tuple([z.number(), z.number()]);
const layer = z.enum(['F.Cu', 'B.Cu']);

export const PCB_TOOLS: PcbTool[] = [
  tool({
    name: 'set_board',
    description:
      'Set the board outline (a rectangle with its top-left corner at the origin) and optional mounting holes. Call this first; calling it again resizes the board and keeps everything already on it.',
    mutates: true,
    schema: z.object({
      name: z.string().describe('Short board name').optional(),
      description: z.string().describe('One or two sentences on what the board does').optional(),
      width: z.number().describe('Board width in mm (x extent)'),
      height: z.number().describe('Board height in mm (y extent)'),
      holes: z.array(z.object({ x: z.number(), y: z.number(), diameter: z.number().describe('Hole diameter in mm, e.g. 3.2 for M3') })).describe('Mounting holes; replaces the existing list').optional(),
    }),
    run: (board, input) => ({ text: board.setBoard(input), summary: `板框 ${input.width} × ${input.height} mm${input.holes?.length ? `，${input.holes.length} 个安装孔` : ''}` }),
  }),
  tool({
    name: 'define_footprint',
    description:
      'Define a custom footprint for a part that is not in the built-in catalog (connectors, modules, unusual packages). Pad coordinates are relative to the footprint origin at rotation 0, in mm, with y pointing down. Pads are axis-aligned rectangles or round/oval; give drill for through-hole pads. Take dimensions from the datasheet land pattern.',
    mutates: true,
    schema: z.object({
      id: z.string().describe('New footprint id, e.g. USB-C-16P'),
      description: z.string().optional(),
      pads: z.array(
        z.object({
          num: z.string().describe('Pad number or name, unique within the footprint'),
          x: z.number(),
          y: z.number(),
          w: z.number().describe('Pad size along x'),
          h: z.number().describe('Pad size along y'),
          shape: z.enum(['rect', 'round']).optional(),
          drill: z.number().describe('Drill diameter for through-hole pads').optional(),
        }),
      ),
      body_width: z.number().describe('Courtyard width (x) centred on the origin'),
      body_height: z.number().describe('Courtyard height (y) centred on the origin'),
    }),
    run: (board, input) => ({ text: board.defineFootprint(input), summary: `自定义封装 ${input.id}（${input.pads.length} 个焊盘）` }),
  }),
  tool({
    name: 'add_components',
    description:
      'Place components on the top side. x, y is the footprint origin (its centre) in mm; rotation is 0, 90, 180 or 270 degrees clockwise as seen on screen. The result lists every pad with its absolute position, which is what you need for manual traces.',
    mutates: true,
    schema: z.object({
      components: z.array(
        z.object({
          ref: z.string().describe('Reference designator, e.g. R1, C3, U1, J2'),
          footprint: z.string().describe('Footprint id from the catalog or a custom one'),
          value: z.string().describe('Value or part number, e.g. 10k, 100nF, NE555').optional(),
          x: z.number(),
          y: z.number(),
          rotation: z.number().optional(),
        }),
      ),
    }),
    run: (board, input) => ({
      text: board.addComponents(input.components),
      summary: `放置 ${input.components.length} 个元件：${input.components.map((c) => c.ref).join(' ')}`,
    }),
  }),
  tool({
    name: 'move_components',
    description: 'Move and/or rotate existing components. Routing of the nets attached to a moved component is removed and must be routed again.',
    mutates: true,
    schema: z.object({ moves: z.array(z.object({ ref: z.string(), x: z.number(), y: z.number(), rotation: z.number().optional() })) }),
    run: (board, input) => ({ text: board.moveComponents(input.moves), summary: `移动 ${input.moves.map((m) => m.ref).join(' ')}` }),
  }),
  tool({
    name: 'remove_components',
    description: 'Delete components. Their pins are removed from all nets.',
    mutates: true,
    schema: z.object({ refs: z.array(z.string()) }),
    run: (board, input) => ({ text: board.removeComponents(input.refs), summary: `删除 ${input.refs.join(' ')}` }),
  }),
  tool({
    name: 'set_nets',
    description:
      'Create or replace nets (the schematic connections). Each net lists its pins as REF.PAD, e.g. "U1.8". A net with the same name is replaced; an empty pin list deletes it. Use class "power" for supply and ground nets so they get the wider trace. A pin can belong to only one net.',
    mutates: true,
    schema: z.object({
      nets: z.array(z.object({ name: z.string().describe('Net name, e.g. GND, VCC, SDA'), pins: z.array(z.string()), class: z.enum(['signal', 'power']).optional() })),
    }),
    run: (board, input) => ({ text: board.setNets(input.nets), summary: `定义 ${input.nets.length} 个网络：${input.nets.map((n) => n.name).join(' ')}` }),
  }),
  tool({
    name: 'route',
    description:
      'Run the built-in two-layer autorouter. Without "nets" it routes every net that is not fully connected (signal nets shortest first, then power nets). With "nets" it routes just those, in the order given, which lets you decide what gets the best paths. Already routed copper is kept and treated as an obstacle for other nets. The result reports each net and why any connection failed.',
    mutates: true,
    schema: z.object({ nets: z.array(z.string()).describe('Net names to route, in order').optional() }),
    run: (board, input) => {
      let results;
      try {
        results = routeNets(board.design, input.nets);
      } catch (e) {
        throw new BoardError((e as Error).message);
      }
      const done = results.filter((r) => r.ok).length;
      const lines = results.map((r) =>
        r.ok
          ? `${r.net}: connected${r.routed ? ` (+${r.length} mm, ${r.vias} via(s))` : ' (was already complete)'}`
          : `${r.net}: ${r.missing} connection(s) still missing — ${r.reason ?? 'unknown reason'}`,
      );
      return {
        text: `Routed ${done} of ${results.length} net(s).\n${lines.join('\n')}`,
        summary: `自动布线：${done}/${results.length} 个网络连通`,
      };
    },
  }),
  tool({
    name: 'add_trace',
    description:
      'Draw one trace by hand as a polyline on a single layer. Use it where the autorouter fails or where you want a specific path. A trace connects to a pad, via or another trace of the same net when their copper overlaps, so start and end exactly on pad centres or existing trace points. Default width follows the net class.',
    mutates: true,
    schema: z.object({ net: z.string(), layer, points: z.array(point).describe('[[x, y], ...] in mm'), width: z.number().optional() }),
    run: (board, input) => ({ text: board.addTrace(input), summary: `手工走线 ${input.net}（${input.layer}，${input.points.length} 个点）` }),
  }),
  tool({
    name: 'add_via',
    description: 'Place a via that joins F.Cu and B.Cu for a net. Traces on both layers must end on the via centre.',
    mutates: true,
    schema: z.object({ net: z.string(), x: z.number(), y: z.number() }),
    run: (board, input) => ({ text: board.addVia(input), summary: `过孔 ${input.net} @ (${input.x}, ${input.y})` }),
  }),
  tool({
    name: 'clear_routes',
    description: 'Remove traces and vias: of the given nets, or of the whole board when "nets" is omitted. Components and nets are kept.',
    mutates: true,
    schema: z.object({ nets: z.array(z.string()).optional() }),
    run: (board, input) => ({ text: board.clearRoutes(input.nets), summary: input.nets?.length ? `拆线 ${input.nets.join(' ')}` : '拆除全部走线' }),
  }),
  tool({
    name: 'set_silkscreen',
    description: 'Replace the silkscreen text labels (board name, connector pin names, polarity marks). Reference designators are drawn automatically. x, y is the text centre.',
    mutates: true,
    schema: z.object({ texts: z.array(z.object({ text: z.string(), x: z.number(), y: z.number(), size: z.number().describe('Text height in mm, default 1').optional() })) }),
    run: (board, input) => ({ text: board.setTexts(input.texts), summary: `丝印 ${input.texts.length} 处文字` }),
  }),
  tool({
    name: 'run_drc',
    description:
      'Run the design rule check: unconnected nets, shorts, clearance, overlapping components, parts outside the outline, copper too close to the edge or to mounting holes. The board is finished only when this reports no errors.',
    mutates: false,
    schema: z.object({}),
    run: (board) => {
      const report = runDrc(board.design);
      return { text: formatDrc(report), summary: report.errors ? `DRC：${report.errors} 个错误，缺 ${report.unrouted} 条连接` : 'DRC 通过' };
    },
  }),
  tool({
    name: 'get_board',
    description: 'Return the full current state: outline, rules, every component with absolute pad positions, every net, and routing totals.',
    mutates: false,
    schema: z.object({}),
    run: (board) => ({ text: board.describe(), summary: '查看当前电路板' }),
  }),
];

export interface ToolCallResult {
  ok: boolean;
  text: string;
  summary: string;
  mutated: boolean;
}

/** 执行一次工具调用。输入先过 schema 校验；任何错误都变成给模型的错误文本，不抛出 */
export function executeTool(board: PcbBoard, name: string, rawInput: unknown): ToolCallResult {
  const def = PCB_TOOLS.find((t) => t.name === name);
  if (!def) return { ok: false, text: `Unknown tool "${name}".`, summary: `未知工具 ${name}`, mutated: false };
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ');
    return { ok: false, text: `Invalid input for ${name}: ${issues}. Received: ${JSON.stringify(rawInput).slice(0, 400)}`, summary: `${name} 参数无效`, mutated: false };
  }
  try {
    const out = def.run(board, parsed.data as never);
    return { ok: true, ...out, mutated: def.mutates };
  } catch (e) {
    if (e instanceof BoardError) return { ok: false, text: e.message, summary: `${name} 失败：${e.message}`, mutated: false };
    throw e;
  }
}
