// 段位系统（复刻 PokerMind 规范）
export interface Level {
  name: string;
  shortName: string;
  minXP: number;
  color: string;
  textColor: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'star' | 'king';
  icon: string;
}

export const LEVELS: Level[] = [
  { name: '青铜 I', shortName: 'B1', minXP: 0, color: '#A0826D', textColor: '#FFFFFF', tier: 'bronze', icon: '🥉' },
  { name: '青铜 II', shortName: 'B2', minXP: 100, color: '#A0826D', textColor: '#FFFFFF', tier: 'bronze', icon: '🥉' },
  { name: '青铜 III', shortName: 'B3', minXP: 250, color: '#A0826D', textColor: '#FFFFFF', tier: 'bronze', icon: '🥉' },
  { name: '白银 I', shortName: 'S1', minXP: 500, color: '#C0C0C0', textColor: '#000000', tier: 'silver', icon: '⚪' },
  { name: '白银 II', shortName: 'S2', minXP: 800, color: '#C0C0C0', textColor: '#000000', tier: 'silver', icon: '⚪' },
  { name: '白银 III', shortName: 'S3', minXP: 1200, color: '#C0C0C0', textColor: '#000000', tier: 'silver', icon: '⚪' },
  { name: '黄金 I', shortName: 'G1', minXP: 1800, color: '#FFD700', textColor: '#000000', tier: 'gold', icon: '🥇' },
  { name: '黄金 II', shortName: 'G2', minXP: 2500, color: '#FFD700', textColor: '#000000', tier: 'gold', icon: '🥇' },
  { name: '黄金 III', shortName: 'G3', minXP: 3500, color: '#FFD700', textColor: '#000000', tier: 'gold', icon: '🥇' },
  { name: '铂金 I', shortName: 'P1', minXP: 5000, color: '#E5C5A0', textColor: '#000000', tier: 'platinum', icon: '💎' },
  { name: '铂金 II', shortName: 'P2', minXP: 7000, color: '#E5C5A0', textColor: '#000000', tier: 'platinum', icon: '💎' },
  { name: '铂金 III', shortName: 'P3', minXP: 10000, color: '#E5C5A0', textColor: '#000000', tier: 'platinum', icon: '💎' },
  { name: '钻石 I', shortName: 'D1', minXP: 14000, color: '#B9F2FF', textColor: '#000000', tier: 'diamond', icon: '💠' },
  { name: '钻石 II', shortName: 'D2', minXP: 19000, color: '#B9F2FF', textColor: '#000000', tier: 'diamond', icon: '💠' },
  { name: '钻石 III', shortName: 'D3', minXP: 25000, color: '#B9F2FF', textColor: '#000000', tier: 'diamond', icon: '💠' },
  { name: '星耀 I', shortName: 'K1', minXP: 32000, color: '#9B59B6', textColor: '#FFFFFF', tier: 'star', icon: '🌟' },
  { name: '星耀 II', shortName: 'K2', minXP: 40000, color: '#9B59B6', textColor: '#FFFFFF', tier: 'star', icon: '🌟' },
  { name: '星耀 III', shortName: 'K3', minXP: 50000, color: '#9B59B6', textColor: '#FFFFFF', tier: 'star', icon: '🌟' },
  { name: '王者', shortName: 'KG', minXP: 70000, color: '#FF4500', textColor: '#FFFFFF', tier: 'king', icon: '👑' },
];

export function calculateLevel(xp: number): Level {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXP) return LEVELS[i];
  }
  return LEVELS[0];
}

export function getLevelProgress(xp: number): {
  level: Level;
  nextLevel: Level | null;
  progress: number;
  xpToNext: number;
} {
  const level = calculateLevel(xp);
  const idx = LEVELS.indexOf(level);
  const nextLevel = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  if (!nextLevel) return { level, nextLevel: null, progress: 1, xpToNext: 0 };
  const span = nextLevel.minXP - level.minXP;
  return {
    level,
    nextLevel,
    progress: (xp - level.minXP) / span,
    xpToNext: nextLevel.minXP - xp,
  };
}
