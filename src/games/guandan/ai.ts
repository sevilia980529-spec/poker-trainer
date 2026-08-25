// 掼蛋 AI：启发式决策（领出 / 跟牌 / 队友配合 / 炸弹时机）
import {
  analyzeCombo, canBeat, isWild, rankPower, teamOf,
  type GdCard, type GdState, type Combo, type Level,
} from './engine';

interface Candidate { cards: GdCard[]; combo: Combo }

/** 从手牌生成指定牌型/张数且能压过 target 的候选（不拆炸弹，除非 allowBombBreak） */
function generateCandidates(
  hand: GdCard[], level: Level, target: Combo | null, allowBombBreak = false,
): Candidate[] {
  const wilds = hand.filter(c => isWild(c, level));
  const normal = hand.filter(c => !isWild(c, level));
  const byRank = new Map<number, GdCard[]>();
  for (const c of normal) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);

  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (cards: GdCard[]) => {
    const combo = analyzeCombo(cards, level);
    if (!combo) return;
    if (target && !canBeat(combo, target, level)) return;
    const key = combo.type + combo.mainRank + combo.size + cards.map(c => c.id).sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cards, combo });
  };

  const ranks = [...byRank.keys()].sort((a, b) => rankPower(a, level) - rankPower(b, level));

  // 单张 / 对子 / 三张
  for (const r of ranks) {
    const cs = byRank.get(r)!;
    if (!target || target.type === 'single') push([cs[0]]);
    if (cs.length >= 2 && (!target || target.type === 'pair')) push([cs[0], cs[1]]);
    if (cs.length >= 3 && (!target || target.type === 'triple')) push([cs[0], cs[1], cs[2]]);
  }
  // 百搭补对子/三张
  if (wilds.length >= 1) {
    for (const r of ranks) {
      const cs = byRank.get(r)!;
      if (!target || target.type === 'pair') push([cs[0], wilds[0]]);
      if (cs.length >= 2 && (!target || target.type === 'triple')) push([cs[0], cs[1], wilds[0]]);
    }
  }

  // 三带二
  if (!target || target.type === 'fullhouse') {
    for (const r3 of ranks) {
      const t = byRank.get(r3)!;
      if (t.length < 3) continue;
      for (const r2 of ranks) {
        if (r2 === r3) continue;
        const p = byRank.get(r2)!;
        if (p.length >= 2) push([t[0], t[1], t[2], p[0], p[1]]);
      }
    }
  }

  // 顺子（5 张）：枚举窗口
  if (!target || target.type === 'straight' || target.type === 'straightFlush') {
    for (let lo = 2; lo <= 10; lo++) {
      const w = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
      tryStraight(w);
    }
    tryStraight([14, 2, 3, 4, 5]);
  }
  function tryStraight(w: number[]) {
    const picked: GdCard[] = [];
    let wildNeed = 0;
    for (const r of w) {
      const cs = byRank.get(r);
      if (cs && cs.length > 0) picked.push(cs[0]);
      else wildNeed++;
    }
    if (wildNeed <= wilds.length) {
      push([...picked, ...wilds.slice(0, wildNeed)]);
    }
  }

  // 连对（3 连）
  if (!target || target.type === 'pairSeq') {
    const len = target ? target.size / 2 : 3;
    for (let hi = 14; hi >= 2 + len; hi--) {
      const window: number[] = [];
      for (let r = hi - len + 1; r <= hi; r++) window.push(r);
      const picked: GdCard[] = [];
      let ok = true;
      for (const r of window) {
        const cs = byRank.get(r);
        if (!cs || cs.length < 2) { ok = false; break; }
        picked.push(cs[0], cs[1]);
      }
      if (ok) push(picked);
    }
  }

  // 钢板（2 连三张）
  if (!target || target.type === 'tripleSeq') {
    const len = target ? target.size / 3 : 2;
    for (let hi = 14; hi >= 2 + len; hi--) {
      const window: number[] = [];
      for (let r = hi - len + 1; r <= hi; r++) window.push(r);
      const picked: GdCard[] = [];
      let ok = true;
      for (const r of window) {
        const cs = byRank.get(r);
        if (!cs || cs.length < 3) { ok = false; break; }
        picked.push(cs[0], cs[1], cs[2]);
      }
      if (ok) push(picked);
    }
  }

  // 炸弹（含百搭补炸）
  const targetIsBomb = target && (target.type === 'bomb' || target.type === 'straightFlush' || target.type === 'jokerBomb');
  if (!target || targetIsBomb || allowBombBreak) {
    for (const r of ranks) {
      const cs = byRank.get(r)!;
      for (let k = 4; k <= cs.length + wilds.length && k <= 8; k++) {
        if (cs.length >= k) push(cs.slice(0, k));
        else if (cs.length + wilds.length >= k && cs.length >= 2) {
          push([...cs, ...wilds.slice(0, k - cs.length)]);
        }
      }
    }
    // 同花顺
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      const suitCards = new Map<number, GdCard>();
      for (const c of normal) if (c.suit === suit && c.rank < 15) suitCards.set(c.rank, c);
      for (let lo = 2; lo <= 10; lo++) {
        const w = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
        const picked: GdCard[] = [];
        let wildNeed = 0;
        for (const r of w) {
          const c = suitCards.get(r);
          if (c) picked.push(c);
          else wildNeed++;
        }
        if (wildNeed <= wilds.length) push([...picked, ...wilds.slice(0, wildNeed)]);
      }
    }
    // 王炸
    const jokers = normal.filter(c => c.rank >= 15);
    if (jokers.length === 4) push(jokers);
  }

  return out;
}

