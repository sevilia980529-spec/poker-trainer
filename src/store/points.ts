// 积分系统：本地持久化（localStorage）
export interface PlayerProfile {
  points: number;          // 当前积分（欢乐豆）
  handsPlayed: number;
  handsWon: number;
  totalProfit: number;     // 累计盈亏
  excellentActions: number;
  mistakes: number;
  biggestPot: number;
  createdAt: number;
}

const KEY = 'poker-trainer-profile-v1';
export const DAILY_BONUS = 2000;
export const STARTING_POINTS = 10000;
export const BUY_IN = 2000; // 上桌带入

export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultProfile(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultProfile();
}

export function defaultProfile(): PlayerProfile {
  return {
    points: STARTING_POINTS,
    handsPlayed: 0,
    handsWon: 0,
    totalProfit: 0,
    excellentActions: 0,
    mistakes: 0,
    biggestPot: 0,
    createdAt: Date.now(),
  };
}

export function saveProfile(p: PlayerProfile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** 积分不足时领取补给 */
export function claimRelief(p: PlayerProfile): PlayerProfile {
  return { ...p, points: p.points + DAILY_BONUS };
}

/** 复盘记录（每手牌的英雄决策评分） */
export interface HandReviewRecord {
  handNumber: number;
  timestamp: number;
  heroCards: string;
  position: string;
  result: number; // 盈亏
  actions: { street: string; action: string; grade: string; comment: string; concepts: string[] }[];
}

const REVIEW_KEY = 'poker-trainer-reviews-v1';
const MAX_REVIEWS = 50;

export function loadReviews(): HandReviewRecord[] {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

export function addReview(r: HandReviewRecord) {
  const list = [r, ...loadReviews()].slice(0, MAX_REVIEWS);
  localStorage.setItem(REVIEW_KEY, JSON.stringify(list));
}
