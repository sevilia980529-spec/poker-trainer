// 用户档案：昵称/头像/XP/签到（zustand + localStorage 持久化）
// 欢乐豆钱包沿用 store/points.ts（游戏结算直接读写），本 store 只管成长体系
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getLevelProgress, type Level } from '../lib/level';

interface UserState {
  nickname: string;
  avatar: string;
  xp: number;
  lastDailyCheckin: number;
  consecutiveLoginDays: number;
  setNickname: (nickname: string) => void;
  setAvatar: (avatar: string) => void;
  addXP: (amount: number) => void;
  dailyCheckin: () => { xp: number; isNew: boolean };
}

export const AVATARS = ['😎', '🦊', '🐯', '🦁', '🐼', '🦅', '🐺', '🃏', '👑', '🤠', '🧙', '🥷'];

const DAILY_XP = 50;

function isSameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

function isConsecutiveDay(prev: number, curr: number) {
  const d1 = new Date(prev);
  const d2 = new Date(curr);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return (d2.getTime() - d1.getTime()) / 86400000 === 1;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      nickname: '新玩家',
      avatar: '😎',
      xp: 0,
      lastDailyCheckin: 0,
      consecutiveLoginDays: 0,

      setNickname: (nickname) => set({ nickname: nickname.trim() || '新玩家' }),
      setAvatar: (avatar) => set({ avatar }),
      addXP: (amount) => set((s) => ({ xp: s.xp + amount })),

      dailyCheckin: () => {
        const s = get();
        const now = Date.now();
        if (isSameDay(s.lastDailyCheckin, now)) return { xp: 0, isNew: false };
        const isConsec = s.lastDailyCheckin > 0 && isConsecutiveDay(s.lastDailyCheckin, now);
        set({
          lastDailyCheckin: now,
          consecutiveLoginDays: isConsec ? s.consecutiveLoginDays + 1 : 1,
          xp: s.xp + DAILY_XP,
        });
        return { xp: DAILY_XP, isNew: true };
      },
    }),
    { name: 'pokermind-user', version: 1 }
  )
);

export const useLevel = (): {
  level: Level;
  nextLevel: Level | null;
  progress: number;
  xpToNext: number;
} => {
  const xp = useUserStore((s) => s.xp);
  return getLevelProgress(xp);
};
