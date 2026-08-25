// 21点引擎 v2 冒烟测试：分牌 / 保险 / 双倍 / 基本策略 RTP
import {
  startRound, bjApply, bjInsurance, handValue, isBlackjack,
  canSplit, totalBet, totalPayout, type BjState,
} from './src/games/blackjack/engine';
import { basicStrategyFull, splitAdvice, hiLoValue, countInfo } from './src/games/blackjack/strategy';
import type { Card } from './src/engine/cards';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };
const c = (rank: number, suit: 's'|'h'|'d'|'c' = 's'): Card => ({ rank, suit });

// 1. 点数计算
assert(handValue([c(14), c(13)]).value === 21, 'A K = 21');
assert(handValue([c(14), c(14), c(9)]).value === 21, 'A A 9 = 21');
assert(handValue([c(14), c(6)]).soft && handValue([c(14), c(6)]).value === 17, 'A 6 软 17');
assert(isBlackjack([c(14), c(10)]), 'A T 是 Blackjack');

// 2. 分牌策略
assert(splitAdvice([c(14), c(14, 'h')], d10())?.shouldSplit === true, 'A-A 应分');
assert(splitAdvice([c(8), c(8, 'h')], d10())?.shouldSplit === true, '8-8 应分');
assert(splitAdvice([c(10), c(13)], d(6))?.shouldSplit === false, 'T-T 不分');
assert(splitAdvice([c(5), c(5, 'h')], d(6))?.shouldSplit === false, '5-5 不分');
assert(splitAdvice([c(9), c(9, 'h')], d(7))?.shouldSplit === false, '9-9 vs 7 不分');
assert(splitAdvice([c(9), c(9, 'h')], d(6))?.shouldSplit === true, '9-9 vs 6 分');

function d(r: number) { return c(r, 'h'); }
function d10() { return c(10, 'h'); }

// 3. 基本策略抽查
assert(basicStrategyFull([c(10), c(6)], d(10), false).action === 'hit', '硬16 vs T 要牌');
assert(basicStrategyFull([c(10), c(6)], d(5), false).action === 'stand', '硬16 vs 5 停牌');
assert(basicStrategyFull([c(6), c(5)], d(8), false).action === 'double', '11 vs 8 双倍');
assert(basicStrategyFull([c(6), c(5)], d(14), false).action === 'hit', '11 vs A 要牌');
assert(basicStrategyFull([c(8), c(8, 'h')], d(10), true).action === 'split', '8-8 vs T 分牌');
assert(basicStrategyFull([c(14), c(7)], d(9), false).action === 'hit', '软18 vs 9 要牌');

// 4. Hi-Lo
assert(hiLoValue(c(5)) === 1 && hiLoValue(c(13)) === -1 && hiLoValue(c(14)) === -1, 'Hi-Lo 值');
assert(Math.abs(countInfo([c(2), c(3), c(4), c(5), c(6)], 156).trueCount - 5 / 3) < 0.1, '真计数');

// 5. 分牌流程：构造必现对子——直接操作引擎模拟（统计性验证）
let splitRounds = 0, splitOk = 0;
for (let i = 0; i < 5000; i++) {
  let s: BjState = startRound(100);
  if (s.phase === 'insurance') s = bjInsurance(s, false, 50);
  if (s.phase !== 'player') continue;
  if (!canSplit(s)) continue;
  splitRounds++;
  s = bjApply(s, 'split');
  if (s.hands.length !== 2) { console.error('分牌后应有 2 手'); failures++; break; }
  if (s.hands[0].bet !== 100 || s.hands[1].bet !== 100) { console.error('分牌注额错误'); failures++; break; }
  // 打完两手
  let guard = 0;
  while (s.phase === 'player' && guard++ < 30) {
    const adv = basicStrategyFull(s.hands[s.activeHand].cards, s.dealerHand[0], canSplit(s));
    s = bjApply(s, adv.action === 'split' ? 'hit' : adv.action); // 防止嵌套分牌测试过深
  }
  if (s.phase !== 'settled') { console.error('分牌局未结算'); failures++; break; }
  if (s.hands.some(h => h.payout === undefined)) { console.error('有手牌未结算'); failures++; break; }
  splitOk++;
}
assert(splitRounds > 100, `应遇到足够多分牌机会，实际 ${splitRounds}`);
console.log(`分牌流程验证：${splitOk}/${splitRounds} 局正常结算`);

// 6. 保险流程（统计验证：庄家明牌 A 时）
let insRounds = 0, insOk = 0;
for (let i = 0; i < 5000; i++) {
  let s: BjState = startRound(100);
  if (s.phase !== 'insurance') continue;
  insRounds++;
  s = bjInsurance(s, true, 50);
  if (s.insuranceBet !== 50) { console.error('保险注应为 50'); failures++; break; }
  if (s.phase === 'settled') {
    // 庄家确有 BJ，保险应净赚 100
    if (s.insurancePayout !== 100) { console.error(`保险赔付错误: ${s.insurancePayout}`); failures++; break; }
  } else {
    if (s.insurancePayout !== -50) { console.error('保险未中应损失 50'); failures++; break; }
    // 继续打完
    let guard = 0;
    while (s.phase === 'player' && guard++ < 30) {
      const adv = basicStrategyFull(s.hands[s.activeHand].cards, s.dealerHand[0], canSplit(s));
      s = bjApply(s, adv.action === 'split' ? 'hit' : adv.action);
    }
  }
  insOk++;
}
assert(insRounds > 100, `应遇到足够多保险机会，实际 ${insRounds}`);
console.log(`保险流程验证：${insOk}/${insRounds} 局正常`);

// 7. 基本策略 + 分牌 RTP（2 万局）
let bankroll = 0, bets = 0;
for (let i = 0; i < 20000; i++) {
  let s: BjState = startRound(100);
  bets += 100;
  if (s.phase === 'insurance') s = bjInsurance(s, false, 50);
  let guard = 0;
  while (s.phase === 'player' && guard++ < 30) {
    const h = s.hands[s.activeHand];
    const adv = basicStrategyFull(h.cards, s.dealerHand[0], canSplit(s));
    if (adv.action === 'double' || adv.action === 'split') bets += h.bet;
    s = bjApply(s, adv.action);
  }
  assert(s.phase === 'settled', `局 ${i} 未结算`);
  bankroll += totalPayout(s);
}
const rtp = (bets + bankroll) / bets;
assert(rtp > 0.97 && rtp < 1.005, `含分牌基本策略 RTP 应约 99.5%，实际 ${(rtp * 100).toFixed(2)}%`);
console.log(`含分牌基本策略 20000 局 RTP = ${(rtp * 100).toFixed(2)}%`);

console.log(failures === 0 ? '✅ 21点 v2 全部测试通过' : `❌ ${failures} 个失败`);
process.exit(failures ? 1 : 0);
