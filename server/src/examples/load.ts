import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardInfo, FileRole, SourceFile } from '@webeda/shared';
import { generateConstraints, getBoard, getDevice } from '@webeda/shared';

/** 示例 HDL 源文件所在目录：server/src/examples/hdl/<示例 id>/ */
export const HDL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hdl');

/** 按文件名推断角色（与 SourceFile.role 的推断规则一致） */
export function inferRole(name: string): FileRole {
  const lower = name.toLowerCase();
  if (/\.(pcf|lpf|xdc|cst)$/.test(lower)) return 'constraint';
  if (/\.(hex|mem)$/.test(lower)) return 'memory';
  if (/\.(vh|svh)$/.test(lower)) return 'include';
  const base = lower.split('/').pop() ?? lower;
  if (/(^|[_.-])(tb|testbench|test)([_.-]|$)/.test(base) || base.startsWith('tb_') || base.startsWith('testbench')) {
    return 'testbench';
  }
  if (/\.(s?v)$/.test(lower)) return 'design';
  return 'other';
}

/** 读取 hdl/<dir>/<name>，统一为 LF 换行（Windows 检出时可能被转换为 CRLF） */
export function readHdl(dir: string, name: string): string {
  const file = path.join(HDL_DIR, dir, name);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** 载入一个示例目录中的若干文件 */
export function loadFiles(dir: string, names: string[]): SourceFile[] {
  return names.map((name) => ({ name, content: readHdl(dir, name), role: inferRole(name) }));
}

/** 端口名（如 "led"）与板卡信号名（如 "led[3]"）是否对应 */
export function signalBase(signal: string): string {
  const i = signal.indexOf('[');
  return i < 0 ? signal : signal.slice(0, i);
}

/** 为模板生成约束文件：只包含顶层实际使用的端口 */
export function boardConstraintFile(boardId: string, fileName: string, ports: string[]): SourceFile {
  const board = requireBoard(boardId);
  const dev = getDevice(board.device);
  if (!dev) throw new Error(`板卡 ${boardId} 的器件 ${board.device} 不存在`);
  if (!fileName.endsWith(dev.constraintExt)) {
    throw new Error(`约束文件 ${fileName} 的扩展名应为 ${dev.constraintExt}`);
  }
  const used = board.pins.filter((p) => ports.includes(signalBase(p.signal))).map((p) => p.signal);
  const missing = ports.filter((port) => !used.some((s) => signalBase(s) === port));
  if (missing.length) throw new Error(`板卡 ${boardId} 没有端口 ${missing.join(', ')} 对应的引脚`);
  return { name: fileName, content: generateConstraints(board, used), role: 'constraint' };
}

export function requireBoard(id: string): BoardInfo {
  const board = getBoard(id);
  if (!board) throw new Error(`板卡 ${id} 不存在`);
  return board;
}
