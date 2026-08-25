// 教练系统：位置策略、起手牌表、行动建议与复盘评分
import type { Card } from '../engine/cards';
import { handNotation } from '../engine/cards';
import type { GameState } from '../engine/game';
import { legalActions, heroPositionName } from '../engine/game';
import { calcEquity, analyzeDraws, type EquityResult, type DrawInfo } from '../engine/equity';
import { evaluate } from '../engine/evaluate';

// ---------- 起手牌表（6-max 简化 RFI 范围）----------
const CHARTS: Record<string, string[]> = {
  'UTG 枪口位': [
    'AA','KK','QQ','JJ','TT','99','88','77',
    'AKs','AKo','AQs','AQo','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','KQo',
  ],
  'MP 中间位': [
    'AA','KK','QQ','JJ','TT','99','88','77','66','55',
    'AKs','AKo','AQs','AQo','AJs','AJo','ATs','A9s','A8s',
    'KQs','KQo','KJs','KTs','K9s','QJs','QTs','Q9s','JTs','J9s','T9s','98s',
  ],
  'CO 关煞位': [
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
    'AKs','AKo','AQs','AQo','AJs','AJo','ATs','ATo','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KQo','KJs','KJo','KTs','K9s','K8s','QJs','QJo','QTs','Q9s','JTs','J9s','T9s','T8s','98s','87s',
  ],
  'BTN 按钮位': [
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
    'AKs','AKo','AQs','AQo','AJs','AJo','ATs','ATo','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','A9o','A8o','A7o','A6o','A5o','A4o','A3o','A2o',
    'KQs','KQo','KJs','KJo','KTs','KTo','K9s','K8s','K7s','K6s','K5s',
    'QJs','QJo','QTs','QTo','Q9s','Q8s','Q7s','JTs','JTo','J9s','J8s','T9s','T8s','98s','87s','76s','65s',
  ],
  'SB 小盲': [
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
    'AKs','AKo','AQs','AQo','AJs','AJo','ATs','ATo','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KQo','KJs','KJo','KTs','K9s','K8s','QJs','QTs','Q9s','JTs','J9s','T9s','T8s','98s','87s','76s',
  ],
};

export function preflopChartFor(positionName: string): string[] {
  return CHARTS[positionName] ?? CHARTS['BTN 按钮位'];
}

export function inOpeningRange(hand: string, positionName: string): boolean {
  return preflopChartFor(positionName).includes(hand);
}

export type HandClass = 'premium' | 'strong' | 'playable' | 'weak';

export function classifyPreflop(c1: Card, c2: Card): { cls: HandClass; label: string } {
  const h = handNotation(c1, c2);
  if (/^(AA|KK|QQ|AKs|AKo)$/.test(h)) return { cls: 'premium', label: '顶级牌（Premium）' };
  if (/^(JJ|TT|AQs|AQo|AJs|KQs)$/.test(h)) return { cls: 'strong', label: '强牌' };
  return { cls: 'playable', label: '' };
}

// ---------- 位置教学 ----------
export const POSITION_TIPS: Record<string, string> = {
  'UTG 枪口位': '枪口位身后还有 5 人未行动，信息最少。只用最强的约 15% 起手牌加注入局，边缘牌直接弃掉。',
  'MP 中间位': '中间位可以比枪口稍宽，但仍需保持紧。重点是观察身后 CO/BTN 是否激进。',
  'CO 关煞位': '关煞位可以开始偷盲。如果按钮位和小盲偏紧，用约 30% 的牌加注偷盲是有利可图的。',
  'BTN 按钮位': '按钮位是最佳位置，翻牌后永远最后行动。可以玩最宽的范围（约 40%+），位置本身就是武器。',
  'SB 小盲': '小盲位已投入半盲，但翻牌后位置最差。要么加注要么弃牌，避免平跟（容易被大盲挤压）。',
  'BB 大盲': '大盲位已投入 1BB，面对加注时底池赔率好，可以用较宽范围防守，但翻牌后位置差，要打得直接。',
};

