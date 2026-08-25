// 21点训练页面 v2：支持分牌 / 保险 / 双倍
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import {
  startRound, bjApply, bjInsurance, legalBjActions, handValue, canSplit,
  totalBet, totalPayout, type BjState, type BjAction, type BjHand,
} from '../games/blackjack/engine';
import { basicStrategyFull, gradeBjActionFull, countInfo, INSURANCE_TEACHING } from '../games/blackjack/strategy';
import { loadProfile, saveProfile } from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { cn } from '../lib/utils';

const BET_OPTIONS = [50, 100, 200, 500];
const ACTION_LABEL: Record<string, string> = { hit: '要牌', stand: '停牌', double: '双倍', split: '分牌' };

interface ActionLog { hand: number; action: string; correct: boolean; why: string }

export default function Blackjack() {
  const [profile, setProfile] = useState(loadProfile);
  const [game, setGame] = useState<BjState | null>(null);
  const [bet, setBet] = useState(100);
  const [showCount, setShowCount] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  const [log, setLog] = useState<ActionLog[]>([]);
  const [insuranceLog, setInsuranceLog] = useState<{ took: boolean; correct: boolean } | null>(null);
  const [sessionProfit, setSessionProfit] = useState(0);

  const deduct = useCallback((amount: number) => {
    setProfile(prev => {
      const next = { ...prev, points: Math.max(0, prev.points - amount) };
      saveProfile(next);
      return next;
    });
  }, []);

  const creditSettle = useCallback((s: BjState) => {
    // 返还：总投入 + 净盈亏 + 保险部分（本金 + 净赔付）
    const insuranceReturn = s.insuranceBet > 0 ? s.insuranceBet + (s.insurancePayout ?? 0) : 0;
    const credit = totalBet(s) + totalPayout(s) + insuranceReturn;
    setProfile(prev => {
      const next = { ...prev, points: Math.max(0, prev.points + credit) };
      saveProfile(next);
      return next;
    });
    setSessionProfit(p => p + totalPayout(s) + (s.insurancePayout ?? 0));
  }, []);

  const deal = useCallback(() => {
    if (profile.points < bet) return;
    deduct(bet);
    const s = startRound(bet);
    setLog([]);
    setInsuranceLog(null);
    setGame(s);
    if (s.phase === 'settled') creditSettle(s);
  }, [bet, profile.points, deduct, creditSettle]);

  const answerInsurance = useCallback((take: boolean) => {
    if (!game || game.phase !== 'insurance') return;
    const half = Math.floor(game.hands[0].bet / 2);
    if (take && profile.points < half) return;
    if (take) deduct(half);
    // 保险教学：基本策略永远不买（除非真计数高）
    if (coachOn) {
      const ci = countInfo(game.seenCards, game.shoe.length);
      const correct = take ? ci.trueCount >= 3 : true;
      setInsuranceLog({ took: take, correct });
    }
    const s = bjInsurance(game, take, half);
    setGame(s);
    if (s.phase === 'settled') creditSettle(s);
  }, [game, profile.points, coachOn, deduct, creditSettle]);

  const act = useCallback((action: BjAction) => {
    if (!game || game.phase !== 'player') return;
    const h = game.hands[game.activeHand];
    if (action === 'double' || action === 'split') {
      if (profile.points < h.bet) return;
      deduct(h.bet);
    }
    if (coachOn && action !== 'split') {
      const { grade, advice } = gradeBjActionFull(h.cards, game.dealerHand[0], action, canSplit(game));
      setLog(prev => [...prev, { hand: game.activeHand, action: ACTION_LABEL[action], correct: grade === 'excellent', why: advice.why }]);
    } else if (coachOn && action === 'split') {
      const { grade, advice } = gradeBjActionFull(h.cards, game.dealerHand[0], action, canSplit(game));
      setLog(prev => [...prev, { hand: game.activeHand, action: '分牌', correct: grade === 'excellent', why: advice.why }]);
    }
    const s = bjApply(game, action);
    setGame(s);
    if (s.phase === 'settled') creditSettle(s);
  }, [game, coachOn, profile.points, deduct, creditSettle]);

  const activeHand: BjHand | null = game && game.phase === 'player' ? game.hands[game.activeHand] : null;
  const advice = activeHand && coachOn
    ? basicStrategyFull(activeHand.cards, game!.dealerHand[0], canSplit(game!))
    : null;
  const ci = game ? countInfo(game.seenCards, game.shoe.length) : null;
  const dv = game ? handValue(game.dealerHand) : null;
  const canAffordBet = profile.points >= bet;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 flex-wrap safe-top">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">← 牌桌</Link>
        <Link to="/drills" className="text-slate-400 hover:text-slate-200 text-sm">🎯 刷题</Link>
        <h1 className="text-base font-bold">♣ 21点训练室</h1>
        <Badge className="bg-amber-600">{profile.points.toLocaleString()} 分</Badge>
        <span className="text-xs text-slate-400">盈亏 {sessionProfit >= 0 ? '+' : ''}{sessionProfit}</span>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-1.5">
            <Switch checked={coachOn} onCheckedChange={setCoachOn} /> 教练
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={showCount} onCheckedChange={setShowCount} /> 算牌
          </label>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-5 max-w-3xl mx-auto w-full">
        {/* 庄家 */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-sm text-slate-400">
            庄家 {game && (game.phase === 'settled') ? `· ${dv!.value} 点` : ''}
          </div>
          <div className="flex gap-2">
            {game ? game.dealerHand.map((c, i) => (
              <PlayingCard key={i} card={c} faceDown={i === 1 && game.phase !== 'settled'} />
            )) : (<><PlayingCard faceDown /><PlayingCard faceDown /></>)}
          </div>
        </div>

        <div className="text-slate-700 text-xl">⋯</div>

        {/* 玩家手牌（支持分牌多手） */}
        <div className="flex gap-6 flex-wrap justify-center">
          {game ? game.hands.map((h, i) => {
            const v = handValue(h.cards);
            const isActive = game.phase === 'player' && game.activeHand === i;
            return (
              <div key={i} className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 border',
                isActive ? 'border-amber-400 bg-amber-950/20' : 'border-transparent')}>
                <div className="flex gap-2">
                  {h.cards.map((c, j) => <PlayingCard key={j} card={c} />)}
                </div>
                <div className="text-xs text-slate-400">
                  {game.hands.length > 1 ? `第${i + 1}手 · ` : ''}{v.value} 点{v.soft ? '（软）' : ''} · 注 {h.bet}
                  {h.result && game.phase === 'settled' && (
                    <span className={cn('ml-1 font-bold',
                      h.result === 'win' ? 'text-emerald-400' : h.result === 'push' ? 'text-slate-300' : 'text-red-400')}>
                      {{ win: `+${h.payout}`, push: '平', lose: `${h.payout}`, bust: '爆' }[h.result]}
                    </span>
                  )}
                </div>
              </div>
            );
          }) : (
            <div className="flex gap-2"><PlayingCard faceDown /><PlayingCard faceDown /></div>
          )}
        </div>

        {/* 结果信息 */}
        {game?.phase === 'settled' && game.message && (
          <div className={`text-sm font-bold px-4 py-2 rounded-lg text-center ${
            (totalPayout(game) + (game.insurancePayout ?? 0)) > 0 ? 'bg-emerald-900/60 text-emerald-300' :
            (totalPayout(game) + (game.insurancePayout ?? 0)) < 0 ? 'bg-red-900/60 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
            {game.message}
          </div>
        )}

        {/* 保险询问 */}
        {game?.phase === 'insurance' && (
          <div className="flex flex-col items-center gap-2 bg-purple-950/40 border border-purple-800 rounded-xl px-4 py-3">
            <p className="text-sm text-purple-200">庄家明牌是 A，要买保险吗？（保险费 {Math.floor(game.hands[0].bet / 2)}，庄家 Blackjack 赔 2:1）</p>
            <div className="flex gap-2">
              <Button className="bg-purple-600 hover:bg-purple-500" onClick={() => answerInsurance(true)}
                disabled={profile.points < Math.floor(game.hands[0].bet / 2)}>买保险</Button>
              <Button variant="secondary" onClick={() => answerInsurance(false)}>不买</Button>
            </div>
            {coachOn && <p className="text-[11px] text-slate-400 max-w-md">💡 {INSURANCE_TEACHING.why}</p>}
          </div>
        )}
        {insuranceLog && game?.phase !== 'insurance' && (
          <p className={`text-xs ${insuranceLog.correct ? 'text-emerald-400' : 'text-amber-400'}`}>
            {insuranceLog.correct
              ? (insuranceLog.took ? '✅ 真计数够高，保险合理' : '✅ 不买保险是基本策略正解')
              : '⚠️ 真计数 <+3 时买保险是负期望，记住：基本策略永远不买保险'}
          </p>
        )}

        {/* 操作区 */}
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {!game || game.phase === 'settled' ? (
            <>
              <div className="flex gap-1.5">
                {BET_OPTIONS.map(b => (
                  <button key={b} onClick={() => setBet(b)}
                    className={`px-3 py-1.5 rounded-full text-sm font-bold border ${
                      bet === b ? 'bg-amber-600 border-amber-400' : 'bg-slate-800 border-slate-600'}`}>
                    {b}
                  </button>
                ))}
              </div>
              <Button size="lg" className="bg-amber-600 hover:bg-amber-500 px-8"
                disabled={!canAffordBet} onClick={deal}>
                {game ? '再来一局' : '发牌'}
              </Button>
              {!canAffordBet && <span className="text-red-400 text-xs">积分不足，请降低注码</span>}
            </>
          ) : game.phase === 'player' ? (
            <>
              <Button className="bg-sky-600 hover:bg-sky-500" onClick={() => act('hit')}>要牌</Button>
              <Button variant="secondary" onClick={() => act('stand')}>停牌</Button>
              {legalBjActions(game, profile.points).includes('double') && (
                <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => act('double')}>双倍</Button>
              )}
              {legalBjActions(game, profile.points).includes('split') && (
                <Button className="bg-violet-600 hover:bg-violet-500" onClick={() => act('split')}>分牌</Button>
              )}
            </>
          ) : null}
        </div>

        {/* 教练 + 算牌 + 决策记录 */}
        <div className="w-full grid md:grid-cols-2 gap-3">
          {advice && (
            <div className="rounded-lg bg-slate-900 border border-emerald-800/60 p-3 text-sm">
              <p className="font-semibold text-emerald-300 mb-1">🎓 基本策略建议：
                <span className="text-white font-bold ml-1">{ACTION_LABEL[advice.action]}</span>
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">{advice.why}</p>
            </div>
          )}
          {showCount && ci && (
            <div className="rounded-lg bg-slate-900 border border-purple-800/60 p-3 text-sm">
              <p className="font-semibold text-purple-300 mb-1">
                🔢 Hi-Lo：累积 <span className="font-mono text-white">{ci.running > 0 ? '+' : ''}{ci.running}</span>
                {' '}· 真计数 <span className="font-mono text-white">{ci.trueCount > 0 ? '+' : ''}{ci.trueCount}</span>
                {' '}· 剩 {ci.decksLeft} 副
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">{ci.edgeHint}</p>
            </div>
          )}
          {log.length > 0 && (
            <div className="rounded-lg bg-slate-900 border border-slate-700 p-3 text-sm md:col-span-2">
              <p className="font-semibold text-slate-300 mb-1">📒 本局决策</p>
              <div className="space-y-1">
                {log.map((l, i) => (
                  <p key={i} className="text-xs">
                    <span className={l.correct ? 'text-emerald-400' : 'text-red-400'}>
                      {l.correct ? '✅' : '❌'} {game && game.hands.length > 1 ? `第${l.hand + 1}手 ` : ''}{l.action}
                    </span>
                    <span className="text-slate-400 ml-2">{l.why}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-600 text-center">
          规则：4 副牌靴 · 庄家所有 17 停牌 · Blackjack 赔 1.5 倍 · 双倍 · 分牌（最多 4 手，分 A 各补一张）· 保险赔 2:1
        </p>
      </main>
    </div>
  );
}
