import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// 使用本地 monaco-editor 包，不依赖 CDN
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};
loader.config({ monaco });

export { monaco };

/** 根据文件名推断 Monaco 语言 id */
export function languageOf(name: string): string {
  const n = name.toLowerCase();
  if (/\.(sv|svh)$/.test(n)) return 'systemverilog';
  if (/\.(v|vh|vl)$/.test(n)) return 'verilog';
  if (/\.(xdc|sdc|tcl|ys)$/.test(n)) return 'tcl';
  if (/\.json$/.test(n)) return 'json';
  if (/\.md$/.test(n)) return 'markdown';
  return 'plaintext';
}
