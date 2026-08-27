// 账号系统：本地多账号（昵称/头像/XP/签到），zustand + localStorage 持久化。
// 顶层 nickname/avatar/xp... 作为「当前激活账号的镜像」，兼容既有调用点；
// accounts 保存全部账号，切换时回写镜像。Render 临时文件系统不影响（浏览器本地存储）。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getLevelProgress, type Level } from '../lib/level';

export interface Account {
  id: string;
  nickname: string;
  avatar: string; // emoji 或 dataURL
  xp: number;
  lastDailyCheckin: number;
  consecutiveLoginDays: number;
  createdAt: number;
}

interface UserState {
  // 当前激活账号镜像（兼容现有调用点）
  nickname: string;
  avatar: string;
  xp: number;
  lastDailyCheckin: number;
  consecutiveLoginDays: number;

  // 账号系统
  accounts: Account[];
  activeId: string | null;

  setNickname: (nickname: string) => void;
  setAvatar: (avatar: string) => void;
  addXP: (amount: number) => void;
  dailyCheckin: () => { xp: number; isNew: boolean };

  createAccount: (nickname: string, avatar: string) => string;
  switchAccount: (id: string) => void;
  updateAccount: (id: string, patch: Partial<Pick<Account, 'nickname' | 'avatar'>>) => void;
  deleteAccount: (id: string) => void;
  logout: () => void;
}

export const AVATARS = ['😎', '🦊', '🐯', '🦁', '🐼', '🦅', '🐺', '🃏', '👑', '🤠', '🧙', '🥷'];

const DAILY_XP = 50;

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function isSameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function isConsecutiveDay(prev: number, curr: number) {
  const d1 = new Date(prev);
  const d2 = new Date(curr);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return (d2.getTime() - d1.getTime()) / 86400000 === 1;
}

function mirror(acc: Account) {
  return {
    nickname: acc.nickname,
    avatar: acc.avatar,
    xp: acc.xp,
    lastDailyCheckin: acc.lastDailyCheckin,
    consecutiveLoginDays: acc.consecutiveLoginDays,
  };
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => {
      // 同步激活账号的镜像 + accounts 中对应记录
      const setActivePatch = (patch: Partial<Account>) => {
        const { activeId, accounts } = get();
        if (!activeId) {
          set(patch);
          return;
        }
        const next = accounts.map((a) => (a.id === activeId ? { ...a, ...patch } : a));
        set({ accounts: next, ...patch });
      };

      return {
        nickname: '新玩家',
        avatar: '😎',
        xp: 0,
        lastDailyCheckin: 0,
        consecutiveLoginDays: 0,
        accounts: [],
        activeId: null,

        setNickname: (nickname) => setActivePatch({ nickname: nickname.trim() || '新玩家' }),
        setAvatar: (avatar) => setActivePatch({ avatar }),
        addXP: (amount) => setActivePatch({ xp: get().xp + amount }),

        dailyCheckin: () => {
          const s = get();
          const now = Date.now();
          if (isSameDay(s.lastDailyCheckin, now)) return { xp: 0, isNew: false };
          const isConsec = s.lastDailyCheckin > 0 && isConsecutiveDay(s.lastDailyCheckin, now);
          setActivePatch({
            lastDailyCheckin: now,
            consecutiveLoginDays: isConsec ? s.consecutiveLoginDays + 1 : 1,
            xp: s.xp + DAILY_XP,
          });
          return { xp: DAILY_XP, isNew: true };
        },

        createAccount: (nickname, avatar) => {
          const id = genId();
          const acc: Account = {
            id,
            nickname: nickname.trim() || '新玩家',
            avatar: avatar || '😎',
            xp: 0,
            lastDailyCheckin: 0,
            consecutiveLoginDays: 0,
            createdAt: Date.now(),
          };
          set((st) => ({ accounts: [...st.accounts, acc], activeId: id, ...mirror(acc) }));
          return id;
        },

        switchAccount: (id) => {
          const acc = get().accounts.find((a) => a.id === id);
          if (!acc) return;
          set({ activeId: id, ...mirror(acc) });
        },

        updateAccount: (id, patch) => {
          set((st) => ({ accounts: st.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
          if (get().activeId === id) setActivePatch(patch);
        },

        deleteAccount: (id) => {
          set((st) => {
            const accounts = st.accounts.filter((a) => a.id !== id);
            if (st.activeId !== id) return { accounts };
            const next = accounts[0] ?? null;
            return {
              accounts,
              activeId: next ? next.id : null,
              ...(next
                ? mirror(next)
                : { nickname: '新玩家', avatar: '😎', xp: 0, lastDailyCheckin: 0, consecutiveLoginDays: 0 }),
            };
          });
        },

        logout: () => set({ activeId: null }),
      };
    },
    {
      name: 'pokermind-user',
      version: 2,
      migrate: (persisted: any, version: number) => {
        // v1：旧单账号结构（无 accounts 数组），迁移为单账号列表并自动激活
        if (version === 1 && persisted && typeof persisted === 'object') {
          const acc: Account = {
            id: genId(),
            nickname: persisted.nickname || '新玩家',
            avatar: persisted.avatar || '😎',
            xp: persisted.xp || 0,
            lastDailyCheckin: persisted.lastDailyCheckin || 0,
            consecutiveLoginDays: persisted.consecutiveLoginDays || 0,
            createdAt: Date.now(),
          };
          return { ...persisted, accounts: [acc], activeId: acc.id };
        }
        return persisted;
      },
    },
  ),
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
