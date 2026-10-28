/**
 * 测试用的真实 JobContext：临时工作目录、真实工具（runTool）、收集日志与产物。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Artifact, Diagnostic, JobRequest, JobResult, SourceFile } from '@webeda/shared';
import { FLOWS } from '../src/flows';
import { FlowError, type JobContext } from '../src/jobs/context';
import { normalizeFiles, safeJoin, writeFiles } from '../src/jobs/files';
import { runTool } from '../src/tools/exec';

export interface TestContext extends JobContext {
  logs: { stream: string; text: string }[];
  stages: string[];
  abort: AbortController;
  logText(): string;
  readText(name: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeContext(files: SourceFile[]): Promise<TestContext> {
  const normalized = normalizeFiles(files);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webeda-test-'));
  await writeFiles(workDir, normalized);
  const abort = new AbortController();
  const artifacts: Artifact[] = [];
  const logs: { stream: string; text: string }[] = [];
  const stages: string[] = [];
  const ctx: TestContext = {
    id: path.basename(workDir),
    workDir,
    files: normalized,
    signal: abort.signal,
    artifacts,
    logs,
    stages,
    abort,
    log: (stream, text) => logs.push({ stream, text }),
    stage: (name) => stages.push(name),
    run: (tool, args, opts) => {
      if (!opts?.quiet) logs.push({ stream: 'info', text: `▶ ${tool} ${args.join(' ')}\n` });
      return runTool(tool, args, {
        cwd: workDir,
        timeoutMs: (opts?.timeoutSec ?? 300) * 1000,
        signal: abort.signal,
        stdin: opts?.stdin,
        onOutput: opts?.quiet ? undefined : (stream, text) => logs.push({ stream, text }),
      });
    },
    addArtifact: async (name, kind, label) => {
      const p = safeJoin(workDir, name);
      if (!p) throw new Error(`非法产物名 ${name}`);
      const st = await fs.stat(p);
      const art: Artifact = { name, size: st.size, kind, label };
      artifacts.splice(0, artifacts.length, ...artifacts.filter((a) => a.name !== name), art);
      return art;
    },
    writeArtifact: async (name, content, kind, label) => {
      const p = safeJoin(workDir, name);
      if (!p) throw new Error(`非法产物名 ${name}`);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
      return ctx.addArtifact(name, kind, label);
    },
    logText: () => logs.map((l) => l.text).join(''),
    readText: (name) => fs.readFile(path.join(workDir, name), 'utf8'),
    cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
  };
  return ctx;
}

/** 运行一个 flow；FlowError 会被转成与 jobs/manager 相同的“失败结果”形式便于断言 */
export async function runFlow<R extends JobRequest>(
  req: R,
): Promise<{ ctx: TestContext; result?: Extract<JobResult, { kind: R['kind'] }>; error?: FlowError }> {
  const ctx = await makeContext(req.files);
  const flow = FLOWS[req.kind] as unknown as (c: JobContext, r: JobRequest) => Promise<JobResult>;
  try {
    const result = (await flow(ctx, { ...req, files: ctx.files } as JobRequest)) as Extract<JobResult, { kind: R['kind'] }>;
    return { ctx, result };
  } catch (e) {
    if (e instanceof FlowError) return { ctx, error: e };
    throw e;
  }
}

export const errorsOf = (r: { diagnostics: Diagnostic[] } | undefined): Diagnostic[] => (r?.diagnostics ?? []).filter((d) => d.severity === 'error');
