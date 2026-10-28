/** 通过真正的 JobManager 跑一遍 flow，确认 FLOWS 与任务队列、日志、产物登记的衔接 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { JobInfo } from '@webeda/shared';
import { config } from '../src/config';
import { jobs } from '../src/jobs/manager';
import { COUNTER, COUNTER_TB, HIER } from './fixtures';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((id) => fs.rm(path.join(config.workDir, id), { recursive: true, force: true })));
});

function waitEnd(id: string): Promise<{ info: JobInfo; logs: string }> {
  created.push(id);
  return new Promise((resolve) => {
    let logs = '';
    jobs.subscribe(id, (ev) => {
      if (ev.type === 'log') logs += ev.text;
      if (ev.type === 'end') resolve({ info: ev.job, logs });
    });
  });
}

describe('JobManager + FLOWS', { timeout: 120_000 }, () => {
  it('simulate job succeeds with a VCD artifact on disk', async () => {
    const id = await jobs.create({ kind: 'simulate', files: [COUNTER, COUNTER_TB], options: {} });
    const { info, logs } = await waitEnd(id);
    expect(info.status).toBe('succeeded');
    expect(info.result?.kind).toBe('simulate');
    expect(info.result && 'vcd' in info.result ? info.result.vcd : undefined).toBe('dump.vcd');
    expect(jobs.artifactPath(id, 'dump.vcd')).not.toBeNull();
    expect(logs).toContain('▶ iverilog');
  });

  it('elaborate job streams the Yosys log and registers schematics', async () => {
    const id = await jobs.create({ kind: 'elaborate', files: HIER, options: {} });
    const { info, logs } = await waitEnd(id);
    expect(info.status).toBe('succeeded');
    expect(logs).toContain('Executing HIERARCHY pass');
    const r = info.result!;
    expect(r.kind).toBe('elaborate');
    if (r.kind === 'elaborate') {
      expect(Object.keys(r.schematics)).toContain('top');
      for (const a of Object.values(r.schematics)) expect(jobs.artifactPath(id, a)?.artifact.kind).toBe('svg');
    }
  });

  it('a failing job ends as failed with error diagnostics', async () => {
    const id = await jobs.create({ kind: 'implement', files: [COUNTER], options: { device: 'xc7a35t-cpg236' } });
    const { info } = await waitEnd(id);
    expect(info.status).toBe('failed');
    expect(info.error).toMatch(/只能做综合/);
    expect(info.result?.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
