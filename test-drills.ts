// 题库冒烟测试：每类生成 200 题，验证结构完整、正确答案有效
import { genDrill, DRILL_CATEGORY_INFO, type DrillCategory } from './src/ai/drills';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };

const cats = Object.keys(DRILL_CATEGORY_INFO) as DrillCategory[];
for (const cat of cats) {
  let correctCounts = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    const d = genDrill(cat);
    assert(d.prompt.length > 5, `${cat} #${i} prompt 为空`);
    assert(d.heroCards.length === 2, `${cat} #${i} heroCards 应为 2`);
    assert(d.options.length >= 2, `${cat} #${i} 选项不足`);
    assert(d.options.some(o => o.value === d.correct), `${cat} #${i} 正确答案不在选项中`);
    assert(d.explanation.length > 20, `${cat} #${i} 解析太短`);
    assert(d.concepts.length > 0, `${cat} #${i} 缺少教学标签`);
    correctCounts.set(d.correct, (correctCounts.get(d.correct) ?? 0) + 1);
  }
  // 答案分布检查：不能只出现一种答案（除了 betsize 固定正确尺度的场景外仍应有变化）
  console.log(`${cat}: 答案分布 =`, Object.fromEntries(correctCounts));
}

// preflop 题应当两种答案都出现
{
  let raise = 0, fold = 0;
  for (let i = 0; i < 200; i++) {
    const d = genDrill('preflop');
    if (d.correct === 'raise') raise++; else fold++;
  }
  assert(raise > 20 && fold > 20, `preflop 答案分布异常 raise=${raise} fold=${fold}`);
}

console.log(failures === 0 ? '✅ 题库测试通过' : `❌ ${failures} 个失败`);
process.exit(failures ? 1 : 0);
