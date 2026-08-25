// 专项训练题库生成器：位置起手牌 / 底池赔率 / 诈唬时机 / 下注尺度
import type { Card } from '../engine/cards';
import { createDeck, shuffle, cardToString, handNotation, RANK_LABEL } from '../engine/cards';
import { inOpeningRange } from './coach';

export type DrillCategory = 'preflop' | 'potodds' | 'bluff' | 'betsize';

export const DRILL_CATEGORY_INFO: Record<DrillCategory, { name: string; icon: string; desc: string }> = {
  preflop: { name: '位置与起手牌', icon: '🂡', desc: '不同位置该玩哪些牌' },
  potodds: { name: '底池赔率', icon: '🎯', desc: '用赔率决定跟注还是弃牌' },
  bluff:   { name: '诈唬时机', icon: '🃏', desc: '什么时候诈唬有利可图' },
  betsize: { name: '下注尺度', icon: '📏', desc: '下注多少才合理' },
};

export interface DrillOption { label: string; value: string }

export interface Drill {
  category: DrillCategory;
  prompt: string;          // 情景描述
  heroCards: Card[];
  board: Card[];
  detail?: string;         // 补充信息（底池、对手行动等）
  options: DrillOption[];
  correct: string;         // 正确选项 value
  explanation: string;     // 答案解析
  concepts: string[];
}

function randomHand(deck: Card[]): [Card, Card] {
  return [deck.pop()!, deck.pop()!];
}

// ---------- 1. 位置与起手牌 ----------
const PREFLOP_POSITIONS = ['UTG 枪口位', 'MP 中间位', 'CO 关煞位', 'BTN 按钮位', 'SB 小盲'] as const;
const RANGE_PCT: Record<string, string> = {
  'UTG 枪口位': '15%', 'MP 中间位': '20%', 'CO 关煞位': '30%', 'BTN 按钮位': '40%+', 'SB 小盲': '30%',
};

export function genPreflopDrill(): Drill {
  const deck = shuffle(createDeck());
  const [c1, c2] = randomHand(deck);
  const pos = PREFLOP_POSITIONS[Math.floor(Math.random() * PREFLOP_POSITIONS.length)];
  const hand = handNotation(c1, c2);
  const inRange = inOpeningRange(hand, pos);
  const alsoIn = PREFLOP_POSITIONS.filter(p => inOpeningRange(hand, p));

  return {
    category: 'preflop',
    prompt: `6 人桌，你在【${pos}】。前面所有人都弃牌，轮到你行动。`,
    heroCards: [c1, c2],
    board: [],
    detail: `手牌：${hand}`,
    options: [
      { label: '加注入局（2.5-3BB）', value: 'raise' },
      { label: '弃牌', value: 'fold' },
    ],
    correct: inRange ? 'raise' : 'fold',
    explanation: inRange
      ? `${hand} 在${pos}的开池范围内（该位置约玩前 ${RANGE_PCT[pos]} 起手牌）。✅ 标准打法是加注 2.5-3BB 开池——不要平跟，平跟会暴露牌力还鼓励多人入局。${alsoIn.length > 1 ? `这手牌在 ${alsoIn.map(p => p.split(' ')[0]).join('/')} 也都可以开池。` : ''}`
      : `${hand} 不在${pos}的开池范围（该位置只玩前 ${RANGE_PCT[pos]}）。❌ 位置越靠前，身后未行动的人越多，被反加和多人跟注的风险越大。弃牌省下的筹码就是赚到的。${alsoIn.length > 0 ? `提示：这手牌在 ${alsoIn.map(p => p.split(' ')[0]).join('/')} 可以开池。` : '这手牌在任何位置都该弃掉。'}`,
    concepts: ['位置与起手牌选择', 'RFI 开池范围'],
  };
}

// ---------- 2. 底池赔率 ----------
interface DrawSpec { name: string; outs: number }
const DRAWS: DrawSpec[] = [
  { name: '同花听牌', outs: 9 },
  { name: '两头顺听牌', outs: 8 },
  { name: '卡顺听牌', outs: 4 },
  { name: '同花+顺子组合听牌', outs: 15 },
  { name: '两张高牌', outs: 6 },
];

