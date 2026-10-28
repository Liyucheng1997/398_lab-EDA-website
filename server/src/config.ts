import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** 持久化数据（playground / project JSON） */
  dataDir: path.resolve(process.env.WEBEDA_DATA_DIR ?? path.join(REPO_ROOT, 'data')),
  /** 任务临时工作目录 */
  workDir: path.resolve(process.env.WEBEDA_WORK_DIR ?? path.join(os.tmpdir(), 'webeda-jobs')),
  /** 前端构建产物，存在时由 server 直接托管 */
  clientDist: path.join(REPO_ROOT, 'client', 'dist'),
  /** 允许跨域访问 /api 的前端来源（逗号分隔），如 https://liyucheng1997.github.io；为空则不开启 CORS */
  corsOrigins: (process.env.WEBEDA_CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** 同时运行的任务数 */
  concurrency: Number(process.env.WEBEDA_CONCURRENCY ?? Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))),
  /** 任务保留时间（结束后多久清理工作目录与内存记录） */
  jobTtlMs: 60 * 60 * 1000,
  limits: {
    maxFiles: 64,
    maxTotalSourceBytes: 4 * 1024 * 1024,
    /** 单个任务日志上限，超出后截断 */
    maxLogBytes: 2 * 1024 * 1024,
    /** 单个产物上限（VCD 可能很大） */
    maxArtifactBytes: 64 * 1024 * 1024,
    defaultTimeoutSec: 30,
    maxTimeoutSec: 120,
    /** Yosys / nextpnr 的单步超时 */
    toolTimeoutSec: 300,
  },
};
