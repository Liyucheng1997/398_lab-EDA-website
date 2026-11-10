/**
 * AI 电路板设计智能体：把用户的一句话需求交给 Claude，由它通过工具自己完成
 * 电路设计 → 选型 → 布局 → 布线 → DRC，全程不需要人参与。
 *
 * 这里只有循环本身；模型调用通过 CallModel 注入（真实实现见 claude.ts，测试里用脚本替身）。
 * 对话历史只追加、不改写——Claude Fable 5.2 会校验带思考块的历史是否被改动过。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { PcbDesign, PcbRunEvent, PcbRunStatus, PcbUsage } from '@webeda/shared';
import { PcbBoard } from './board';
import { formatDrc, runDrc } from './drc';
import { FOOTPRINT_CATALOG } from './footprints';
import { executeTool } from './tools';

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

export interface ModelHooks {
  onText(delta: string): void;
  onThinking(delta: string): void;
}

/** 调用一次模型并返回完整的消息（流式增量通过 hooks 送出） */
export type CallModel = (messages: BetaMessageParam[], hooks: ModelHooks, signal: AbortSignal) => Promise<BetaMessage>;

export const SYSTEM_PROMPT = `You are the PCB design engine inside WebEDA, a browser-based EDA tool. A user describes a circuit board in plain language and you design it completely with the tools: the circuit, the parts, the placement and the routing. Nobody can answer questions during the run, so make reasonable engineering decisions yourself and state the important ones in your final summary.

## The board model
- Units are millimetres. The origin is the board's top-left corner; x grows to the right and y grows downward.
- There are two copper layers, F.Cu (top) and B.Cu (bottom). All components sit on the top side. Through-hole pads exist on both layers, and a via joins the two layers.
- Rotation is 0, 90, 180 or 270 degrees, clockwise as seen on screen. Tool results report absolute pad positions, so read them instead of working rotations out by hand.
- Default rules: 0.2 mm clearance, 0.25 mm signal traces, 0.5 mm power traces, 0.6/0.3 mm vias, and copper stays 0.3 mm from the board edge. There are no copper pours or planes, so ground and supply are routed as wide traces.

## Footprint catalog
${FOOTPRINT_CATALOG}
These are nominal land patterns. For any other part, call define_footprint with dimensions from its datasheet. The autorouter cannot escape pads finer than 0.65 mm pitch, so prefer packages at or above that pitch.

## How a good run goes
Work out the circuit first: every part with its value, and every net, including the decoupling capacitors, pull-ups, current-limiting resistors, connectors and anything else the circuit needs in order to actually work. Then set the board outline, place the components, define the nets, route, and check.
Placement decides whether routing succeeds. Put connectors at the edges where a person can reach them, keep decoupling capacitors next to the supply pins they serve, keep parts that share nets close together with their connected pads facing each other, and leave routing channels between parts. A slightly larger board that routes cleanly is better than a crowded one that does not.
The route tool does the bulk of the routing. When a net fails, the cause is almost always placement or routing order: move parts, clear and re-route in a different order, or draw the stubborn connection by hand with add_trace and add_via.
The design is finished when run_drc reports no errors. Run it after routing and keep fixing until it is clean. If something truly cannot be fixed, say exactly what is left and why.

## Final message
End with a short summary in the language the user wrote in: what the board does, the main parts and design decisions, the board size, and the DRC result. Mention what the user should verify before fabrication, since this tool does no electrical simulation and the footprints are nominal. A brief note between tool calls about what you are doing is welcome; long explanations are not needed.`;

export interface AgentOptions {
  prompt: string;
  /** 在已有设计上继续修改 */
  board: PcbBoard;
  /** 传入的设计是否非空（决定第一条消息里要不要附上当前状态） */
  continuing: boolean;
  callModel: CallModel;
  emit(ev: PcbRunEvent): void;
  signal: AbortSignal;
  maxTurns: number;
}

export interface AgentOutcome {
  status: PcbRunStatus;
  error?: string;
  usage: PcbUsage;
  /** 实际作答的模型（发生回退时与请求的模型不同） */
  model?: string;
}

export async function runPcbAgent(opts: AgentOptions): Promise<AgentOutcome> {
  const { board, emit, signal } = opts;
  const usage: PcbUsage = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let model: string | undefined;
  const snapshot = () => emit({ type: 'design', design: structuredClone(board.design) as PcbDesign, drc: runDrc(board.design) });

  const messages: BetaMessageParam[] = [
    {
      role: 'user',
      content: opts.continuing
        ? `${opts.prompt}\n\nThe board below already exists. Change it as requested and keep everything that does not need to change.\n\n${board.describe()}\n\n${formatDrc(runDrc(board.design))}`
        : opts.prompt,
    },
  ];
  let nudged = false;
  let jsonRetries = 0;

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    if (signal.aborted) return { status: 'cancelled', usage, model };
    emit({ type: 'turn', turn });

    let message: BetaMessage;
    try {
      message = await opts.callModel(messages, { onText: (text) => emit({ type: 'text', text }), onThinking: (text) => emit({ type: 'thinking', text }) }, signal);
      jsonRetries = 0;
    } catch (err) {
      if (signal.aborted) return { status: 'cancelled', usage, model };
      // 流式工具参数无法解析成 JSON 时 SDK 会抛普通错误：重发这一轮；API 错误原样上抛
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      turn--;
      continue;
    }

    usage.turns++;
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    model = message.model;
    emit({ type: 'usage', usage: { ...usage } });

    // 拒绝可能发生在工具参数写到一半的时候，这一轮的工具一律不执行
    if (message.stop_reason === 'refusal') {
      return { status: 'failed', error: `模型拒绝了这个请求${message.stop_details?.explanation ? `：${message.stop_details.explanation}` : ''}`, usage, model };
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      return { status: 'failed', error: '模型输出在工具调用中途被截断（max_tokens），设计没有完成', usage, model };
    }

    messages.push({ role: 'assistant', content: message.content });

    if (!toolUses.length) {
      if (message.stop_reason === 'pause_turn') continue;
      const drc = runDrc(board.design);
      if (drc.errors && !nudged && turn < opts.maxTurns) {
        // 模型收工时 DRC 还有错误：自动提醒一次，替代人工检查
        nudged = true;
        emit({ type: 'tool', name: 'auto_check', summary: `自动检查：DRC 还有 ${drc.errors} 个错误，要求继续修复`, ok: false });
        messages.push({
          role: 'user',
          content: `[Automatic check, not the user] The design rule check still fails:\n${formatDrc(drc)}\n\nKeep working until it is clean. If an item truly cannot be fixed, explain why in your final summary and stop.`,
        });
        continue;
      }
      return { status: 'succeeded', usage, model };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let mutated = false;
    for (const use of toolUses) {
      const r = executeTool(board, use.name, use.input);
      mutated ||= r.mutated;
      emit({ type: 'tool', name: use.name, summary: r.summary, ok: r.ok });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
    }
    if (mutated) snapshot();
    messages.push({ role: 'user', content: results });
  }

  return { status: 'failed', error: `已达到 ${opts.maxTurns} 轮上限，设计可能没有完成`, usage, model };
}