export function genPotOddsDrill(): Drill {
  const deck = shuffle(createDeck());
  const board = [deck.pop()!, deck.pop()!, deck.pop()!];
  const [c1, c2] = randomHand(deck);
  const draw = DRAWS[Math.floor(Math.random() * DRAWS.length)];
  const street = Math.random() < 0.5 ? 'flop' : 'turn';
  if (street === 'turn') board.push(deck.pop()!);
  // 四二法则
  const equity = street === 'flop' ? draw.outs * 4 : draw.outs * 2;
  const pot = (2 + Math.floor(Math.random() * 10)) * 20; // 40~240
  const betMulti = [0.33, 0.5, 0.66, 1.0, 1.5][Math.floor(Math.random() * 5)];
  const bet = Math.round(pot * betMulti);
  const potOdds = bet / (pot + 2 * bet); // 跟注所需胜率
  const shouldCall = equity / 100 >= potOdds;

  return {
    category: 'potodds',
    prompt: `${street === 'flop' ? '翻牌圈' : '转牌圈'}，你有【${draw.name}】（${draw.outs} 张补牌）。底池 ${pot}，对手下注 ${bet}，轮到你。`,
    heroCards: [c1, c2],
    board,
    detail: `底池 ${pot} · 对手下注 ${bet}（${(betMulti * 100).toFixed(0)}% 底池）· 跟注需 ${bet}`,
    options: [
      { label: '跟注', value: 'call' },
      { label: '弃牌', value: 'fold' },
    ],
    correct: shouldCall ? 'call' : 'fold',
    explanation:
      `四二法则：${street === 'flop' ? '翻牌圈' : '转牌圈'}胜率 ≈ ${draw.outs} 张补牌 × ${street === 'flop' ? '4' : '2'} = ${equity}%。\n` +
      `底池赔率：跟注 ${bet} 赢 ${pot + bet}，需要胜率 ≥ ${bet}/(${pot}+2×${bet}) = ${(potOdds * 100).toFixed(0)}%。\n` +
      (shouldCall
        ? `${equity}% ≥ ${(potOdds * 100).toFixed(0)}%，跟注是正期望（+EV）✅`
        : `${equity}% < ${(potOdds * 100).toFixed(0)}%，赔率不够，弃牌 ✅。对手下注越大，你的听牌越不值得追。`),
    concepts: ['底池赔率', '四二法则', '补牌数（Outs）'],
  };
}

// ---------- 3. 诈唬时机 ----------
interface BluffScenario {
  setup: () => { prompt: string; detail: string; hero: Card[]; board: Card[] };
  correct: 'bluff' | 'giveup';
  explanation: string;
}

function dryBoard(): Card[] {
  // 干燥面：彩虹、不连张、一高两低
  const ranks = shuffle([2, 3, 4, 5, 6, 7, 8, 9, 13]).slice(0, 3); // K + 两张小牌
  const suits = shuffle(['s', 'h', 'd'] as const);
  return [
    { rank: ranks[0], suit: suits[0] },
    { rank: ranks[1], suit: suits[1] },
    { rank: ranks[2], suit: suits[2] },
  ];
}

