import { useEffect, useState } from 'react';

type Kind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: Kind;
  show: boolean;
}

let seq = 0;
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];

function emit() {
  listeners.forEach((fn) => fn([...toasts]));
}

/** 顶部居中的深色胶囊提示 */
export function toast(text: string, kind: Kind = 'info', ms = 2600) {
  const t: Toast = { id: ++seq, text, kind, show: false };
  toasts = [...toasts, t];
  emit();
  requestAnimationFrame(() => {
    t.show = true;
    emit();
  });
  setTimeout(() => {
    t.show = false;
    emit();
    setTimeout(() => {
      toasts = toasts.filter((x) => x !== t);
      emit();
    }, 300);
  }, ms);
}

export function ToastHost() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  return (
    <div className="toast-host">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}${t.show ? ' show' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
