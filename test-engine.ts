// 引擎冒烟测试：随机行动模拟多手牌，验证无崩溃 + 筹码守恒
import { newHand, applyAction, legalActions } from './src/engine/game';
import { calcEquity, analyzeDraws } from './src/engine/equity';
import { evaluate } from './src/engine/evaluate';
import { createDeck } from './src/engine/cards';
import { getCoachAdvice } from './src/ai/coach';
import { botDecide, BOT_STYLES } from './src/ai/bot';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error('FAIL:', msg); }
};

// 1. 牌型评估基本检查
const deck = createDeck();
const c = (r: number, s: 's'|'h'|'d'|'c') => deck.find(x => x.rank === r && x.suit === s)!;
const royal = evaluate([c(14,'s'), c(13,'s'), c(12,'s'), c(11,'s'), c(10,'s'), c(2,'h'), c(3,'d')]);
assert(royal.category === 8, `皇家同花顺应为 category 8，实际 ${royal.category} ${royal.name}`);
const quads = evaluate([c(9,'s'), c(9,'h'), c(9,'d'), c(9,'c'), c(5,'s'), c(2,'h'), c(3,'d')]);
assert(quads.category === 7, `四条应为 7，实际 ${quads.category}`);
const wheel = evaluate([c(14,'s'), c(2,'h'), c(3,'d'), c(4,'c'), c(5,'s'), c(9,'h'), c(11,'d')]);
assert(wheel.category === 4, `轮子顺应为 4，实际 ${wheel.category}`);
const pairA = evaluate([c(14,'s'), c(14,'h'), c(7,'d'), c(5,'c'), c(3,'s'), c(9,'h'), c(11,'d')]);
const pairK = evaluate([c(13,'s'), c(13,'h'), c(7,'d'), c(5,'c'), c(3,'s'), c(9,'h'), c(11,'d')]);
assert(pairA.score > pairK.score, 'AA 应大于 KK');

// 2. 胜率计算 sanity
const eqAA = calcEquity([c(14,'s'), c(14,'h')], [], 1, 400);
assert(eqAA.equity > 0.7 && eqAA.equity < 0.95, `AA 单挑胜率应约 85%，实际 ${(eqAA.equity*100).toFixed(1)}%`);
const eq72 = calcEquity([c(7,'s'), c(2,'h')], [], 1, 400);
assert(eq72.equity < 0.5, `72o 单挑胜率应较低，实际 ${(eq72.equity*100).toFixed(1)}%`);

// 3. 听牌分析
const draws = analyzeDraws([c(14,'h'), c(13,'h')], [c(12,'h'), c(2,'h'), c(7,'d')]);
assert(draws.flushDraw, '4 张红桃应检测为同花听牌');

// 4. 模拟 100 手完整对局（hero 随机行动，AI 用 bot 策略）
const names = ['你','A','B','C','D','E'];
const styleKeys = ['tag','lag','station','nit','balanced'];
let players = names.map((n, i) => ({ id: i, name: n, style: i === 0 ? 'hero' : styleKeys[i-1], chips: 2000, isHero: i === 0 }));
let dealer = 0;
for (let hand = 0; hand < 100; hand++) {
  players = players.map(p => ({ ...p, chips: p.chips <= 0 ? 2000 : p.chips }));
  const totalBefore = players.reduce((s, p) => s + p.chips, 0);
  let state = newHand(players, dealer, hand + 1);
  dealer = (dealer + 1) % 6;
  let steps = 0;
  while (state.street !== 'handOver' && steps < 500) {
    steps++;
    const idx = state.actingIdx;
    if (idx < 0) break;
    const la = legalActions(state, idx);
    let res;
    if (state.players[idx].isHero) {
      // hero 随机合法行动
      const opts: ('fold'|'check'|'call'|'raise')[] = [];
      if (la.canFold) opts.push('fold');
      if (la.canCheck) opts.push('check');
      if (la.canCall) opts.push('call');
      if (la.canRaise) opts.push('raise');
      const a = opts[Math.floor(Math.random() * opts.length)];
      res = applyAction(state, idx, a, a === 'raise' ? la.minRaiseTo : undefined);
    } else {
      const d = botDecide(state, idx, BOT_STYLES[state.players[idx].style] ?? BOT_STYLES.balanced);
      res = applyAction(state, idx, d.action, d.raiseTo);
    }
    if (!res.ok) { failures++; console.error(`FAIL hand ${hand}: action rejected:`, res.reason); break; }
    state = res.state;
  }
  assert(state.street === 'handOver', `hand ${hand} 应以 handOver 结束，实际 ${state.street}（steps=${steps}）`);
  const totalAfter = state.players.reduce((s, p) => s + p.chips, 0);
  assert(totalBefore === totalAfter, `hand ${hand} 筹码守恒：前 ${totalBefore} 后 ${totalAfter}`);
  players = state.players.map(p => ({ id: p.id, name: p.name, style: p.style, chips: p.chips, isHero: p.isHero }));
}

// 5. 教练建议不崩溃（每条街）
let st = newHand(players, 0, 999);
const adv = getCoachAdvice(st, 0);
assert(!!adv.recommendation, '翻牌前应给出建议');
st.community = [st.deck.pop()!, st.deck.pop()!, st.deck.pop()!];
st.street = 'flop';
const adv2 = getCoachAdvice(st, 0);
assert(!!adv2.recommendation && adv2.equity !== undefined, '翻牌后应给出建议和胜率');

console.log(failures === 0 ? '✅ 全部冒烟测试通过' : `❌ ${failures} 个断言失败`);
process.exit(failures === 0 ? 0 : 1);
