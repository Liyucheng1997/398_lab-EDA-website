import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; shortcut?: string }
  | { type: 'sep' }
  | { type: 'header'; label: string };

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/** 右键菜单（macOS 风格：悬停整行主题色） */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height 不受弹出动画的 transform 影响
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - h - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onBlur = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="popover menu st-menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.type === 'sep') return <div key={i} className="menu-sep" />;
        if (it.type === 'header') return <div key={i} className="menu-header">{it.label}</div>;
        return (
          <div
            key={i}
            role="menuitem"
            className={`menu-item${it.disabled ? ' disabled' : ''}${it.danger ? ' st-menu-danger' : ''}`}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
