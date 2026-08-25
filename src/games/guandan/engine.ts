// 掼蛋规则引擎
// 4 人两副牌（108 张）、两队对抗（0&2 vs 1&3）、级牌、逢人配（红桃级牌百搭）、炸弹体系、升级
// MVP 简化：暂无进贡/还贡（下版本加）

import { RANK_LABEL } from '../../engine/cards';

// 掼蛋专用牌型：rank 2-14（A=14），小王 15，大王 16
export interface GdCard {
  rank: number;      // 2..16
  suit: 's' | 'h' | 'd' | 'c' | 'j'; // j = 王牌
  id: number;        // 唯一 id（两副牌有重复牌）
}

export const GD_SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣', j: '' };

export function gdCardLabel(c: GdCard): string {
  if (c.rank === 15) return '小王';
  if (c.rank === 16) return '大王';
  return `${RANK_LABEL[c.rank]}${GD_SUIT_SYMBOL[c.suit]}`;
}

let nextId = 1;
export function createGuandanDeck(): GdCard[] {
  const deck: GdCard[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit, id: nextId++ });
    }
    deck.push({ rank: 15, suit: 'j', id: nextId++ }); // 小王
    deck.push({ rank: 16, suit: 'j', id: nextId++ }); // 大王
  }
  return deck;
}

/** 级牌（2 开始，升级到 A=14） */
export type Level = number;

/** 逢人配：红桃级牌是百搭 */
export function isWild(c: GdCard, level: Level): boolean {
  return c.suit === 'h' && c.rank === level;
}

/** 比较大小的点数序：级牌 > A，小王/大王最高 */
export function rankPower(rank: number, level: Level): number {
  if (rank >= 15) return rank;         // 王
  if (rank === level) return 14.5;     // 级牌仅次于王
  return rank;                          // A=14 > K=13 ...
}

// ---------- 牌型 ----------
export type ComboType =
  | 'single' | 'pair' | 'triple' | 'fullhouse'
  | 'straight' | 'pairSeq' | 'tripleSeq'
  | 'bomb' | 'straightFlush' | 'jokerBomb';

export const COMBO_NAME: Record<ComboType, string> = {
  single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二',
  straight: '顺子', pairSeq: '连对', tripleSeq: '钢板',
  bomb: '炸弹', straightFlush: '同花顺', jokerBomb: '王炸',
};

export interface Combo {
  type: ComboType;
  mainRank: number;   // 比较用主点数（原始 rank，比较时转 power）
  size: number;       // 牌数
  bombWeight: number; // 炸弹层级：4张=4, 5张=5, 同花顺=5.5, 6张=6 ... 王炸=100；非炸弹=0
}

function isBombType(t: ComboType): boolean {
  return t === 'bomb' || t === 'straightFlush' || t === 'jokerBomb';
}

/** 顺子点数窗口（A 可作 1 或 14，级牌在顺子中按原始点数） */
const STRAIGHT_WINDOWS: number[][] = [];
for (let lo = 2; lo <= 10; lo++) STRAIGHT_WINDOWS.push([lo, lo + 1, lo + 2, lo + 3, lo + 4]);
STRAIGHT_WINDOWS.push([14, 2, 3, 4, 5]); // A2345

/**
 * 识别一组牌是否为合法牌型。wilds 自动填充。
 * 返回 Combo 或 null。
 */
