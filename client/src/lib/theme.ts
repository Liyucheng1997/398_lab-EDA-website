import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const listeners = new Set<(t: Theme) => void>();

export function setTheme(t: Theme) {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('webeda.theme', t);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(t));
}

/** 当前主题（随切换更新）；画布类组件用它重绘 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(current);
  useEffect(() => {
    listeners.add(setT);
    return () => void listeners.delete(setT);
  }, []);
  return [t, setTheme];
}

/** 读取 CSS 变量的实际颜色值（画布绘制用） */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
