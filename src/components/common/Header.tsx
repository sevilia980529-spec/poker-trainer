import { useNavigate } from 'react-router';
import { useUserStore, useLevel } from '../../store/userStore';
import { loadProfile } from '../../store/points';
import LevelBadge from './LevelBadge';

export default function Header() {
  const navigate = useNavigate();
  const nickname = useUserStore((s) => s.nickname);
  const avatar = useUserStore((s) => s.avatar);
  const chips = loadProfile().points;
  const { level } = useLevel();

  return (
    <header className="sticky top-0 z-30 bg-ink/95 backdrop-blur-md border-b border-white/5 safe-top">
      <div className="px-4 py-3 flex items-center justify-between max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/profile')}
          className="flex items-center gap-2.5 active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-xl shadow-md">
            {avatar}
          </div>
          <div className="flex flex-col items-start">
            <span className="text-sm font-semibold text-ivory truncate max-w-[80px]">
              {nickname}
            </span>
            <LevelBadge level={level} size="sm" />
          </div>
        </button>

        <button
          onClick={() => navigate('/profile')}
          className="flex items-center gap-1.5 bg-gradient-to-r from-gold-dark/20 to-gold/20 border border-gold/30 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
        >
          <span className="text-lg">💰</span>
          <span className="text-sm font-bold text-gold num">
            {chips.toLocaleString()}
          </span>
        </button>
      </div>
    </header>
  );
}
