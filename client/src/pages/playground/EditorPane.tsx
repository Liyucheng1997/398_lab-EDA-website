import { useEffect, useMemo, useRef, useState } from 'react';
import { Binary, FileCode2, FilePlus2, FileText, Plus, X } from 'lucide-react';
import type { Diagnostic } from '@webeda/shared';
import { CodeEditor } from '../../features/editor/CodeEditor';
import { toast } from '../../ui/toast';
import { isHdlName, roleFor, type Pane, type PgFile } from './model';

interface Props {
  pane: Pane;
  label: string;
  files: PgFile[];
  activeId: string | null;
  diagnostics: Diagnostic[];
  reveal: { fileId: string; line: number; column?: number; seq: number } | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** 返回错误文案或 null（成功） */
  onRename: (id: string, name: string) => string | null;
  onDelete: (id: string) => void;
  onChange: (id: string, content: string) => void;
}

function FileIcon({ name, pane }: { name: string; pane: Pane }) {
  const role = roleFor(name, pane);
  if (role === 'memory') return <Binary size={13} strokeWidth={1.75} className="pg-tab-ico" />;
  if (!isHdlName(name)) return <FileText size={13} strokeWidth={1.75} className="pg-tab-ico" />;
  return <FileCode2 size={13} strokeWidth={1.75} className="pg-tab-ico" />;
}

/** 一个编辑器面板：文件页签（新建/双击重命名/删除）+ Monaco */
export function EditorPane({ pane, label, files, activeId, diagnostics, reveal, onSelect, onAdd, onRename, onDelete, onChange }: Props) {
  const active = files.find((f) => f.id === activeId) ?? null;
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // 每个文件的诊断严重程度（页签上的小圆点）
  const severity = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const d of diagnostics) {
      if (!d.file || (d.severity !== 'error' && d.severity !== 'warning')) continue;
      if (d.severity === 'error' || !m.has(d.file)) m.set(d.file, d.severity);
    }
    return m;
  }, [diagnostics]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = el.value.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }
    // 只在开始编辑时选中
  }, [editing?.id]);

  // 激活的页签滚动到可见
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('.tab.active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, files.length]);

  const commit = (keepOnError: boolean) => {
    if (!editing) return;
    const f = files.find((x) => x.id === editing.id);
    if (!f || editing.value.trim() === f.name) {
      setEditing(null);
      return;
    }
    const err = onRename(editing.id, editing.value);
    if (err) {
      toast(err, 'error');
      if (!keepOnError) setEditing(null);
      return;
    }
    setEditing(null);
  };

  const editorReveal = useMemo(
    () => (reveal && active && reveal.fileId === active.id ? { line: reveal.line, column: reveal.column } : null),
    // seq 变化时生成新对象，触发再次跳转
    [reveal?.seq, reveal?.fileId, active?.id],
  );

  return (
    <div className="panel pg-pane">
      <div className="pg-pane-head">
        <span className="pg-pane-label">{label}</span>
        <div className="pg-pane-tabs" ref={tabsRef} role="tablist" aria-label={`${label}文件`}>
          {files.map((f) => {
            const sev = severity.get(f.name);
            const isEditing = editing?.id === f.id;
            return (
              <div
                key={f.id}
                role="tab"
                aria-selected={f.id === activeId}
                tabIndex={0}
                className={`tab pg-tab${f.id === activeId ? ' active' : ''}`}
                title={isEditing ? undefined : `${f.name}（双击重命名）`}
                onClick={() => onSelect(f.id)}
                onDoubleClick={() => setEditing({ id: f.id, value: f.name })}
                onKeyDown={(e) => {
                  if (isEditing) return;
                  if (e.key === 'Enter') onSelect(f.id);
                  if (e.key === 'F2') setEditing({ id: f.id, value: f.name });
                }}
              >
                <FileIcon name={f.name} pane={pane} />
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="pg-tab-input"
                    value={editing.value}
                    spellCheck={false}
                    size={Math.max(6, editing.value.length)}
                    onChange={(e) => setEditing({ id: f.id, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onBlur={() => commit(false)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commit(true);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <span className="pg-tab-name">{f.name}</span>
                )}
                {sev && !isEditing && <i className={`pg-tab-dot ${sev}`} aria-label={sev === 'error' ? '有错误' : '有警告'} />}
                {!isEditing && (
                  <button
                    className="tab-x"
                    aria-label={`删除 ${f.name}`}
                    title="删除文件"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(f.id);
                    }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button className="icon-btn pg-pane-add" onClick={onAdd} title={`在${label}中新建文件`} aria-label={`在${label}中新建文件`}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="pg-pane-body">
        {active ? (
          <CodeEditor
            fileName={active.name}
            value={active.content}
            onChange={(v) => onChange(active.id, v)}
            diagnostics={diagnostics}
            reveal={editorReveal}
          />
        ) : (
          <div className="empty">
            <FilePlus2 size={34} strokeWidth={1.4} />
            <span>{pane === 'tb' ? '还没有测试平台文件' : '还没有设计文件'}</span>
            <button className="btn btn-sm" onClick={onAdd}>
              <Plus size={14} strokeWidth={1.75} />
              新建文件
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
