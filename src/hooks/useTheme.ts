import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'poker-theme';
const THEME_EVENT = 'poker-theme-change';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'dark';
}

/**
 * 全局主题状态。多个组件（首页 Header、训练页头部）各自调用本 hook，
 * 通过 window 事件保持图标同步，切换时统一写入 <html data-theme> 与 localStorage。
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    const onThemeChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_EVENT, onThemeChange);
  }, []);

  const apply = (next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  };

  const setTheme = (next: Theme) => apply(next);
  const toggle = () => apply(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle, setTheme };
}
