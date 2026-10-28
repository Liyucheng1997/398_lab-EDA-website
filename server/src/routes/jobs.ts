import { Router } from 'express';
import fs from 'node:fs';
import type { JobEvent } from '@webeda/shared';
import { jobs } from '../jobs/manager';

export const jobsRouter = Router();

jobsRouter.post('/', async (req, res) => {
  try {
    const id = await jobs.create(req.body);
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

jobsRouter.get('/:id', (req, res) => {
  const info = jobs.get(req.params.id);
  if (!info) return void res.status(404).json({ error: '任务不存在或已过期' });
  res.json(info);
});

jobsRouter.get('/:id/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (ev: JobEvent) => {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === 'end') {
      clearInterval(ping);
      res.end();
    }
  };
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  const unsubscribe = jobs.subscribe(req.params.id, send);
  if (!unsubscribe) {
    clearInterval(ping);
    res.write(`event: error\ndata: ${JSON.stringify({ error: '任务不存在或已过期' })}\n\n`);
    return void res.end();
  }
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

jobsRouter.post('/:id/cancel', (req, res) => {
  if (!jobs.get(req.params.id)) return void res.status(404).json({ error: '任务不存在' });
  jobs.cancel(req.params.id);
  res.json({ ok: true });
});

const MIME: Record<string, string> = {
  vcd: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json',
  bitstream: 'application/octet-stream',
  text: 'text/plain; charset=utf-8',
  verilog: 'text/plain; charset=utf-8',
};

jobsRouter.get('/:id/artifacts/:name', (req, res) => {
  const found = jobs.artifactPath(req.params.id, req.params.name);
  if (!found) return void res.status(404).json({ error: '产物不存在' });
  res.setHeader('Content-Type', MIME[found.artifact.kind] ?? 'application/octet-stream');
  if (req.query.download !== undefined) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(found.artifact.name)}"`);
  }
  fs.createReadStream(found.path).pipe(res);
});