export function genBluffDrill(): Drill {
  const deck = shuffle(createDeck());
  const scenarios: BluffScenario[] = [
    {
      setup: () => {
        const board = dryBoard();
        return {
          prompt: '翻牌前你在按钮位加注，只有大盲跟注。翻牌是干燥面（彩虹、不连张），对手过牌。',
          detail: '单挑 · 你有位置 · 对手已示弱（过牌）',
          hero: randomHand(deck), board,
        };
      },
      correct: 'bluff',
      explanation: '✅ 这是教科书级的持续下注（C-Bet）诈唬时机：① 单挑底池，只需打走一个人；② 干燥面大概率谁都没中；③ 你是翻牌前加注者，牌面更"像"你的范围；④ 对手过牌示弱。下注 50-60% 底池即可，诈唬只需约 33-38% 的成功率就能回本。',
    },
    {
      setup: () => {
        const deck2 = shuffle(createDeck());
        const board = [
          { rank: 11, suit: 'h' as const }, { rank: 10, suit: 'h' as const }, { rank: 9, suit: 'h' as const },
        ];
        return {
          prompt: '翻牌是 J♥ T♥ 9♥ 的极度湿润面，前面 3 名对手，你什么都没中，行动到你。',
          detail: '3 名对手 · 牌面高度关联 · 你无对无听',
          hero: randomHand(deck2), board,
        };
      },
      correct: 'giveup',
      explanation: '❌ 这是最差劲的诈唬场合：① 3 名对手，全都弃牌的概率极低；② J-T-9 同花面几乎必定命中某人的范围（对子、顺子、同花听遍地都是）；③ 你没有补牌，被跟注后毫无退路。记住：诈唬的成功率 = 对手弃牌率，人多 + 湿面 = 弃牌率极低。省下这次诈唬的钱。',
    },
    {
      setup: () => {
        const deck2 = shuffle(createDeck());
        const board = [
          { rank: 14, suit: 's' as const }, { rank: 8, suit: 'd' as const }, { rank: 3, suit: 'c' as const },
        ];
        return {
          prompt: '翻牌 A-8-3 彩虹面。你是翻牌前加注者，单挑，对手过牌。你拿着 KQ 没中。',
          detail: '单挑 · A 高干燥面 · 你是加注者',
          hero: randomHand(deck2), board,
        };
      },
      correct: 'bluff',
      explanation: '✅ A 高干燥面对翻牌前加注者极为有利——你的范围里有大量 A（AK/AQ/AJ），而对手跟注范围里的 A 很少。这叫"范围优势"。即使你没中，持续下注 50% 底池经常直接收池。注意：如果对手跟注，转牌就要收手（一枪诈唬原则）。',
    },
    {
      setup: () => {
        const deck2 = shuffle(createDeck());
        const board = [
          { rank: 12, suit: 's' as const }, { rank: 11, suit: 's' as const },
          { rank: 4, suit: 'h' as const }, { rank: 4, suit: 'd' as const },
        ];
        return {
          prompt: '转牌圈牌面 Q♠ J♠ 4♥ 4♦。对手是跟注站风格（从不弃牌），你拿着 7♣6♣ 纯空气。',
          detail: '对手类型：跟注站 · 你无任何补牌',
          hero: randomHand(deck2), board,
        };
      },
      correct: 'giveup',
      explanation: '❌ 扑克第一戒律：永远不要诈唬跟注站！诈唬的全部利润来自对手弃牌，而跟注站用任何对子甚至 A 高牌都会跟到底。对付跟注站的正确策略恰恰相反：放弃诈唬，只用价值牌下注，等他们支付你。',
    },
  ];
  const s = scenarios[Math.floor(Math.random() * scenarios.length)];
  const { prompt, detail, hero, board } = s.setup();
  return {
    category: 'bluff',
    prompt,
    heroCards: hero,
    board,
    detail,
    options: [
      { label: '下注诈唬', value: 'bluff' },
      { label: '过牌放弃', value: 'giveup' },
    ],
    correct: s.correct,
    explanation: s.explanation,
    concepts: ['诈唬（Bluff）', '弃牌率（Fold Equity）', '对手类型识别'],
  };
}

