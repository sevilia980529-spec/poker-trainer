// 掼蛋 AI 集成测试：4 个 AI 自动打完整局 + 升级流程
import { newGuandanRound, gdPlay, type GdState, type Level } from './src/games/guandan/engine';
import { guandanAI } from './src/games/guandan/ai';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };

// 1. 单局完整性：20 局
for (let trial = 0; trial < 20; trial++) {
  let s: GdState = newGuandanRound([2, 2], 2, trial % 4);
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 3000) {
    const ids = guandanAI(s, s.turn);
    const r = gdPlay(s, s.turn, ids);
    if (!r.ok) {
      failures++;
      console.error(`trial ${trial} turn ${s.turn}: AI 行动被拒绝: ${r.reason}, ids=${ids.length}`);
      break;
    }
    s = r.state!;
  }
  if (s.phase === 'playing') {
    failures++;
    console.error(`trial ${trial}: 3000 步未结束，turn=${s.turn} 余牌=${s.players.map(p => p.hand.length).join(',')}`);
  } else {
    assert(s.roundResult !== undefined, `trial ${trial} 应有结果`);
    const gain = s.roundResult!.levelGain;
    assert(gain >= 1 && gain <= 3, `trial ${trial} 升级数 ${gain} 应在 1-3`);
    const totalCards = s.players.reduce((n, p) => n + p.hand.length, 0);
    assert(totalCards <= 27, `trial ${trial} 余牌异常: ${totalCards}`);
  }
}
console.log('20 局 AI 对局全部完成');

// 2. 整场比赛：模拟升级直到 matchOver（最多 30 局）
{
  let level: [Level, Level] = [2, 2];
  let playingLevel: Level = 2;
  let firstSeat = 0;
  let matchDone = false;
  for (let round = 0; round < 30 && !matchDone; round++) {
    let s: GdState = newGuandanRound(level, playingLevel, firstSeat);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 3000) {
      const r = gdPlay(s, s.turn, guandanAI(s, s.turn));
      if (!r.ok) { failures++; console.error('比赛模拟行动被拒', r.reason); break; }
      s = r.state!;
    }
    if (s.phase === 'playing') { failures++; console.error(`比赛第 ${round} 局未结束`); break; }
    if (s.phase === 'matchOver') {
      matchDone = true;
      assert(s.matchWinner !== undefined, '应有比赛胜者');
      console.log(`比赛在第 ${round + 1} 局结束，胜方：队${s.matchWinner}，最终级牌 ${s.level}`);
    } else {
      const winTeam = s.roundResult!.winningTeam;
      level = s.level;
      playingLevel = level[winTeam];
      firstSeat = s.roundResult!.order[0];
    }
  }
  assert(matchDone, '30 局内应分出比赛胜负');
}

console.log(failures === 0 ? '✅ 掼蛋 AI 集成测试通过' : `❌ ${failures} 个失败`);
process.exit(failures ? 1 : 0);
