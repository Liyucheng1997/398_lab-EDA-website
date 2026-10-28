import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { jobsRouter } from './routes/jobs';
import { metaRouter } from './routes/meta';
import { playgroundsRouter, projectsRouter } from './routes/storage';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.use('/api/jobs', jobsRouter);
app.use('/api/playgrounds', playgroundsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', metaRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 生产模式：托管前端构建产物（SPA 回退到 index.html）
if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器错误' });
});

fs.mkdirSync(config.workDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

app.listen(config.port, () => {
  console.log(`WebEDA server listening on http://localhost:${config.port}`);
  console.log(`  work dir: ${config.workDir}`);
  console.log(`  data dir: ${config.dataDir}`);
});
