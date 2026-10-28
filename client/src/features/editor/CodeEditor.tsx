import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Diagnostic } from '@webeda/shared';
import { languageOf, monaco } from '../../lib/monaco';
import { useTheme } from '../../lib/theme';

export interface CodeEditorProps {
  /** 文件名：决定语言，也用于匹配 diagnostics */
  fileName: string;
  value: string;
  onChange?: (value: string) => void;
  /** 只显示 file === fileName 的诊断 */
  diagnostics?: Diagnostic[];
  readOnly?: boolean;
  /** Ctrl/Cmd+Enter 回调（运行） */
  onRun?: () => void;
  /** Ctrl/Cmd+S 回调（保存） */
  onSave?: () => void;
  /** 外部请求跳转到某行（每次对象变化都会跳） */
  reveal?: { line: number; column?: number } | null;
}

/** Monaco 编辑器封装：Verilog/SV 高亮、诊断波浪线、快捷键、跳转 */
export function CodeEditor({ fileName, value, onChange, diagnostics, readOnly, onRun, onSave, reveal }: CodeEditorProps) {
  const [theme] = useTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef(onRun);
  const saveRef = useRef(onSave);
  runRef.current = onRun;
  saveRef.current = onSave;

  const onMount: OnMount = (editor) => {
    editorRef.current = editor as unknown as monaco.editor.IStandaloneCodeEditor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.());
  };

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const markers = (diagnostics ?? [])
      .filter((d) => d.file === fileName && d.line)
      .map((d) => ({
        severity:
          d.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : d.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        message: `[${d.tool}] ${d.message}`,
        startLineNumber: d.line!,
        startColumn: d.column ?? 1,
        endLineNumber: d.line!,
        endColumn: d.column ? d.column + 1 : model.getLineMaxColumn(Math.min(d.line!, model.getLineCount())),
      }));
    monaco.editor.setModelMarkers(model, 'webeda', markers);
  }, [diagnostics, fileName, value]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !reveal) return;
    ed.revealLineInCenter(reveal.line);
    ed.setPosition({ lineNumber: reveal.line, column: reveal.column ?? 1 });
    ed.focus();
  }, [reveal]);

  return (
    <Editor
      path={fileName}
      language={languageOf(fileName)}
      value={value}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={onMount}
      options={{
        readOnly,
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        padding: { top: 8 },
        fixedOverflowWidgets: true,
      }}
    />
  );
}
