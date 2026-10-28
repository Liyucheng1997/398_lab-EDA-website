import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LedColor } from '../sim/peripherals';

type LevelStyle = CSSProperties & { '--lv'?: number };

export function Led({ level, color, label, title, dim }: { level: number; color: LedColor; label: string; title?: string; dim?: boolean }) {
  const style: LevelStyle = { '--lv': level };
  return (
    <div className={`vb-led-cell${dim ? ' vb-unconnected' : ''}`} title={title}>
      <span className={`vb-led vb-led-${color}`} style={style} role="img" aria-label={`${title ?? label}：${level > 0.05 ? '亮' : '灭'}`} />
      <span className="vb-cell-label">{label}</span>
    </div>
  );
}

export function RgbLed({ r, g, b, label, title }: { r: number; g: number; b: number; label: string; title?: string }) {
  const max = Math.max(r, g, b);
  // RGB 灯显示的是发光颜色本身（数据），按三个通道的亮度合成
  const style: CSSProperties =
    max > 0.004
      ? {
          background: `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`,
          boxShadow: `0 0 ${4 + max * 10}px ${max * 2}px rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${0.25 + max * 0.45})`,
        }
      : {};
  return (
    <div className="vb-led-cell" title={title}>
      <span className="vb-led vb-rgb" style={style} role="img" aria-label={`${label}：R ${Math.round(r * 100)}% G ${Math.round(g * 100)}% B ${Math.round(b * 100)}%`} />
      <span className="vb-cell-label">{label}</span>
    </div>
  );
}

export function SlideSwitch({
  on,
  label,
  hint,
  title,
  onToggle,
  disabled,
}: {
  on: boolean;
  label: string;
  hint?: string;
  title?: string;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`vb-sw-cell${disabled ? ' vb-unconnected' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title ?? label}
        title={title}
        className={`vb-sw${on ? ' on' : ''}`}
        onClick={onToggle}
        disabled={disabled}
      >
        <i />
      </button>
      <span className="vb-cell-label">{label}</span>
      {hint && <kbd className="vb-kbd">{hint}</kbd>}
    </div>
  );
}

/** 按住生效的按键：鼠标、触摸、键盘（由父组件处理快捷键）均可 */
export function PushButton({
  pressed,
  label,
  hint,
  title,
  onPress,
  variant,
  disabled,
}: {
  pressed: boolean;
  label: string;
  hint?: string;
  title?: string;
  onPress?: (down: boolean) => void;
  variant?: 'reset';
  disabled?: boolean;
}) {
  const held = useRef(false);
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持 */
    }
    held.current = true;
    onPress?.(true);
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    onPress?.(false);
  };
  return (
    <div className={`vb-btn-cell${disabled ? ' vb-unconnected' : ''}`}>
      <button
        type="button"
        className={`vb-push${pressed ? ' pressed' : ''}${variant === 'reset' ? ' vb-push-reset' : ''}`}
        aria-pressed={pressed}
        aria-label={title ?? label}
        title={title}
        disabled={disabled}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            held.current = true;
            onPress?.(true);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            up();
          }
        }}
        onBlur={up}
      >
        <i />
      </button>
      <span className="vb-cell-label">{label}</span>
      {hint && <kbd className="vb-kbd">{hint}</kbd>}
    </div>
  );
}

/** 通用输出指示灯（逻辑电平） */
export function Indicator({ level, label, title }: { level: number; label: string; title?: string }) {
  const style: LevelStyle = { '--lv': level };
  return (
    <div className="vb-ind" title={title ?? label}>
      <span className="vb-ind-dot" style={style} />
      <span className="vb-ind-label">{label}</span>
    </div>
  );
}

/** 通用输入拨动开关（紧凑） */
export function Toggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`vb-toggle${on ? ' on' : ''}`} onClick={onToggle} title={label}>
      <i />
      <span>{label}</span>
    </button>
  );
}
