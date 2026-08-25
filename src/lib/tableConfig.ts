// 牌桌配置：Lobby 页写入，PokerTrainer 读取
export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'gto';

export interface TableConfig {
  playerCount: number;      // 2 / 4 / 6（含 hero）
  difficulty: AIDifficulty;
}

const KEY = 'poker-table-config';

export function loadTableConfig(): TableConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as TableConfig;
      if ([2, 4, 6].includes(v.playerCount) && v.difficulty) return v;
    }
  } catch { /* ignore */ }
  return { playerCount: 6, difficulty: 'normal' };
}

export function saveTableConfig(c: TableConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/** 难度 → AI 风格组合（BOT_STYLES 的键，按座位顺序，取前 playerCount-1 个） */
export const DIFFICULTY_STYLES: Record<AIDifficulty, string[]> = {
  easy:   ['station', 'nit', 'station', 'nit', 'station'],
  normal: ['balanced', 'tag', 'station', 'lag', 'nit'],
  hard:   ['tag', 'lag', 'tag', 'balanced', 'lag'],
  gto:    ['balanced', 'tag', 'balanced', 'tag', 'balanced'],
};

export const BLIND_OPTIONS: [number, number][] = [[10, 20], [25, 50], [50, 100], [100, 200]];
