// 扑克牌基础类型与牌堆
export type Suit = 's' | 'h' | 'd' | 'c'; // 黑桃 红桃 方块 梅花
export type Rank = number; // 2..14 (14 = A)

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const SUIT_SYMBOL: Record<Suit, string> = {
  s: '♠', h: '♥', d: '♦', c: '♣',
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ['s', 'h', 'd', 'c'] as Suit[]) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardToString(c: Card): string {
  return `${RANK_LABEL[c.rank]}${SUIT_SYMBOL[c.suit]}`;
}

export function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`;
}

/** 手牌记号，如 "AKs" / "AKo" / "AA" */
export function handNotation(c1: Card, c2: Card): string {
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  if (hi === lo) return `${RANK_LABEL[hi]}${RANK_LABEL[lo]}`;
  const suited = c1.suit === c2.suit;
  return `${RANK_LABEL[hi]}${RANK_LABEL[lo]}${suited ? 's' : 'o'}`;
}
