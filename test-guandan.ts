// 掼蛋引擎冒烟测试
import {
  analyzeCombo, canBeat, createGuandanDeck, newGuandanRound, gdPlay,
  rankPower, type GdCard, type Level,
} from './src/games/guandan/engine';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };

let idc = 1;
const g = (rank: number, suit: 's'|'h'|'d'|'c'|'j' = 's'): GdCard => ({ rank, suit, id: idc++ });
const LV: Level = 5; // 本局打 5，红桃5是百搭

// 1. 牌型识别
assert(analyzeCombo([g(7)], LV)?.type === 'single', '单张');
assert(analyzeCombo([g(7), g(7, 'h')], LV)?.type === 'pair', '对子');
assert(analyzeCombo([g(7), g(7, 'h'), g(7, 'd')], LV)?.type === 'triple', '三张');
assert(analyzeCombo([g(7), g(7, 'h'), g(7, 'd'), g(9), g(9, 'c')], LV)?.type === 'fullhouse', '三带二');
assert(analyzeCombo([g(3,'s'), g(4,'d'), g(5,'s'), g(6,'c'), g(7,'s')], LV)?.type === 'straight', '顺子 34567');
assert(analyzeCombo([g(14,'s'), g(2,'h'), g(3,'d'), g(4,'c'), g(5,'s')], LV)?.type === 'straight', 'A2345 顺子（A 作 1，5 非百搭因是黑桃）');
assert(analyzeCombo([g(10,'s'), g(11,'h'), g(12,'d'), g(13,'c'), g(14,'s')], LV)?.type === 'straight', 'TJQKA 顺子');
assert(analyzeCombo([g(3,'s'), g(3, 'h'), g(4,'s'), g(4, 'h'), g(5,'s'), g(5, 'd')], LV)?.type === 'pairSeq', '连对 334455');
assert(analyzeCombo([g(3), g(3, 'h'), g(3, 'd'), g(4), g(4, 'h'), g(4, 'd')], LV)?.type === 'tripleSeq', '钢板 333444');
assert(analyzeCombo([g(9), g(9, 'h'), g(9, 'd'), g(9, 'c')], LV)?.type === 'bomb', '四张炸');
assert(analyzeCombo([g(7, 'h'), g(8, 'h'), g(9, 'h'), g(10, 'h'), g(11, 'h')], LV)?.type === 'straightFlush', '同花顺');
assert(analyzeCombo([g(15, 'j'), g(15, 'j'), g(16, 'j'), g(16, 'j')], LV)?.type === 'jokerBomb', '王炸');
assert(analyzeCombo([g(3), g(4)], LV) === null, '两张不同牌不合法');
assert(analyzeCombo([g(3), g(4), g(5)], LV) === null, '三张不同牌不合法');

// 2. 百搭（逢人配：红桃级牌=红桃5）
const W = () => g(5, 'h'); // 百搭
assert(analyzeCombo([g(8), W()], LV)?.type === 'pair', '8+百搭 → 对子');
assert(analyzeCombo([g(8), g(8, 'd'), W()], LV)?.type === 'triple', '88+百搭 → 三张');
assert(analyzeCombo([g(3,'s'), g(4,'d'), W(), g(6,'c'), g(7,'s')], LV)?.type === 'straight', '百搭补顺子 3-4-?-6-7（补 5）');
assert(analyzeCombo([g(9), g(9, 'd'), g(9, 'c'), W()], LV)?.type === 'bomb', '999+百搭 → 四张炸');

// 3. 大小比较
const p5 = analyzeCombo([g(5, 's'), g(5, 'd')], LV)!; // 级牌对子（非百搭的 5）
const pA = analyzeCombo([g(14), g(14, 'h')], LV)!;
assert(canBeat(p5, pA, LV), '级牌对子 > AA');
assert(!canBeat(pA, p5, LV), 'AA < 级牌对子');
const bomb4 = analyzeCombo([g(2), g(2, 'h'), g(2, 'd'), g(2, 'c')], LV)!;
assert(canBeat(bomb4, p5, LV), '炸弹压任何非炸弹');
const bomb5 = analyzeCombo([g(2), g(2, 'h'), g(2, 'd'), g(2, 'c'), W()], LV)!;
assert(bomb5.type === 'bomb' && bomb5.bombWeight === 5, '4+百搭 = 五张炸');
assert(canBeat(bomb5, bomb4, LV), '五张炸 > 四张炸');
const sf = analyzeCombo([g(7, 'd'), g(8, 'd'), g(9, 'd'), g(10, 'd'), g(11, 'd')], LV)!;
assert(canBeat(sf, bomb5, LV), '同花顺 > 五张炸');
assert(!canBeat(sf, analyzeCombo([g(3),g(3,'h'),g(3,'d'),g(3,'c'),g(3,'s'),g(3,'h')], LV)!, LV), '六张炸 > 同花顺');
const jb = analyzeCombo([g(15, 'j'), g(15, 'j'), g(16, 'j'), g(16, 'j')], LV)!;
assert(canBeat(jb, sf, LV), '王炸 > 同花顺');
const s3 = analyzeCombo([g(3)], LV)!;
const s4 = analyzeCombo([g(4)], LV)!;
assert(!canBeat(s3, s4, LV) && canBeat(s4, s3, LV), '单张比大小');
const stA = analyzeCombo([g(10,'s'), g(11,'h'), g(12,'d'), g(13,'c'), g(14,'s')], LV)!;
const st9 = analyzeCombo([g(5, 's'), g(6,'h'), g(7,'d'), g(8,'c'), g(9,'s')], LV)!;
assert(st9.type === 'straight' && canBeat(stA, st9, LV), 'TJQKA > 56789');

// 4. rankPower
assert(rankPower(5, LV) > rankPower(14, LV), '级牌 > A');
assert(rankPower(15, LV) > rankPower(5, LV) && rankPower(16, LV) > rankPower(15, LV), '王 > 级牌');

// 5. 牌堆
assert(createGuandanDeck().length === 108, '两副牌 108 张');

// 6. 整局模拟：随机合法行动直到结束
let roundsDone = 0;
for (let trial = 0; trial < 30; trial++) {
  let s = newGuandanRound([2, 2], 2, trial % 4);
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 2000) {
    const seat = s.turn;
    const p = s.players[seat];
    // 尝试出最小的单张，不合法则过牌
    const sorted = [...p.hand].sort((a, b) => rankPower(a.rank, s.playingLevel) - rankPower(b.rank, s.playingLevel));
    let played = false;
    // 先试单张（从小到大）
    for (const c of sorted.slice(0, 5)) {
      const r = gdPlay(s, seat, [c.id]);
      if (r.ok) { s = r.state!; played = true; break; }
    }
    if (!played) {
      const r = gdPlay(s, seat, []);
      if (r.ok) s = r.state!;
      else { failures++; console.error(`trial ${trial}: 既无法出牌也无法过牌`, r.reason); break; }
    }
  }
  if (s.phase !== 'roundOver' && s.phase !== 'matchOver') {
    failures++;
    console.error(`trial ${trial}: 局未正常结束（guard=${guard}），phase=${s.phase}，turn=${s.turn}，各家余牌=${s.players.map(p => p.hand.length).join(',')}`);
  } else {
    roundsDone++;
    assert(s.roundResult !== undefined, '应有 roundResult');
    assert(s.players.every(p => p.finished), '所有玩家应有名次');
  }
}
console.log(`整局模拟：${roundsDone}/30 局正常打完`);

console.log(failures === 0 ? '✅ 掼蛋引擎测试通过' : `❌ ${failures} 个失败`);
process.exit(failures ? 1 : 0);
