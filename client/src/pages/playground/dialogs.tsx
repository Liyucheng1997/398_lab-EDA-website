import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, FilePlus2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 确认框：顶部圆形图标 + 两个等宽按钮；回车确定，Esc/遮罩取消 */
export function ConfirmDialog({ open, title, message, confirmLabel = '确定', cancelLabel = '取消', danger, onConfirm, onCancel }: ConfirmProps) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => okRef.current?.focus());
  }, [open]);
  return (
    <Modal open={open} title={title} onClose={onCancel} width={380}>
      <div
        className="pg-confirm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onConfirm();
          }
        }}
      >
        <div className={`pg-confirm-icon${danger ? ' danger' : ''}`}>
          <AlertTriangle size={22} strokeWidth={1.75} />
        </div>
        <div className="pg-confirm-msg">{message}</div>
        <div className="pg-confirm-actions">
          <button className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={okRef} className={`btn ${danger ? 'pg-btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface PromptProps {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  placeholder?: string;
  hint?: ReactNode;
  confirmLabel?: string;
  /** 返回错误文案（非法）或 null（合法）；输入会先经过 transform */
  validate: (value: string) => string | null;
  transform?: (value: string) => string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** 单行输入对话框（新建文件等） */
export function PromptDialog({ open, title, label, initial, placeholder, hint, confirmLabel = '确定', validate, transform, onSubmit, onCancel }: PromptProps) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setTouched(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = initial.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    });
  }, [open, initial]);

  const final = transform ? transform(value) : value;
  const error = validate(final);
  const submit = () => {
    setTouched(true);
    if (!error) onSubmit(final);
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={touched && !!error}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        className="pg-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="pg-prompt-label">
          <FilePlus2 size={15} strokeWidth={1.75} />
          {label}
        </label>
        <input
          ref={inputRef}
          className="input pg-prompt-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
          }}
        />
        <div className={`pg-prompt-hint${touched && error ? ' error' : ''}`}>{touched && error ? error : hint}</div>
      </form>
    </Modal>
  );
}

/** 剪贴板不可用时的分享链接对话框：链接可选中，手动复制 */
export function ShareDialog({ url, onClose, onCopy }: { url: string | null; onClose: () => void; onCopy: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (url) requestAnimationFrame(() => inputRef.current?.select());
  }, [url]);
  return (
    <Modal
      open={!!url}
      title="分享链接"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn-primary" onClick={() => url && onCopy(url)}>
            复制链接
          </button>
        </>
      }
    >
      <div className="pg-prompt">
        <div className="pg-prompt-hint">浏览器未允许自动写入剪贴板，请手动复制下面的链接：</div>
        <input ref={inputRef} className="input pg-prompt-input" readOnly value={url ?? ''} onFocus={(e) => e.currentTarget.select()} />
      </div>
    </Modal>
  );
}