export function analyzeCombo(cards: GdCard[], level: Level): Combo | null {
  if (cards.length === 0) return null;
  const wilds = cards.filter(c => isWild(c, level));
  const normal = cards.filter(c => !isWild(c, level));
  const nWild = wilds.length;
  const size = cards.length;

  // 王炸：4 张王（2 小王 + 2 大王）
  if (size === 4 && normal.every(c => c.rank >= 15) && normal.length === 4) {
    const hasSmall = normal.filter(c => c.rank === 15).length === 2;
    const hasBig = normal.filter(c => c.rank === 16).length === 2;
    if (hasSmall && hasBig) return { type: 'jokerBomb', mainRank: 16, size, bombWeight: 100 };
  }

  // 王牌处理：只能单张/对子/王炸，不能与百搭混组
  const hasJoker = normal.some(c => c.rank >= 15);
  if (hasJoker) {
    if (normal.every(c => c.rank >= 15) && nWild === 0) {
      if (size === 1) return { type: 'single', mainRank: normal[0].rank, size, bombWeight: 0 };
      if (size === 2 && normal[0].rank === normal[1].rank)
        return { type: 'pair', mainRank: normal[0].rank, size, bombWeight: 0 };
    }
    return null;
  }

  // 统计点数（非百搭）
  const byRank = new Map<number, GdCard[]>();
  for (const c of normal) {
    byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  }
  const ranks = [...byRank.keys()];
  const counts = [...byRank.values()].map(v => v.length);

  // 炸弹：同点数 4+ 张
  if (ranks.length === 1 && counts[0] + nWild >= 4 && size === counts[0] + nWild) {
    const total = counts[0] + nWild;
    if (total >= 4) return { type: 'bomb', mainRank: ranks[0], size, bombWeight: total };
  }
  if (ranks.length === 0 && nWild >= 4) {
    // 纯百搭 4+ 张：按级牌炸弹
    return { type: 'bomb', mainRank: level, size, bombWeight: nWild };
  }

  // 同花顺：5 张同花色顺子（百搭算同花色）
  if (size === 5) {
    const suits = new Set(normal.map(c => c.suit));
    if (suits.size === 1) {
      for (const w of STRAIGHT_WINDOWS) {
        if (fitsWindow(byRank, w, nWild)) {
          return { type: 'straightFlush', mainRank: windowHigh(w), size, bombWeight: 5.5 };
        }
      }
    }
  }

  // 单张 / 对子 / 三张
  if (ranks.length === 1 && size === counts[0] + nWild) {
    if (size === 1) return { type: 'single', mainRank: ranks[0], size, bombWeight: 0 };
    if (size === 2) return { type: 'pair', mainRank: ranks[0], size, bombWeight: 0 };
    if (size === 3) return { type: 'triple', mainRank: ranks[0], size, bombWeight: 0 };
  }
  if (ranks.length === 0) {
    // 纯百搭 1-3 张：当级牌本身
    if (size === 1) return { type: 'single', mainRank: level, size, bombWeight: 0 };
    if (size === 2) return { type: 'pair', mainRank: level, size, bombWeight: 0 };
    if (size === 3) return { type: 'triple', mainRank: level, size, bombWeight: 0 };
  }

  // 王牌单张/对子
  if (normal.every(c => c.rank >= 15) && nWild === 0) {
    if (size === 1) return { type: 'single', mainRank: normal[0].rank, size, bombWeight: 0 };
    if (size === 2 && normal[0].rank === normal[1].rank)
      return { type: 'pair', mainRank: normal[0].rank, size, bombWeight: 0 };
  }

  // 三带二
  if (size === 5) {
    const three = ranks.find(r => (byRank.get(r)?.length ?? 0) === 3);
    const two = ranks.find(r => (byRank.get(r)?.length ?? 0) === 2);
    if (three && two) return { type: 'fullhouse', mainRank: three, size, bombWeight: 0 };
    // 带百搭：3=2+1wild & 2=2, 或 3=3 & 2=1+1wild
    if (nWild >= 1 && ranks.length === 2) {
      const [a, b] = ranks;
      const ca = byRank.get(a)!.length, cb = byRank.get(b)!.length;
      // 尝试让 a 当三张
      if (ca + nWild >= 3 && cb + Math.max(0, nWild - (3 - ca)) >= 2 && ca <= 3 && cb <= 2) {
        const needA = Math.max(0, 3 - ca);
        const needB = Math.max(0, 2 - cb);
        if (needA + needB === nWild) return { type: 'fullhouse', mainRank: a, size, bombWeight: 0 };
      }
      if (cb + nWild >= 3 && ca + Math.max(0, nWild - (3 - cb)) >= 2 && cb <= 3 && ca <= 2) {
        const needB = Math.max(0, 3 - cb);
        const needA = Math.max(0, 2 - ca);
        if (needA + needB === nWild) return { type: 'fullhouse', mainRank: b, size, bombWeight: 0 };
      }
    }
  }

  // 顺子（5 张）
  if (size === 5) {
    for (const w of STRAIGHT_WINDOWS) {
      if (fitsWindow(byRank, w, nWild)) {
        return { type: 'straight', mainRank: windowHigh(w), size, bombWeight: 0 };
      }
    }
  }

  // 连对（3+ 连对）
  if (size >= 6 && size % 2 === 0) {
    const pairs = size / 2;
    const seq = findSequence(byRank, nWild, pairs, 2);
    if (seq !== null) return { type: 'pairSeq', mainRank: seq, size, bombWeight: 0 };
  }

  // 钢板（2+ 连三张）
  if (size >= 6 && size % 3 === 0) {
    const triples = size / 3;
    const seq = findSequence(byRank, nWild, triples, 3);
    if (seq !== null) return { type: 'tripleSeq', mainRank: seq, size, bombWeight: 0 };
  }

  return null;
}

function windowHigh(w: number[]): number {
  // A2345 的主点数按 5 算
  return w.includes(14) && w.includes(2) ? 5 : Math.max(...w);
}

