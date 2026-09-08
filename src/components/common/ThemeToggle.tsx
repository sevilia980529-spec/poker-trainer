import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

/**
 * 白天 / 黑夜切换按钮（玻璃质感药丸，Apple 风）。
 * 放在首页 Header 与训练页头部，状态全局同步。
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? '切换到白天模式' : '切换到黑夜模式'}
      title={isDark ? '白天模式' : '黑夜模式'}
      className="relative grid place-items-center w-9 h-9 rounded-full glass border border-gold/25 text-gold active:scale-95 transition-transform duration-150"
    >
      {isDark
        ? <Sun className="w-[18px] h-[18px]" strokeWidth={2} />
        : <Moon className="w-[18px] h-[18px]" strokeWidth={2} />}
    </button>
  );
}
