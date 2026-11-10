import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { PcbAiStatus, PcbRunEvent, PcbSnapshot } from '@webeda/shared';
import { EXAMPLE_SCRIPT } from '../src/pcb/example';
import { pcbRouter, setPcbCallerFactory } from '../src/routes/pcb';

type BetaMessage = Anthropic.Beta.BetaMessage;

let server: Server;
let base = '';
const savedKey = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/pcb', pcbRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pcb`;
});

afterAll(() => {
  server.close();
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

/** 按示例脚本逐轮调用工具、最后收工的模型替身（不访问网络） */
function scriptedFactory(steps: { name: string; input: unknown }[]) {
  return () => {
    let i = 0;
    return async (): Promise<BetaMessage> => {
      const step = steps[i++];
      return {
        id: `msg_${i}`,
        type: 'message',
        role: 'assistant',
        model: 'scripted-model',
        content: step ? [{ type: 'tool_use', id: `toolu_${i}`, name: step.name, input: step.input }] : [{ type: 'text', text: '完成。' }],
        stop_reason: step ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      } as unknown as BetaMessage;
    };
  };
}

async function readEvents(id: string): Promise<PcbRunEvent[]> {
  const res = await fetch(`${base}/runs/${id}/events`);
  const text = await res.text(); // 服务端在 end 之后关闭连接
  return text
    .split('\n\n')
    .map((chunk) => /^data: (.*)$/m.exec(chunk)?.[1])
    .filter((d): d is string => !!d)
    .map((d) => JSON.parse(d) as PcbRunEvent);
}

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('pcb routes', () => {
  it('serves the bundled example board', async () => {
    const snap = (await (await fetch(`${base}/example`)).json()) as PcbSnapshot;
    expect(snap.design.name).toBe('NE555 闪灯');
    expect(snap.drc.errors).toBe(0);
  });

  it('refuses runs when no API credentials are configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const status = (await (await fetch(`${base}/status`)).json()) as PcbAiStatus;
    // 本机可能通过 `ant auth login` 配过 profile，这种情况下 available 为 true，跳过断言
    if (status.available) return;
    expect(status.model).toBe('claude-fable-5-2');
    expect((await post('/runs', { prompt: '做一块板子' })).status).toBe(503);
  });

  it('runs a design end to end over SSE and accepts the result as the base of a follow-up run', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
    expect((await post('/runs', { prompt: '   ' })).status).toBe(400);

    setPcbCallerFactory(scriptedFactory(EXAMPLE_SCRIPT));
    const created = await post('/runs', { prompt: '做一个 555 闪灯板' });
    expect(created.status).toBe(201);
    const events = await readEvents(((await created.json()) as { id: string }).id);
    const end = events.at(-1) as Extract<PcbRunEvent, { type: 'end' }>;
    expect(end.type).toBe('end');
    expect(end.status).toBe('succeeded');
    expect(end.model).toBe('scripted-model');
    expect(end.design.components).toHaveLength(9);
    expect(end.drc.errors).toBe(0);
    expect(end.usage.turns).toBe(EXAMPLE_SCRIPT.length + 1);
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(EXAMPLE_SCRIPT.length);

    // 把结果原样传回去继续修改：服务端重建设计后应与原设计一致
    setPcbCallerFactory(scriptedFactory([{ name: 'run_drc', input: {} }]));
    const again = await post('/runs', { prompt: '检查一下', design: end.design });
    expect(again.status).toBe(201);
    const end2 = (await readEvents(((await again.json()) as { id: string }).id)).at(-1) as Extract<PcbRunEvent, { type: 'end' }>;
    expect(end2.status).toBe('succeeded');
    expect(end2.design).toEqual(end.design);

    // 被篡改的设计数据会被拒绝
    const bad = await post('/runs', { prompt: 'x', design: { ...end.design, components: [{ ...end.design.components[0], footprint: 'NOPE' }] } });
    expect(bad.status).toBe(400);
  });
});