// ---------- 4. 下注尺度 ----------
export function genBetSizeDrill(): Drill {
  const deck = shuffle(createDeck());
  const scenarios = [
    {
      prompt: '河牌圈，你击中坚果（最强牌），单挑，底池 300。对手是个爱跟注的玩家。你的下注尺度？',
      detail: '坚果牌 · 对手爱跟注 · 价值下注',
      options: [
        { label: '100（1/3 底池）', value: 'small' },
        { label: '210（70% 底池）', value: 'big' },
        { label: '全下 1200（4 倍底池）', value: 'overbet' },
      ],
      correct: 'big',
      explanation: '✅ 价值下注的尺度原则：在对手会跟注的范围下最大化。70% 底池是标准价值尺度——太小（1/3）白白少赚，太大（4 倍超池）只会吓跑弱牌、留下能击败你的牌。对付"爱跟注"的对手还可以再加大一点。',
    },
    {
      prompt: '河牌圈，你什么都没中，决定诈唬。单挑，底池 300，对手大概率也是弱牌。你的下注尺度？',
      detail: '纯诈唬 · 目的是让对手弃牌',
      options: [
        { label: '100（1/3 底池）', value: 'small' },
        { label: '200（2/3 底池）', value: 'big' },
        { label: '全下 1200（4 倍底池）', value: 'overbet' },
      ],
      correct: 'big',
      explanation: '✅ 诈唬要用"能达到目的的最小尺度"控制风险，但 1/3 底池太小——对手用任何对子都会跟（赔率太好）。2/3 底池给了对手错误的跟注赔率，又不用像超池那样冒险。诈唬的盈亏平衡：2/3 底池诈唬只需 40% 成功率即可回本。',
    },
    {
      prompt: '翻牌圈你持续下注被跟注，转牌你中了顶对顶踢脚（TPTK），牌面有两张同花听牌可能。底池 200，你先到行动。尺度？',
      detail: '顶对 · 湿润面有听牌 · 需要保护',
      options: [
        { label: '60（30% 底池）', value: 'small' },
        { label: '150（75% 底池）', value: 'big' },
      ],
      correct: 'big',
      explanation: '✅ 湿润面（有听牌可能）要加大下注尺度"收费"：75% 底池让同花听牌的跟注变成负期望（他们需要约 19% 胜率，你只给 25% 赔率但还要承担河牌反超风险）。这叫"保护牌力 + 拒绝赔率"。在干燥面反而可以小注。',
    },
    {
      prompt: '翻牌圈 K-7-2 彩虹干燥面，你是翻牌前加注者，单挑，对手过牌。你决定持续下注。底池 120。尺度？',
      detail: '干燥面 C-Bet · 对手范围很难中牌',
      options: [
        { label: '40（1/3 底池）', value: 'small' },
        { label: '110（90% 底池）', value: 'big' },
        { label: '240（2 倍超池）', value: 'overbet' },
      ],
      correct: 'small',
      explanation: '✅ 干燥面小注原则：牌面关联性差，对手要么中要么不中，几乎没有听牌需要"收费"。1/3 底池的小注既能打走空气牌，又能在被加注时便宜地弃牌，风险收益比最优。大注只会被强牌跟注——小注被跟注时省下的，就是长期利润。',
    },
    {
      prompt: '河牌圈你拿中对，对手连续过牌示弱。你想做"薄价值"下注（指望更弱的牌跟注）。底池 400。尺度？',
      detail: '薄价值下注 · 目标是被弱牌跟注',
      options: [
        { label: '120（30% 底池）', value: 'small' },
        { label: '320（80% 底池）', value: 'big' },
      ],
      correct: 'small',
      explanation: '✅ 薄价值下注要小：你的目标是让"只差你一点"的牌（弱对子、A 高牌）觉得便宜而跟注。下注 80% 底池，这些弱牌全部弃掉，只剩下能击败你的强牌跟注——等于自己筛选出输钱的局面。价值尺度永远问自己：多弱的牌会跟这个注？',
    },
  ];
  const s = scenarios[Math.floor(Math.random() * scenarios.length)];
  return {
    category: 'betsize',
    prompt: s.prompt,
    heroCards: randomHand(deck),
    board: [deck.pop()!, deck.pop()!, deck.pop()!],
    detail: s.detail,
    options: s.options,
    correct: s.correct,
    explanation: s.explanation,
    concepts: ['下注尺度（Bet Sizing）', '价值下注', '风险收益比'],
  };
}

export function genDrill(category: DrillCategory): Drill {
  switch (category) {
    case 'preflop': return genPreflopDrill();
    case 'potodds': return genPotOddsDrill();
    case 'bluff': return genBluffDrill();
    case 'betsize': return genBetSizeDrill();
  }
}

// 供测试：验证手牌记号与 chart 查询工作正常
export { cardToString, RANK_LABEL };