/** 检查 byRank 的点数能否放进窗口 w（每个点数至多 1 张），缺位由 nWild 填充 */
function fitsWindow(byRank: Map<number, GdCard[]>, w: number[], nWild: number): boolean {
  const inWindow = new Set(w);
  let need = 0;
  for (const [r, cs] of byRank) {
    if (!inWindow.has(r)) return false;
    if (cs.length > 1) return false;
  }
  for (const r of w) if (!byRank.has(r)) need++;
  return need === nWild;
}

/** 连对/钢板：找 len 个连续点数，每个点数恰好 need 张（百搭补位）。返回最高点数。 */
function findSequence(byRank: Map<number, GdCard[]>, nWild: number, len: number, need: number): number | null {
  // 连续序列不含 2 和王，不含 A 低位（掼蛋连对/钢板 A 可作 1 接在 2 后？标准：不含 2、王；A 可作 14 或 1）
  // 简化：允许 A=14 结尾（...Q K A），A=1 按 A-2 不允许（含 2）。级牌按原点数参与。
  for (let hi = 14; hi >= len + 1; hi--) {
    const window: number[] = [];
    for (let r = hi - len + 1; r <= hi; r++) window.push(r);
    if (window.some(r => r < 3 || r === 15)) continue; // 最小 3
    let wildNeed = 0;
    let ok = true;
    const used = new Set([...byRank.keys()]);
    // 所有已有牌必须在窗口内
    for (const [r, cs] of byRank) {
      if (!window.includes(r)) { ok = false; break; }
      if (cs.length > need) { ok = false; break; }
      wildNeed += need - cs.length;
    }
    if (!ok) continue;
    if (wildNeed === nWild) return hi;
    void used;
  }
  return null;
}

/** 比较：play 能否压过 target（target 为 null 表示领出） */
export function canBeat(play: Combo, target: Combo | null, level: Level): boolean {
  if (!target) return true;
  const playBomb = isBombType(play.type);
  const targetBomb = isBombType(target.type);
  if (playBomb && !targetBomb) return true;
  if (!playBomb && targetBomb) return false;
  if (playBomb && targetBomb) return play.bombWeight > target.bombWeight;
  // 同类型同张数比主点数
  if (play.type !== target.type || play.size !== target.size) return false;
  return rankPower(play.mainRank, level) > rankPower(target.mainRank, level);
}

// ---------- 对局状态 ----------
export type GdPhase = 'playing' | 'roundOver' | 'matchOver';

export interface GdPlayer {
  seat: number;         // 0=你(下) 1=右 2=对家 3=左
  name: string;
  hand: GdCard[];
  finished: boolean;
  finishOrder: number;  // 0 未完成，1-4 名次
  isHero: boolean;
}

export interface GdState {
  players: GdPlayer[];
  level: [Level, Level];  // 两队级牌
  playingLevel: Level;    // 本局打哪个级（领先队/胜方级）
  currentTrick: { plays: { seat: number; cards: GdCard[]; combo: Combo }[] } | null;
  lastPlaySeat: number;   // 当前最大出牌者
  passCount: number;
  turn: number;
  finishCount: number;
  phase: GdPhase;
  roundResult?: { winningTeam: number; levelGain: number; order: number[] };
  matchWinner?: number;   // 0 或 1
  message?: string;
}

export function teamOf(seat: number): number {
  return seat % 2; // 0&2 → 队0，1&3 → 队1
}

export function newGuandanMatch(): { level: [Level, Level] } {
  return { level: [2, 2] };
}

export function newGuandanRound(level: [Level, Level], playingLevel: Level, firstSeat: number): GdState {
  const deck = createGuandanDeck();
  // 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const players: GdPlayer[] = [0, 1, 2, 3].map(seat => ({
    seat,
    name: ['你', '右边 AI', '对家 AI', '左边 AI'][seat],
    hand: deck.slice(seat * 27, seat * 27 + 27).sort(sortGdCards(playingLevel)),
    finished: false,
    finishOrder: 0,
    isHero: seat === 0,
  }));
  return {
    players,
    level: [...level] as [Level, Level],
    playingLevel,
    currentTrick: null,
    lastPlaySeat: -1,
    passCount: 0,
    turn: firstSeat,
    finishCount: 0,
    phase: 'playing',
  };
}

export function sortGdCards(level: Level) {
  return (a: GdCard, b: GdCard) => rankPower(b.rank, level) - rankPower(a.rank, level);
}

export interface GdPlayResult {
  ok: boolean;
  reason?: string;
  state?: GdState;
}

