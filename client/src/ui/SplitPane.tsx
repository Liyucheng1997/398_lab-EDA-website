import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** 'horizontal' = 左右分栏；'vertical' = 上下分栏 */
  direction: 'horizontal' | 'vertical';
  /** 第一块的初始尺寸：像素或百分比（如 "40%"） */
  initial?: number | string;
  min?: number;
  /** 第二块的最小尺寸 */
  minSecond?: number;
  /** 持久化尺寸用的 localStorage key */
  storageKey?: string;
  /** 折叠第二块（第一块占满） */
  collapsedSecond?: boolean;
  children: [ReactNode, ReactNode];
  className?: string;
}

/** 可拖拽调整大小的双栏容器 */
export function SplitPane({ direction, initial = '50%', min = 80, minSecond = 80, storageKey, collapsedSecond, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | string>(() => {
    if (storageKey) {
      try {
        const v = localStorage.getItem(`webeda.split.${storageKey}`);
        if (v) return v.endsWith('%') ? v : Number(v);
      } catch {
        /* ignore */
      }
    }
    return initial;
  });
  const dragging = useRef(false);
  const horizontal = direction === 'horizontal';

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const total = horizontal ? rect.width : rect.height;
      let px = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
      px = Math.max(min, Math.min(total - minSecond, px));
      const pct = `${((px / total) * 100).toFixed(2)}%`;
      setSize(pct);
    },
    [horizontal, min, minSecond],
  );

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
  }, [onMove]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`webeda.split.${storageKey}`, String(size));
    } catch {
      /* ignore */
    }
  }, [size, storageKey]);

  const first = typeof size === 'number' ? `${size}px` : size;
  return (
    <div ref={ref} className={`split split-${direction} ${className ?? ''}`}>
      <div className="split-pane" style={collapsedSecond ? { flex: 1 } : { flex: `0 0 ${first}` }}>
        {children[0]}
      </div>
      {!collapsedSecond && (
        <>
          <div
            className="split-gutter"
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
              document.body.style.userSelect = 'none';
            }}
            onDoubleClick={() => setSize(initial)}
          />
          <div className="split-pane" style={{ flex: 1 }}>
            {children[1]}
          </div>
        </>
      )}
    </div>
  );
}