// ---------- 行动建议 ----------
export interface CoachAdvice {
  equity?: EquityResult;
  draws?: DrawInfo;
  handDesc: string;           // 当前牌力描述
  recommendation: 'fold' | 'check' | 'call' | 'raise';
  raiseSize?: number;         // 建议加注到
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];          // 建议理由（教学点）
  potOdds?: number;           // 跟注所需胜率
  isBluffSpot?: boolean;      // 是否为诈唬时机
  concepts: string[];         // 涉及的教学概念
}

export function getCoachAdvice(state: GameState, heroIdx: number): CoachAdvice {
  const hero = state.players[heroIdx];
  const la = legalActions(state, heroIdx);
  const pos = heroPositionName(state, heroIdx);
  const opponents = state.players.filter(p => !p.folded && !p.isHero).length;
  const reasons: string[] = [];
  const concepts: string[] = [];

  // ===== 翻牌前 =====
  if (state.street === 'preflop') {
    const hand = handNotation(hero.hole[0], hero.hole[1]);
    const { label } = classifyPreflop(hero.hole[0], hero.hole[1]);
    const inRange = inOpeningRange(hand, pos);
    const facingRaise = state.currentBet > state.bigBlind;

    if (!facingRaise) {
      // 无人加注（或仅盲注）：RFI 决策
      concepts.push('位置与起手牌选择');
      if (inRange) {
        reasons.push(`${hand} 在${pos}的开池范围内（约前 ${pos === 'BTN 按钮位' ? '40' : pos === 'UTG 枪口位' ? '15' : '25'}% 起手牌）`);
        reasons.push('标准打法：开池加注 2.5-3 个大盲，不要平跟（平跟会暴露牌力并鼓励多人入局）');
        return {
          handDesc: `${hand}${label ? ` · ${label}` : ''}`,
          recommendation: 'raise',
          raiseSize: state.bigBlind * 3,
          confidence: 'high', reasons, concepts,
        };
      }
      reasons.push(`${hand} 不在${pos}的开池范围内`);
      reasons.push(`${pos}应该用更紧的范围入局。弃牌长期来看是盈利的——"弃牌省下的就是赚到的"`);
      return {
        handDesc: hand, recommendation: 'fold', confidence: 'high', reasons, concepts,
      };
    }
    // 面对加注
    concepts.push('面对加注：3Bet 与跟注范围');
    const toCall = state.currentBet - hero.streetBet;
    const potAfterCall = state.pot + toCall;
    const potOdds = toCall / (potAfterCall + toCall);
    const strong = /^(AA|KK|QQ|JJ|AKs|AKo)$/.test(hand);
    const playableVsRaise = /^(TT|99|AQs|AQo|AJs|ATs|KQs|KJs|QJs|JTs|TT)$/.test(hand);
    if (strong) {
      reasons.push(`${hand} 属于顶级范围，面对加注应该 3Bet（再加注）到约 3 倍对手加注额，建立底池并缩小对手范围`);
      return {
        handDesc: `${hand} · ${label}`, recommendation: 'raise',
        raiseSize: Math.min(state.currentBet * 3, la.maxRaiseTo),
        confidence: 'high', reasons, potOdds, concepts,
      };
    }
    if (playableVsRaise && potOdds < 0.3) {
      reasons.push(`${hand} 有不错的可玩性，跟注价格 ${toCall}（需要胜率 ${(potOdds * 100).toFixed(0)}%）合理`);
      reasons.push('位置好或有隐含赔率时可以用对子/同花连张跟注看翻牌');
      return {
        handDesc: hand, recommendation: 'call', confidence: 'medium', reasons, potOdds, concepts,
      };
    }
    reasons.push(`${hand} 面对加注太弱。跟注需要的胜率约 ${(potOdds * 100).toFixed(0)}%，这手牌翻牌后很难反超`);
    return { handDesc: hand, recommendation: 'fold', confidence: 'high', reasons, potOdds, concepts };
  }

  // ===== 翻牌后 =====
  const equity = calcEquity(hero.hole, state.community, Math.max(opponents, 1), 1200);
  const draws = analyzeDraws(hero.hole, state.community);
  const made = evaluate([...hero.hole, ...state.community]);
  const toCall = state.currentBet - hero.streetBet;
  const potNow = state.players.reduce((sum, p) => sum + p.handBet, 0);
  const potOdds = toCall > 0 ? toCall / (potNow + 2 * toCall) : undefined;

  let handDesc = made.name;
  const drawDescs: string[] = [];
  if (draws.flushDraw) drawDescs.push('同花听牌(9张补牌)');
  if (draws.oesd) drawDescs.push('两头顺听牌(8张补牌)');
  if (draws.gutshot) drawDescs.push('卡顺听牌(4张补牌)');
  if (draws.overcards > 0 && made.category < 1) drawDescs.push(`${draws.overcards}张高牌`);
  if (drawDescs.length) handDesc += ' + ' + drawDescs.join('、');

  concepts.push('胜率（Equity）估算');
  const eq = equity.equity;
  reasons.push(`当前胜率约 ${(eq * 100).toFixed(0)}%（对阵 ${opponents} 名对手，${equity.iterations} 次模拟）`);

  // 强牌（两对以上或高胜率）
  const strongMade = made.category >= 2 || eq >= 0.7;
  const mediumMade = made.category === 1 || (eq >= 0.4 && eq < 0.7);

  if (toCall === 0) {
    // 无人下注：下注 or 过牌
    concepts.push('持续下注（C-Bet）与价值下注');
    if (strongMade) {
      reasons.push('你持有强牌，应该下注获取价值（Value Bet），建议下注底池的 60-70%');
      return {
        equity, draws, handDesc, recommendation: 'raise',
        raiseSize: Math.max(Math.round(potNow * 0.66), state.bigBlind),
        confidence: 'high', reasons, concepts,
      };
    }
    if (mediumMade && opponents <= 2) {
      reasons.push('中等牌力。可以小注试探（半个底池），也可以过牌控池');
      return {
        equity, draws, handDesc, recommendation: 'check', confidence: 'medium',
        reasons: [...reasons, '建议：对手弱时下注，对手激进时过牌跟注'], concepts,
      };
    }
    // 弱牌 → 诈唬评估
    concepts.push('诈唬（Bluff）时机');
    const isBluffSpot = opponents <= 2 && state.street !== 'flop' ? true : opponents === 1;
    if (isBluffSpot) {
      reasons.push(`你牌力弱（${made.name}），但只剩 ${opponents} 名对手且他们可能也没中牌`);
      reasons.push('这是一个不错的半诈唬/诈唬时机：下注 60% 底池，利用弃牌率（Fold Equity）直接赢');
      return {
        equity, draws, handDesc, recommendation: 'raise',
        raiseSize: Math.max(Math.round(potNow * 0.6), state.bigBlind),
        confidence: 'low', reasons, isBluffSpot: true, concepts,
      };
    }
    reasons.push(`牌力弱（${made.name}）且对手较多，诈唬成功率低，建议过牌控池`);
    return { equity, draws, handDesc, recommendation: 'check', confidence: 'medium', reasons, concepts };
  }

  // 面对下注：底池赔率 vs 胜率
  concepts.push('底池赔率（Pot Odds）');
  if (potOdds !== undefined) {
    reasons.push(`跟注 ${toCall} 赢 ${potNow + toCall} 的底池，需要胜率 ≥ ${(potOdds * 100).toFixed(0)}%，你当前胜率约 ${(eq * 100).toFixed(0)}%`);
  }
  if (strongMade) {
    reasons.push('牌力强且胜率远高于所需，建议加注获取价值（Value Raise）');
    return {
      equity, draws, handDesc, recommendation: 'raise',
      raiseSize: Math.min(state.currentBet * 3, la.maxRaiseTo),
      confidence: 'high', reasons, potOdds, concepts,
    };
  }
  if (potOdds !== undefined && eq >= potOdds + 0.05) {
    reasons.push('胜率高于底池赔率要求，跟注是正期望（+EV）的');
    return { equity, draws, handDesc, recommendation: 'call', confidence: 'high', reasons, potOdds, concepts };
  }
  if (draws.outs >= 8 && potOdds !== undefined && eq >= potOdds - 0.08) {
    concepts.push('隐含赔率（Implied Odds）');
    reasons.push(`你有 ${draws.outs} 张补牌的强听牌，虽然直接赔率略差，但听中后能赢更多（隐含赔率），可以跟注`);
    return { equity, draws, handDesc, recommendation: 'call', confidence: 'medium', reasons, potOdds, concepts };
  }
  reasons.push(`胜率 ${(eq * 100).toFixed(0)}% 低于所需 ${((potOdds ?? 0) * 100).toFixed(0)}%，跟注是负期望，弃牌`);
  return { equity, draws, handDesc, recommendation: 'fold', confidence: 'medium', reasons, potOdds, concepts };
}