/** 拆弹成本：候选是否动用了炸弹材料 */
function breaksBomb(cand: Candidate, hand: GdCard[], level: Level): boolean {
  if (cand.combo.type === 'bomb' || cand.combo.type === 'straightFlush' || cand.combo.type === 'jokerBomb') return false;
  const usedIds = new Set(cand.cards.map(c => c.id));
  const normal = hand.filter(c => !isWild(c, level) && !usedIds.has(c.id));
  // 检查原本是否有炸弹被拆
  const countByRank = new Map<number, number>();
  for (const c of hand.filter(c => !isWild(c, level) && c.rank < 15)) {
    countByRank.set(c.rank, (countByRank.get(c.rank) ?? 0) + 1);
  }
  const usedByRank = new Map<number, number>();
  for (const c of cand.cards.filter(c => !isWild(c, level))) {
    usedByRank.set(c.rank, (usedByRank.get(c.rank) ?? 0) + 1);
  }
  for (const [r, n] of countByRank) {
    if (n >= 4 && (usedByRank.get(r) ?? 0) > 0) return true;
  }
  void normal;
  return false;
}

/** AI 主决策：返回要出的牌 id 数组；空数组 = 过牌 */
export function guandanAI(s: GdState, seat: number): number[] {
  const p = s.players[seat];
  const level = s.playingLevel;
  const hand = p.hand;
  const target: Combo | null = s.currentTrick && s.passCount < 3 && s.lastPlaySeat !== seat
    ? s.currentTrick.plays[s.currentTrick.plays.length - 1].combo
    : null;
  const lastSeat = s.lastPlaySeat;
  const partnerPlayed = target !== null && lastSeat >= 0 && teamOf(lastSeat) === teamOf(seat) && lastSeat !== seat;

  // 能一手出完就出
  if (analyzeCombo(hand, level)) {
    const whole = analyzeCombo(hand, level)!;
    if (!target || canBeat(whole, target, level)) return hand.map(c => c.id);
  }

  if (!target) {
    // ===== 领出 =====
    // 优先甩长牌（顺子/连对/钢板），其次三张、对子，最后最小单张
    const cands = generateCandidates(hand, level, null);
    const nonBomb = cands.filter(c =>
      c.combo.type !== 'bomb' && c.combo.type !== 'straightFlush' && c.combo.type !== 'jokerBomb');
    const long = nonBomb.filter(c => ['straight', 'pairSeq', 'tripleSeq'].includes(c.combo.type));
    if (long.length > 0) {
      long.sort((a, b) => b.cards.length - a.cards.length || rankPower(a.combo.mainRank, level) - rankPower(b.combo.mainRank, level));
      return long[0].cards.map(c => c.id);
    }
    const triples = nonBomb.filter(c => c.combo.type === 'triple' || c.combo.type === 'fullhouse');
    if (triples.length > 0 && hand.length > 8) {
      triples.sort((a, b) => rankPower(a.combo.mainRank, level) - rankPower(b.combo.mainRank, level));
      return triples[0].cards.map(c => c.id);
    }
    const pairs = nonBomb.filter(c => c.combo.type === 'pair' && !breaksBomb(c, hand, level));
    if (pairs.length > 0 && hand.length > 4) {
      pairs.sort((a, b) => rankPower(a.combo.mainRank, level) - rankPower(b.combo.mainRank, level));
      return pairs[0].cards.map(c => c.id);
    }
    // 最小单张（不拆炸弹、优先出掉孤张）
    const singles = nonBomb.filter(c => c.combo.type === 'single' && !breaksBomb(c, hand, level));
    singles.sort((a, b) => rankPower(a.combo.mainRank, level) - rankPower(b.combo.mainRank, level));
    if (singles.length > 0) return singles[0].cards.map(c => c.id);
    return nonBomb[0]?.cards.map(c => c.id) ?? [hand[hand.length - 1].id];
  }

  // ===== 跟牌 =====
  // 队友出牌且已较大：让牌（配合）
  if (partnerPlayed) {
    const partnerPower = rankPower(target.mainRank, level);
    const isBomb = target.type === 'bomb' || target.type === 'straightFlush' || target.type === 'jokerBomb';
    if (isBomb || partnerPower >= 13 || Math.random() < 0.6) {
      // 队友强势 → 不压，除非我能出完
      return [];
    }
  }

  const cands = generateCandidates(hand, level, target).filter(c => !breaksBomb(c, hand, level));
  const nonBombCands = cands.filter(c =>
    c.combo.type !== 'bomb' && c.combo.type !== 'straightFlush' && c.combo.type !== 'jokerBomb');

  if (nonBombCands.length > 0) {
    nonBombCands.sort((a, b) => rankPower(a.combo.mainRank, level) - rankPower(b.combo.mainRank, level));
    // 用最小的能压住的牌
    const chosen = nonBombCands[0];
    // 消耗过大（动用百搭/大牌）且牌还多时，40% 概率忍一手
    const costly = chosen.cards.some(c => isWild(c, level) || rankPower(c.rank, level) >= 14);
    if (costly && hand.length > 12 && Math.random() < 0.4) return [];
    return chosen.cards.map(c => c.id);
  }

  // 没有普通牌能压 → 炸弹时机判断
  const opponents = s.players.filter(q => teamOf(q.seat) !== teamOf(seat) && !q.finished);
  const oppMinCards = Math.min(...opponents.map(q => q.hand.length), 99);
  const bombCands = generateCandidates(hand, level, target, true)
    .filter(c => ['bomb', 'straightFlush', 'jokerBomb'].includes(c.combo.type));
  if (bombCands.length > 0) {
    bombCands.sort((a, b) => a.combo.bombWeight - b.combo.bombWeight);
    const urgent = oppMinCards <= 6;           // 对手快跑完
    const partnerInTrouble = s.players[(seat + 2) % 4].hand.length <= 3 && !partnerPlayed;
    const lateGame = hand.length <= 8;
    if (urgent || partnerInTrouble || lateGame || Math.random() < 0.15) {
      return bombCands[0].cards.map(c => c.id);
    }
  }
  return []; // 过牌
}
