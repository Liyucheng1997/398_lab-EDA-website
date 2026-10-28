import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileRole, SourceFile } from '@webeda/shared';
import { config } from '../config';

export function inferRole(name: string): FileRole {
  const lower = name.toLowerCase();
  const base = path.posix.basename(lower);
  if (/\.(pcf|lpf|xdc|cst|sdc)$/.test(lower)) return 'constraint';
  if (/\.(vh|svh|h)$/.test(lower)) return 'include';
  if (/\.(hex|mem|bin|coe|mif)$/.test(lower)) return 'memory';
  if (!/\.(v|sv|vl|verilog)$/.test(lower)) return 'other';
  if (/(^|[_\-.])(tb|test|testbench|bench)([_\-.]|$)/.test(base) || base.startsWith('tb') || base.includes('testbench')) return 'testbench';
  return 'design';
}

export function isHdl(f: SourceFile): boolean {
  return /\.(v|sv|vl|verilog)$/i.test(f.name);
}

/** 校验并规范化源文件；非法时抛出 Error（消息直接返回给前端） */
export function normalizeFiles(files: unknown): SourceFile[] {
  if (!Array.isArray(files)) throw new Error('files 必须是数组');
  if (files.length > config.limits.maxFiles) throw new Error(`文件数超过上限 ${config.limits.maxFiles}`);
  let total = 0;
  const seen = new Set<string>();
  return files.map((raw) => {
    const f = raw as SourceFile;
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') throw new Error('文件格式错误');
    const name = f.name.replace(/\\/g, '/').trim();
    if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').some((s) => s === '..' || s === '' || s === '.')) {
      throw new Error(`非法文件名：${f.name}`);
    }
    if (!/^[\w\-./ ]+$/.test(name)) throw new Error(`文件名只能包含字母、数字、下划线、横线、点和斜杠：${f.name}`);
    if (seen.has(name.toLowerCase())) throw new Error(`文件名重复：${name}`);
    seen.add(name.toLowerCase());
    total += Buffer.byteLength(f.content);
    if (total > config.limits.maxTotalSourceBytes) throw new Error('源文件总大小超过上限');
    return { name, content: f.content, role: f.role ?? inferRole(name) };
  });
}

export async function writeFiles(dir: string, files: SourceFile[]) {
  for (const f of files) {
    const p = path.join(dir, ...f.name.split('/'));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, f.content);
  }
}

/** 解析 artifact 路径，防止越界访问 */
export function safeJoin(dir: string, name: string): string | null {
  const p = path.resolve(dir, name);
  const rel = path.relative(dir, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return p;
}