// ---------- 行动评分（复盘） ----------
export type ActionGrade = 'excellent' | 'good' | 'ok' | 'mistake';

export interface GradedAction {
  street: string;
  action: string;
  grade: ActionGrade;
  comment: string;
  concepts: string[];
}

export function gradeAction(
  advice: CoachAdvice,
  actual: 'fold' | 'check' | 'call' | 'raise',
  actualAmount?: number,
): { grade: ActionGrade; comment: string } {
  const rec = advice.recommendation;
  if (actual === rec) {
    if (rec === 'raise' && advice.raiseSize && actualAmount) {
      const ratio = actualAmount / advice.raiseSize;
      if (ratio < 0.5) return { grade: 'ok', comment: `方向正确（加注），但尺度偏小。建议加到约 ${advice.raiseSize}，太小的加注给对手太好的跟注赔率。` };
      if (ratio > 2.5) return { grade: 'ok', comment: `方向正确（加注），但尺度偏大。过大的加注只会留下比你强的牌。建议约 ${advice.raiseSize}。` };
    }
    return { grade: 'excellent', comment: '与教练建议一致，打得不错！' };
  }
  const callLike = rec === 'call' || rec === 'check';
  const actualCallLike = actual === 'call' || actual === 'check';
  if (callLike && actualCallLike) {
    return { grade: 'good', comment: `建议${rec === 'call' ? '跟注' : '过牌'}，你选择了${actual === 'call' ? '跟注' : '过牌'}，结果相近。` };
  }
  if (rec === 'fold') {
    return { grade: 'mistake', comment: `建议弃牌：${advice.reasons[advice.reasons.length - 1] ?? ''}。继续玩这手牌长期是亏钱的。` };
  }
  if (actual === 'fold') {
    return { grade: 'mistake', comment: `建议${rec === 'raise' ? '加注' : '跟注'}但你弃牌了。${advice.reasons[0] ?? ''} 过度弃牌（Over-fold）会被对手剥削。` };
  }
  if (rec === 'raise' && actualCallLike) {
    return { grade: 'ok', comment: `牌力足够加注，你选择保守打法。少赚了价值，注意强牌要敢于建立底池。` };
  }
  if (callLike && actual === 'raise') {
    if (advice.isBluffSpot) return { grade: 'good', comment: '教练认为是过牌/跟注的局面，但这里确实有诈唬空间，激进打法可行。' };
    return { grade: 'ok', comment: '建议稳健打法，你选择了激进路线。注意激进需要建立在读牌基础上。' };
  }
  return { grade: 'ok', comment: '与建议不同，请留意背后的胜率与赔率逻辑。' };
}
