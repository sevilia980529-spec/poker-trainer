import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// 应用启动即同步主题（读取 localStorage，默认 dark），避免首屏闪烁。
// 同时写入 data-theme 属性与 .dark 类：前者驱动 CSS 变量，后者驱动 Tailwind dark: 变体。
try {
  const saved = localStorage.getItem('poker-theme');
  const initial: 'light' | 'dark' = saved === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', initial);
  document.documentElement.classList.toggle('dark', initial === 'dark');
} catch { /* ignore */ }

// 注册 Service Worker（PWA，仅生产环境）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 忽略 */ });
  });
}