/** 出牌：cards 为空 = 过牌 */
export function gdPlay(s0: GdState, seat: number, cardIds: number[]): GdPlayResult {
  const s: GdState = structuredClone(s0);
  if (s.phase !== 'playing') return { ok: false, reason: '本局已结束' };
  if (s.turn !== seat) return { ok: false, reason: '没轮到你' };
  const p = s.players[seat];

  const isFreeLead = !s.currentTrick || s.lastPlaySeat === seat || s.passCount >= 3;

  if (cardIds.length === 0) {
    if (isFreeLead) return { ok: false, reason: '轮到你领出，不能过牌' };
    s.passCount++;
    s.message = `${p.name} 过牌`;
    return { ok: true, state: advanceTurn(s) };
  }

  const cards = p.hand.filter(c => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) return { ok: false, reason: '手牌中没有这些牌' };
  const combo = analyzeCombo(cards, s.playingLevel);
  if (!combo) return { ok: false, reason: '这不是合法牌型' };

  if (!isFreeLead) {
    const target = s.currentTrick!.plays[s.currentTrick!.plays.length - 1].combo;
    if (!canBeat(combo, target, s.playingLevel)) {
      return { ok: false, reason: `压不过 ${COMBO_NAME[target.type]}，或张数/牌型不符` };
    }
  }

  // 出牌
  p.hand = p.hand.filter(c => !cardIds.includes(c.id));
  if (isFreeLead || s.passCount >= 3) {
    s.currentTrick = { plays: [{ seat, cards, combo }] };
  } else {
    s.currentTrick!.plays.push({ seat, cards, combo });
  }
  s.lastPlaySeat = seat;
  s.passCount = 0;
  s.message = `${p.name} 出 ${COMBO_NAME[combo.type]}（${cards.map(gdCardLabel).join(' ')}）`;

  // 出完牌 → 名次
  if (p.hand.length === 0 && !p.finished) {
    p.finished = true;
    p.finishOrder = ++s.finishCount;
    const orderName = ['头游', '二游', '三游', '末游'][p.finishOrder - 1];
    s.message += `，${p.name} 成为${orderName}！`;
  }

  // 结束判定：3 人出完，或某队两人都出完
  const t0Done = s.players[0].finished && s.players[2].finished;
  const t1Done = s.players[1].finished && s.players[3].finished;
  if (s.finishCount >= 3 || t0Done || t1Done) {
    // 未出完的补末游
    for (const q of s.players) {
      if (!q.finished) { q.finished = true; q.finishOrder = ++s.finishCount; }
    }
    return { ok: true, state: endRound(s) };
  }

  return { ok: true, state: advanceTurn(s) };
}

function advanceTurn(s: GdState): GdState {
  // 三人过牌 → 最后出牌者（或其队友，接风）领出新一墩
  if (s.passCount >= 3 && s.currentTrick) {
    let leader = s.lastPlaySeat;
    if (s.players[leader].finished) {
      // 接风：队友领出
      leader = (leader + 2) % 4;
      if (s.players[leader].finished) leader = nextActive(s, leader);
    }
    s.currentTrick = null;
    s.passCount = 0;
    s.turn = leader;
    s.message += '。新一轮，由 ' + s.players[leader].name + ' 领出';
    return s;
  }
  s.turn = nextActive(s, s.turn);
  return s;
}

function nextActive(s: GdState, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const idx = (from + i) % 4;
    if (!s.players[idx].finished) return idx;
  }
  return from;
}

function endRound(s: GdState): GdState {
  const order = [...s.players].sort((a, b) => a.finishOrder - b.finishOrder).map(p => p.seat);
  const first = s.players.find(p => p.finishOrder === 1)!;
  const second = s.players.find(p => p.finishOrder === 2)!;
  const winTeam = teamOf(first.seat);
  const sameTeam12 = teamOf(second.seat) === winTeam;
  const partnerThird = s.players.find(p => p.finishOrder === 3)!;
  let gain: number;
  if (sameTeam12) gain = 3;        // 双下
  else if (teamOf(partnerThird.seat) === winTeam) gain = 2;
  else gain = 1;
  const newLevel: [Level, Level] = [...s.level] as [Level, Level];
  newLevel[winTeam] = Math.min(14, newLevel[winTeam] + gain);
  s.level = newLevel;
  s.phase = 'roundOver';
  s.roundResult = { winningTeam: winTeam, levelGain: gain, order };
  // 打 A 后获胜：简化——任一队级牌升到 14 后再赢一局即获胜；此处简化为升到 14 即赛点
  if (newLevel[winTeam] >= 14) {
    s.phase = 'matchOver';
    s.matchWinner = winTeam;
  }
  const names = order.map(seat => s.players[seat].name).join(' → ');
  s.message = `本局结束！名次：${names}。${winTeam === 0 ? '你方' : '对方'}升 ${gain} 级`;
  return s;
}
