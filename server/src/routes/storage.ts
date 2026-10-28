import { Router } from 'express';
import type { Playground, PlaygroundInput, Project, ProjectInput, ProjectSummary } from '@webeda/shared';
import { getDevice } from '@webeda/shared';
import { normalizeFiles } from '../jobs/files';
import { JsonStore } from '../storage/store';

const playgrounds = new JsonStore<Playground>('playgrounds');
const projects = new JsonStore<Project>('projects');

function validatePlayground(body: unknown): PlaygroundInput {
  const b = body as PlaygroundInput;
  if (!b || typeof b !== 'object') throw new Error('请求体格式错误');
  return {
    title: String(b.title ?? '未命名').slice(0, 200),
    description: b.description ? String(b.description).slice(0, 4000) : undefined,
    files: normalizeFiles(b.files),
    settings: b.settings,
  };
}

function validateProject(body: unknown): ProjectInput {
  const b = body as ProjectInput;
  if (!b || typeof b !== 'object') throw new Error('请求体格式错误');
  if (!b.settings || !getDevice(b.settings.device)) throw new Error('未知器件');
  return {
    name: String(b.name ?? '未命名工程').slice(0, 200),
    description: b.description ? String(b.description).slice(0, 4000) : undefined,
    files: normalizeFiles(b.files),
    settings: b.settings,
    runs: Array.isArray(b.runs) ? b.runs.slice(-50) : [],
  };
}

export const playgroundsRouter = Router();

playgroundsRouter.post('/', async (req, res) => {
  try {
    const input = validatePlayground(req.body);
    const forkedFrom = typeof req.body?.forkedFrom === 'string' ? req.body.forkedFrom : undefined;
    res.status(201).json(await playgrounds.create({ ...input, forkedFrom }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

playgroundsRouter.get('/:id', async (req, res) => {
  const p = await playgrounds.get(req.params.id);
  if (!p) return void res.status(404).json({ error: 'Playground 不存在' });
  res.json(p);
});

playgroundsRouter.put('/:id', async (req, res) => {
  try {
    const p = await playgrounds.update(req.params.id, validatePlayground(req.body));
    if (!p) return void res.status(404).json({ error: 'Playground 不存在' });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  const all = await projects.list();
  const summaries: ProjectSummary[] = all.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    device: p.settings.device,
    board: p.settings.board,
    updatedAt: p.updatedAt,
    fileCount: p.files.length,
  }));
  res.json(summaries);
});

projectsRouter.post('/', async (req, res) => {
  try {
    const input = validateProject(req.body);
    res.status(201).json(await projects.create({ ...input, runs: input.runs ?? [] }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

projectsRouter.get('/:id', async (req, res) => {
  const p = await projects.get(req.params.id);
  if (!p) return void res.status(404).json({ error: '工程不存在' });
  res.json(p);
});

projectsRouter.put('/:id', async (req, res) => {
  try {
    const input = validateProject(req.body);
    const p = await projects.update(req.params.id, { ...input, runs: input.runs ?? [] });
    if (!p) return void res.status(404).json({ error: '工程不存在' });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

projectsRouter.delete('/:id', async (req, res) => {
  const ok = await projects.remove(req.params.id);
  if (!ok) return void res.status(404).json({ error: '工程不存在' });
  res.json({ ok: true });
});
