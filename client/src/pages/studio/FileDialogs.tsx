import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FileRole } from '@webeda/shared';
import { Modal } from '../../ui/Modal';
import { inferRole, normalizeFileName, ROLE_LABEL, validateFileName } from './model';

const ROLES: FileRole[] = ['design', 'include', 'constraint', 'testbench', 'memory', 'other'];

const DEFAULT_EXT: Record<FileRole, string> = {
  design: '.sv',
  include: '.svh',
  constraint: '.pcf',
  testbench: '.sv',
  memory: '.hex',
  other: '.txt',
};

/** 添加源文件：名称 + 类型（按扩展名自动推断，可手动指定） */
export function AddFileModal({
  open,
  initialRole,
  constraintExt,
  existing,
  onClose,
  onCreate,
  onImport,
}: {
  open: boolean;
  initialRole?: FileRole;
  constraintExt: string;
  existing: string[];
  onClose: () => void;
  onCreate: (name: string, role: FileRole) => void;
  onImport: () => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<FileRole>('design');
  const [roleTouched, setRoleTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = initialRole ?? 'design';
    setRole(r);
    setRoleTouched(!!initialRole);
    setTouched(false);
    const ext = r === 'constraint' ? constraintExt : DEFAULT_EXT[r];
    const base = r === 'testbench' ? 'tb_new' : r === 'constraint' ? 'pins' : r === 'memory' ? 'init' : 'new_module';
    let n = `${base}${ext}`;
    for (let i = 2; existing.some((e) => e.toLowerCase() === n.toLowerCase()); i++) n = `${base}${i}${ext}`;
    setName(n);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(0, n.lastIndexOf('.') > 0 ? n.lastIndexOf('.') : n.length);
      }
    });
    // 只在打开时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const error = validateFileName(name, existing);
  const submit = () => {
    setTouched(true);
    if (error) return;
    onCreate(normalizeFileName(name), role);
  };

  return (
    <Modal
      open={open}
      title="添加源文件"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onImport}>
            从本地导入…
          </button>
          <span className="st-flex1" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={touched && !!error}>
            创建
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="form-row">
          <span className="form-label">文件名</span>
          <input
            ref={inputRef}
            className="input"
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
              if (!roleTouched) setRole(inferRole(normalizeFileName(e.target.value)));
            }}
          />
        </label>
        <label className="form-row">
          <span className="form-label">类型</span>
          <select
            className="input"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as FileRole);
              setRoleTouched(true);
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {touched && error && <div className="st-form-error">{error}</div>}
        <div className="st-form-hint">可以带一级子目录，如 rtl/alu.sv。.pcf/.lpf/.xdc 为约束，名字含 tb/test 的为仿真源文件。</div>
      </form>
    </Modal>
  );
}

/** 重命名 */
export function RenameModal({
  name,
  existing,
  onClose,
  onRename,
}: {
  name: string | null;
  existing: string[];
  onClose: () => void;
  onRename: (from: string, to: string) => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!name) return;
    setValue(name);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const dot = name.lastIndexOf('.');
        el.setSelectionRange(name.lastIndexOf('/') + 1, dot > 0 ? dot : name.length);
      }
    });
  }, [name]);
  const error = name ? validateFileName(value, existing, name) : null;
  const submit = () => {
    if (!name || error) return;
    const to = normalizeFileName(value);
    if (to === name) onClose();
    else onRename(name, to);
  };
  return (
    <Modal
      open={!!name}
      title="重命名文件"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!!error}>
            重命名
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input ref={inputRef} className="input" autoFocus value={value} spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        {error && <div className="st-form-error">{error}</div>}
      </form>
    </Modal>
  );
}

/** 确认框：圆形图标 + 说明 + 两个等宽按钮；回车确定 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmText = '确定',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm]);
  return (
    <Modal open={open} title="" onClose={onClose} width={380}>
      <div className="st-confirm">
        <div className={`st-confirm-ico${danger ? ' danger' : ''}`}>
          <AlertTriangle size={22} strokeWidth={1.75} />
        </div>
        <div className="st-confirm-title">{title}</div>
        <div className="st-confirm-msg">{message}</div>
        <div className="st-confirm-btns">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className={`btn ${danger ? 'st-btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
