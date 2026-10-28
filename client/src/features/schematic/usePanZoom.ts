// 平移缩放交互：拖动 / 滚轮平移，Ctrl(⌘)+滚轮或触控板捏合缩放，双指触摸捏合，键盘。
// 只维护变换并回调，不负责绘制——原理图用 CSS transform，器件视图用 Canvas 重绘。
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { clamp, wheelPixels, wheelZoomFactor, zoomAt, type ViewTransform } from './geometry';

export interface PanZoomOptions {
  minK: number;
  maxK: number;
  /** 变换改变时调用；interacting = 用户正在拖动/缩放（可用于降低绘制质量） */
  onTransform: (t: ViewTransform, interacting: boolean) => void;
  /** 未发生拖动的单击 */
  onTap?: (e: PointerEvent) => void;
  /** 未按键时的鼠标移动；null = 离开 */
  onHover?: (e: PointerEvent | null) => void;
  /** 键盘 “0” / 适配 */
  onFit?: () => void;
  /** 键盘 “1” / 100% */
  onActualSize?: () => void;
  /** 用户主动改变了视图（用于取消“自动适配”） */
  onUserInteract?: () => void;
}

const TAP_SLOP = 4;
const IDLE_MS = 160;

export function usePanZoom(ref: RefObject<HTMLElement | null>, options: PanZoomOptions) {
  const opts = useRef(options);
  opts.current = options;
  const tRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const idleTimer = useRef<number | undefined>(undefined);

  const emit = useCallback((t: ViewTransform, interacting: boolean) => {
    tRef.current = t;
    opts.current.onTransform(t, interacting);
    window.clearTimeout(idleTimer.current);
    if (interacting) {
      idleTimer.current = window.setTimeout(() => opts.current.onTransform(tRef.current, false), IDLE_MS);
    }
  }, []);

  /** 程序设置变换（适配、居中等） */
  const setTransform = useCallback(
    (t: ViewTransform) => {
      const { minK, maxK } = opts.current;
      emit({ ...t, k: clamp(t.k, minK, maxK) }, false);
    },
    [emit],
  );

  /** 以视口中心（或给定点）缩放 factor 倍 */
  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const el = ref.current;
      if (!el) return;
      const { minK, maxK } = opts.current;
      const t = tRef.current;
      const k = clamp(t.k * factor, minK, maxK);
      const cx = px ?? el.clientWidth / 2;
      const cy = py ?? el.clientHeight / 2;
      emit(zoomAt(t, cx, cy, k), false);
      opts.current.onUserInteract?.();
    },
    [emit, ref],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; moved: boolean; id: number } | null = null;
    let pinch: { dist: number; mx: number; my: number } | null = null;
    let hoverRaf = 0;
    let lastHover: PointerEvent | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { minK, maxK } = opts.current;
      const t = tRef.current;
      if (e.ctrlKey || e.metaKey) {
        const p = local(e);
        const k = clamp(t.k * wheelZoomFactor(e.deltaY, e.deltaMode), minK, maxK);
        emit(zoomAt(t, p.x, p.y, k), true);
      } else {
        let dx = wheelPixels(e.deltaX, e.deltaMode);
        let dy = wheelPixels(e.deltaY, e.deltaMode);
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        emit({ ...t, x: t.x - dx, y: t.y - dy }, true);
      }
      opts.current.onUserInteract?.();
    };

    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      // 工具栏等浮层上的点击不进入平移
      if ((e.target as Element | null)?.closest?.('[data-panzoom-ignore]')) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 某些合成事件不支持捕获 */
      }
      if (pointers.size === 1) {
        dragStart = { x: p.x, y: p.y, moved: false, id: e.pointerId };
      } else if (pointers.size === 2) {
        pinch = pinchState();
        if (dragStart) dragStart.moved = true;
      }
      if (e.button === 1) e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && opts.current.onHover) {
          lastHover = e;
          if (!hoverRaf)
            hoverRaf = requestAnimationFrame(() => {
              hoverRaf = 0;
              if (lastHover) opts.current.onHover?.(lastHover);
            });
        }
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const t = tRef.current;
      if (pointers.size >= 2 && pinch) {
        const now = pinchState();
        const { minK, maxK } = opts.current;
        const k = clamp(t.k * (now.dist / Math.max(1, pinch.dist)), minK, maxK);
        const z = zoomAt(t, pinch.mx, pinch.my, k);
        emit({ k, x: z.x + now.mx - pinch.mx, y: z.y + now.my - pinch.my }, true);
        pinch = now;
        opts.current.onUserInteract?.();
        return;
      }
      if (!dragStart || dragStart.id !== e.pointerId) return;
      if (!dragStart.moved && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) < TAP_SLOP) return;
      if (!dragStart.moved) {
        dragStart.moved = true;
        el.classList.add('is-dragging');
        opts.current.onHover?.(null);
      }
      emit({ ...t, x: t.x + p.x - prev.x, y: t.y + p.y - prev.y }, true);
      opts.current.onUserInteract?.();
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (pointers.size < 2) pinch = null;
      if (dragStart && dragStart.id === e.pointerId) {
        const tap = !dragStart.moved && e.type === 'pointerup';
        dragStart = null;
        el.classList.remove('is-dragging');
        if (tap) opts.current.onTap?.(e);
      }
      if (pointers.size === 1) {
        // 双指变单指：以剩下的手指继续拖动
        const [id, p] = [...pointers.entries()][0];
        dragStart = { x: p.x, y: p.y, moved: true, id };
      }
    };

    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !pointers.size) {
        lastHover = null;
        opts.current.onHover?.(null);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.target !== el) return;
      const t = tRef.current;
      const step = 60;
      switch (e.key) {
        case '+':
        case '=':
          zoomBy(1.25);
          break;
        case '-':
        case '_':
          zoomBy(0.8);
          break;
        case '0':
          opts.current.onFit?.();
          break;
        case '1':
          opts.current.onActualSize?.();
          break;
        case 'ArrowLeft':
          emit({ ...t, x: t.x + step }, false);
          break;
        case 'ArrowRight':
          emit({ ...t, x: t.x - step }, false);
          break;
        case 'ArrowUp':
          emit({ ...t, y: t.y + step }, false);
          break;
        case 'ArrowDown':
          emit({ ...t, y: t.y - step }, false);
          break;
        default:
          return;
      }
      e.preventDefault();
      opts.current.onUserInteract?.();
    };

    // Safari 触控板手势
    let gestureK = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureK = tRef.current.k;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (typeof ge.scale !== 'number') return;
      const { minK, maxK } = opts.current;
      const p = local({ clientX: ge.clientX ?? 0, clientY: ge.clientY ?? 0 });
      emit(zoomAt(tRef.current, p.x, p.y, clamp(gestureK * ge.scale, minK, maxK)), true);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('keydown', onKey);
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      window.clearTimeout(idleTimer.current);
    };
  }, [ref, emit, zoomBy]);

  return { tRef, setTransform, zoomBy };
}
