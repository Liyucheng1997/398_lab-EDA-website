import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { PcbRunEvent } from '@webeda/shared';
import { runPcbAgent, type CallModel } from '../src/pcb/agent';
import { PcbBoard } from '../src/pcb/board';
import { EXAMPLE_SCRIPT } from '../src/pcb/example';

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

let seq = 0;
function reply(blocks: unknown[], stop_reason: string = blocks.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn'): BetaMessage {
  return {
    id: `msg_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'scripted-model',
    content: blocks,
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
  } as unknown as BetaMessage;
}
const text = (t: string) => ({ type: 'text', text: t });
const use = (name: string, input: unknown) => ({ type: 'tool_use', id: `toolu_${++seq}`, name, input });

/** 按脚本逐轮作答的模型替身；同时记录每轮收到的对话历史 */
function scripted(turns: BetaMessage[]): { call: CallModel; seen: BetaMessageParam[][] } {
  const seen: BetaMessageParam[][] = [];
  let i = 0;
  return {
    seen,
    call: async (messages, hooks) => {
      seen.push(structuredClone(messages));
      const msg = turns[i++];
      if (!msg) throw new Error('脚本用完了');
      for (const b of msg.content) if (b.type === 'text') hooks.onText(b.text);
      return msg;
    },
  };
}

async function run(turns: BetaMessage[], opts: { maxTurns?: number; board?: PcbBoard; continuing?: boolean } = {}) {
  const board = opts.board ?? new PcbBoard();
  const events: PcbRunEvent[] = [];
  const model = scripted(turns);
  const outcome = await runPcbAgent({
    prompt: '做一个 555 闪灯板',
    board,
    continuing: opts.continuing ?? false,
    callModel: model.call,
    emit: (ev) => events.push(ev),
    signal: new AbortController().signal,
    maxTurns: opts.maxTurns ?? 20,
  });
  return { outcome, events, board, seen: model.seen };
}

describe('pcb agent loop', () => {
  it('drives a whole design through tool calls and finishes with a clean DRC', async () => {
    const turns = [
      ...EXAMPLE_SCRIPT.map((step) => reply([text(`调用 ${step.name}`), use(step.name, step.input)])),
      reply([use('run_drc', {})]),
      reply([text('设计完成。')]),
    ];
    const { outcome, events, board, seen } = await run(turns);
    expect(outcome.status).toBe('succeeded');
    expect(outcome.usage.turns).toBe(turns.length);
    expect(outcome.usage.inputTokens).toBe(100 * turns.length);
    expect(board.design.components).toHaveLength(9);

    const last = [...events].reverse().find((e) => e.type === 'design') as Extract<PcbRunEvent, { type: 'design' }>;
    expect(last.drc.errors).toBe(0);
    expect(events.filter((e) => e.type === 'tool').every((e) => e.type === 'tool' && e.ok)).toBe(true);

    // 历史只追加：每一轮看到的消息都是下一轮的前缀，助手消息原样带回
    for (let i = 1; i < seen.length; i++) expect(seen[i].slice(0, seen[i - 1].length)).toEqual(seen[i - 1]);
    const drcResult = seen[seen.length - 1].at(-1)!;
    expect(drcResult.role).toBe('user');
    expect(JSON.stringify(drcResult.content)).toContain('DRC clean');
  });

  it('feeds tool errors back to the model instead of failing the run', async () => {
    const { outcome, seen, events } = await run([
      reply([use('add_components', { components: [{ ref: 'U1', footprint: 'QFN-999', x: 5, y: 5 }] })]),
      reply([text('换一个封装。')]),
    ]);
    expect(outcome.status).toBe('succeeded');
    const result = (seen[1].at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/Unknown footprint/);
    expect(events.some((e) => e.type === 'tool' && !e.ok)).toBe(true);
  });

  it('reminds the model once when it stops with DRC errors', async () => {
    const setup = [
      reply([use('set_board', { width: 20, height: 10 })]),
      reply([use('add_components', { components: [{ ref: 'R1', footprint: '0603', x: 5, y: 5 }, { ref: 'R2', footprint: '0603', x: 15, y: 5 }] })]),
      reply([use('set_nets', { nets: [{ name: 'A', pins: ['R1.2', 'R2.1'] }] })]),
    ];
    const { outcome, seen } = await run([...setup, reply([text('完成了。')]), reply([text('确实布不通，原因是……')])]);
    expect(outcome.status).toBe('succeeded');
    expect(seen).toHaveLength(5);
    expect(String(seen[4].at(-1)!.content)).toMatch(/Automatic check/);
  });

  it('stops on a refusal without running that turn’s tools', async () => {
    const { outcome, board } = await run([reply([use('set_board', { width: 99, height: 99 })], 'refusal')]);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/拒绝/);
    expect(board.design.width).toBe(50);
  });

  it('gives up at the turn limit', async () => {
    const { outcome } = await run([reply([use('get_board', {})]), reply([use('get_board', {})]), reply([use('get_board', {})])], { maxTurns: 2 });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/2 轮上限/);
  });

  it('includes the current board state when continuing an existing design', async () => {
    const board = new PcbBoard();
    board.setBoard({ width: 20, height: 10 });
    board.addComponents([{ ref: 'R1', footprint: '0603', x: 5, y: 5 }]);
    const { seen } = await run([reply([text('好的。')])], { board, continuing: true });
    expect(String(seen[0][0].content)).toContain('R1 0603');
  });
});
