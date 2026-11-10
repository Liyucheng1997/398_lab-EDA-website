import { Router } from 'express';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { PcbRunEvent, PcbRunStatus, PcbUsage } from '@webeda/shared';
import { config } from '../config';
import { runPcbAgent, type CallModel } from '../pcb/agent';
import { BoardError, PcbBoard } from '../pcb/board';
import { aiStatus, createClaudeCaller, describeApiError } from '../pcb/claude';
import { runDrc } from '../pcb/drc';
import { buildExample } from '../pcb/example';

export const pcbRouter = Router();

const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

type Listener = (ev: PcbRunEvent) => void;

interface RunRecord {
  events: PcbRunEvent[];
  listeners: Set<Listener>;
  abort: AbortController;
  status: PcbRunStatus;
  finishedAt?: number;
}

const runs = new Map<string, RunRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of runs) if (rec.finishedAt && now - rec.finishedAt > config.jobTtlMs) runs.delete(id);
}, 5 * 60 * 1000).unref();

/* 客户端传来的设计不可信：只取必要字段，再通过 PcbBoard 的编辑操作重建一遍，所有校验都会重新执行 */
const num = z.number().finite();
const designSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  width: num,
  height: num,
  holes: z.array(z.object({ x: num, y: num, diameter: num })).max(40),
  customFootprints: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().optional(),
        pads: z.array(z.object({ num: z.string(), x: num, y: num, w: num, h: num, shape: z.enum(['rect', 'round']), drill: num.optional() })),
        body: z.object({ x1: num, y1: num, x2: num, y2: num }),
      }),
    )
    .max(50),
  components: z.array(z.object({ ref: z.string(), footprint: z.string(), value: z.string(), x: num, y: num, rotation: num })).max(300),
  nets: z.array(z.object({ name: z.string(), pins: z.array(z.string()), class: z.enum(['signal', 'power']) })).max(500),
  traces: z.array(z.object({ net: z.string(), layer: z.enum(['F.Cu', 'B.Cu']), width: num, points: z.array(z.tuple([num, num])).min(2).max(2000) })).max(5000),
  vias: z.array(z.object({ net: z.string(), x: num, y: num })).max(2000),
  texts: z.array(z.object({ text: z.string(), x: num, y: num, size: num })).max(60),
});

function loadDesign(raw: unknown): PcbBoard {
  const d = designSchema.parse(raw);
  const board = new PcbBoard();
  board.setBoard({ name: d.name, description: d.description, width: d.width, height: d.height, holes: d.holes });
  for (const f of d.customFootprints) {
    board.defineFootprint({ id: f.id, description: f.description, pads: f.pads, body_width: f.body.x2 - f.body.x1, body_height: f.body.y2 - f.body.y1 });
  }
  if (d.components.length) board.addComponents(d.components);
  if (d.nets.length) board.setNets(d.nets);
  for (const t of d.traces) board.addTrace(t);
  for (const v of d.vias) board.addVia(v);
  board.setTexts(d.texts);
  return board;
}

/** 测试时替换模型调用 */
let callerFactory: () => CallModel = createClaudeCaller;
export function setPcbCallerFactory(factory: () => CallModel) {
  callerFactory = factory;
}

pcbRouter.get('/status', (_req, res) => {
  res.json(aiStatus());
});

pcbRouter.get('/example', (_req, res) => {
  res.json(buildExample());
});

pcbRouter.post('/runs', (req, res) => {
  const status = aiStatus();
  if (!status.available) return void res.status(503).json({ error: status.reason });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return void res.status(400).json({ error: '请先描述想要的电路板' });
  if (prompt.length > config.ai.maxPromptChars) return void res.status(400).json({ error: `描述太长（上限 ${config.ai.maxPromptChars} 字）` });
  const active = [...runs.values()].filter((r) => r.status === 'running').length;
  if (active >= config.ai.maxConcurrentRuns) return void res.status(429).json({ error: '已有 AI 设计任务在运行，请等它结束或先取消' });

  let board: PcbBoard;
  const continuing = req.body.design != null;
  try {
    board = continuing ? loadDesign(req.body.design) : new PcbBoard();
  } catch (e) {
    const msg = e instanceof z.ZodError ? '设计数据格式不正确' : e instanceof BoardError ? `设计数据无效：${e.message}` : (e as Error).message;
    return void res.status(400).json({ error: msg });
  }

  const id = newId();
  const rec: RunRecord = { events: [], listeners: new Set(), abort: new AbortController(), status: 'running' };
  runs.set(id, rec);
  const emit = (ev: PcbRunEvent) => {
    // 补发历史时只需要最新的设计快照与用量
    if (ev.type === 'design' || ev.type === 'usage') rec.events = rec.events.filter((e) => e.type !== ev.type);
    rec.events.push(ev);
    for (const fn of rec.listeners) fn(ev);
  };

  const zero: PcbUsage = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  void (async () => {
    let outcome: { status: PcbRunStatus; error?: string; usage: PcbUsage; model?: string };
    try {
      outcome = await runPcbAgent({ prompt, board, continuing, callModel: callerFactory(), emit, signal: rec.abort.signal, maxTurns: config.ai.maxTurns });
    } catch (err) {
      const usage = rec.events.find((e): e is Extract<PcbRunEvent, { type: 'usage' }> => e.type === 'usage')?.usage ?? zero;
      if (rec.abort.signal.aborted) outcome = { status: 'cancelled', usage };
      else {
        console.error(`[pcb run ${id}]`, err);
        outcome = { status: 'failed', error: describeApiError(err), usage };
      }
    }
    rec.status = outcome.status;
    rec.finishedAt = Date.now();
    emit({
      type: 'end',
      status: outcome.status,
      error: outcome.status === 'cancelled' ? '已取消' : outcome.error,
      design: board.design,
      drc: runDrc(board.design),
      usage: outcome.usage,
      model: outcome.model ?? config.ai.model,
    });
    rec.listeners.clear();
  })();

  res.status(201).json({ id });
});

pcbRouter.get('/runs/:id/events', (req, res) => {
  const rec = runs.get(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (!rec) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: '任务不存在或已过期' })}\n\n`);
    return void res.end();
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  const send: Listener = (ev) => {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === 'end') {
      clearInterval(ping);
      res.end();
    }
  };
  for (const ev of rec.events) send(ev);
  if (rec.status !== 'running') return;
  rec.listeners.add(send);
  req.on('close', () => {
    clearInterval(ping);
    rec.listeners.delete(send);
  });
});

pcbRouter.post('/runs/:id/cancel', (req, res) => {
  const rec = runs.get(req.params.id);
  if (!rec) return void res.status(404).json({ error: '任务不存在' });
  rec.abort.abort();
  res.json({ ok: true });
});
