// 21点训练页面 v3：拟真牌桌（庄家/玩家头像、呢绒台面、筹码下注、动效音效）
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import {
  startRound, bjApply, bjInsurance, legalBjActions, handValue, canSplit,
  totalBet, totalPayout, type BjState, type BjAction, type BjHand,
} from '../games/blackjack/engine';
import { basicStrategyFull, gradeBjActionFull, countInfo, INSURANCE_TEACHING } from '../games/blackjack/strategy';
import { loadProfile, saveProfile } from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Chip, ChipStack } from '../components/ChipStack';
import { playDeal, playChips, playClick, playWin, playLose } from '../lib/sound';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { RulesGuideDialog } from '../components/RulesGuide';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import Icon from '../components/Icon';

const BET_OPTIONS = [50, 100, 200, 500];
const ACTION_LABEL: Record<string, string> = { hit: '要牌', stand: '停牌', double: '双倍', split: '分牌' };

interface ActionLog { hand: number; action: string; correct: boolean; why: string }

/** 拟人头像圆牌 */
function Avatar({ label, tone }: { label: string; tone: 'dealer' | 'player' }) {
  return (
    <div className={cn(
      'w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold border-2 shadow-lg',
      tone === 'dealer'
        ? 'bg-gradient-to-b from-ink-light to-[#071007] border-amber-500/80 text-amber-200'
        : 'bg-gradient-to-b from-emerald-700 to-emerald-950 border-emerald-400/80 text-emerald-100',
    )}>
      {label}
    </div>
  );
}

export default function Blackjack() {
  const [profile, setProfile] = useState(loadProfile);
  const [game, setGame] = useState<BjState | null>(null);
  const [bet, setBet] = useState(100);
  const [showCount, setShowCount] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [log, setLog] = useState<ActionLog[]>([]);
  const [insuranceLog, setInsuranceLog] = useState<{ took: boolean; correct: boolean } | null>(null);
  const [sessionProfit, setSessionProfit] = useState(0);
  const [roundSeq, setRoundSeq] = useState(0);

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
    const net = totalPayout(s) + (s.insurancePayout ?? 0);
    setSessionProfit(p => p + net);
    if (net > 0) playWin(); else if (net < 0) playLose(); else playClick();
  }, []);

  const deal = useCallback(() => {
    if (profile.points < bet) return;
    deduct(bet);
    playChips(2);
    setTimeout(() => playDeal(), 150);
    setTimeout(() => playDeal(), 400);
    const s = startRound(bet);
    setLog([]);
    setInsuranceLog(null);
    setRoundSeq(r => r + 1);
    setGame(s);
    if (s.phase === 'settled') creditSettle(s);
  }, [bet, profile.points, deduct, creditSettle]);

  const answerInsurance = useCallback((take: boolean) => {
    if (!game || game.phase !== 'insurance') return;
    const half = Math.floor(game.hands[0].bet / 2);
    if (take && profile.points < half) return;
    if (take) { deduct(half); playChips(); } else playClick();
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
    if (action === 'hit') playDeal();
    else if (action === 'stand') playClick();
    else playChips(4);
    if (coachOn) {
      const { grade, advice } = gradeBjActionFull(h.cards, game.dealerHand[0], action, canSplit(game));
      setLog(prev => [...prev, { hand: game.activeHand, action: ACTION_LABEL[action], correct: grade === 'excellent', why: advice.why }]);
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
  const settled = game?.phase === 'settled';
  const netResult = game && settled ? totalPayout(game) + (game.insurancePayout ?? 0) : 0;

  return (
    <div className="min-h-dvh bg-[#071007] text-ivory flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 flex-wrap safe-top">
        <Link to="/" className="text-ivory/60 hover:text-ivory text-base flex items-center gap-1.5">
          <ArrowLeft className="w-5 h-5" />牌桌
        </Link>
        <Link to="/drills" className="text-ivory/60 hover:text-ivory text-base">专项训练</Link>
        <button onClick={() => setShowRules(true)} className="text-ivory/60 hover:text-ivory text-base">规则</button>
        <h1 className="text-xl font-bold">21点训练室</h1>
        <span className={cn('text-sm font-mono', sessionProfit > 0 ? 'text-emerald-400' : sessionProfit < 0 ? 'text-red-400' : 'text-ivory/45')}>
          盈亏 {sessionProfit >= 0 ? '+' : ''}{sessionProfit}
        </span>
        <div className="ml-auto flex items-center gap-3 text-sm text-ivory/80">
          <label className="flex items-center gap-1.5">
            <Switch checked={coachOn} onCheckedChange={setCoachOn} /> 教练
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={showCount} onCheckedChange={setShowCount} /> 算牌
          </label>
        </div>
      </header>

      <RulesGuideDialog open={showRules} onOpenChange={setShowRules} />

      <main className="flex-1 flex flex-col items-center p-3 gap-3 max-w-3xl mx-auto w-full">
        {/* ===== 牌桌呢绒区 ===== */}
        <div className="relative w-full rounded-[36px] border-[8px] border-[#4a3325] shadow-2xl overflow-hidden
          bg-[radial-gradient(ellipse_at_center,#1A7A52_0%,#0E5C3A_55%,#084A2D_100%)] px-4 py-5">

          {/* 庄家区 */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <Avatar label="庄" tone="dealer" />
              <div className="leading-tight">
                <p className="text-xs font-semibold text-ivory">庄家</p>
                <p className="text-[10px] text-ivory/60 font-mono">
                  {settled && dv ? `${dv.value} 点` : '17 点停牌'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 min-h-[68px]">
              {game ? game.dealerHand.map((c, i) => {
                const hidden = i === 1 && !settled;
                return (
                  <span key={`${roundSeq}-d${i}-${hidden}`} className={hidden ? 'anim-deal' : 'anim-flip'}
                    style={{ animationDelay: `${i * 150}ms` }}>
                    <PlayingCard card={c} faceDown={hidden} />
                  </span>
                );
              }) : (
                <>
                  <PlayingCard faceDown />
                  <PlayingCard faceDown />
                </>
              )}
            </div>
          </div>

          {/* 台面装饰文字 */}
          <div className="text-center my-2 select-none">
            <p className="text-[10px] tracking-[0.3em] text-emerald-200/30 font-bold">BLACKJACK PAYS 3 TO 2</p>
            <p className="text-[9px] tracking-[0.2em] text-emerald-200/20 mt-0.5">INSURANCE PAYS 2 TO 1</p>
          </div>

          {/* 结果横幅 */}
          {settled && game?.message && (
            <div className={cn('anim-pop relative left-1/2 mx-auto w-fit -translate-x-1/2 text-sm font-bold px-4 py-1.5 rounded-full text-center mb-2',
              netResult > 0 ? 'bg-emerald-900/80 text-emerald-300' :
              netResult < 0 ? 'bg-red-900/80 text-red-300' : 'bg-ink-light/90 text-ivory/80')}>
              {game.message}
            </div>
          )}

          {/* 玩家区（支持分牌多手） */}
          <div className="flex gap-4 flex-wrap justify-center">
            {game ? game.hands.map((h, i) => {
              const v = handValue(h.cards);
              const isActive = game.phase === 'player' && game.activeHand === i;
              return (
                <div key={i} className={cn('flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2 border transition-all',
                  isActive ? 'border-2 border-gold bg-amber-950/25' : 'border-white/5')}>
                  <div className="flex gap-1.5">
                    {h.cards.map((c, j) => (
                      <span key={`${roundSeq}-${i}-${j}-${c.rank}${c.suit}`} className="anim-deal"
                        style={{ animationDelay: `${(j + 1) * 130}ms` }}>
                        <PlayingCard card={c} />
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ivory/80">
                    <span className={cn('font-mono font-bold',
                      v.value > 21 ? 'text-red-400' : v.value === 21 ? 'text-amber-300' : 'text-ivory')}>
                      {game.hands.length > 1 ? `第${i + 1}手 · ` : ''}{v.value} 点{v.soft ? '（软）' : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 text-amber-300/90 font-mono">
                      <Chip size={14} />{h.bet}
                    </span>
                    {h.result && settled && (
                      <span className={cn('font-bold',
                        h.result === 'win' ? 'text-emerald-400' : h.result === 'push' ? 'text-ivory/80' : 'text-red-400')}>
                        {{ win: `+${h.payout}`, push: '平局', lose: `${h.payout}`, bust: '爆牌' }[h.result]}
                      </span>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="flex gap-2 opacity-60"><PlayingCard faceDown /><PlayingCard faceDown /></div>
            )}
          </div>

          {/* 玩家头像 + 当前下注 */}
          <div className="flex flex-col items-center gap-1 mt-3">
            <Avatar label="我" tone="player" />
            {game && !settled && totalBet(game) > 0 && (
              <ChipStack amount={totalBet(game)} size={20} />
            )}
          </div>
        </div>

        {/* ===== 保险询问 ===== */}
        {game?.phase === 'insurance' && (
          <div className="animate-pop-scale flex flex-col items-center gap-2 bg-purple-950/50 border border-purple-700 rounded-2xl px-5 py-3 w-full max-w-md">
            <p className="text-sm text-purple-200 text-center">
              庄家明牌是 A，要买保险吗？
              <span className="font-mono text-purple-300 ml-1">保费 {Math.floor(game.hands[0].bet / 2)}</span>
            </p>
            <div className="flex gap-3">
              <Button className="rounded-full bg-purple-600 hover:bg-purple-500 px-6" onClick={() => answerInsurance(true)}
                disabled={profile.points < Math.floor(game.hands[0].bet / 2)}>买保险</Button>
              <Button variant="secondary" className="rounded-full px-6" onClick={() => answerInsurance(false)}>不买</Button>
            </div>
            {coachOn && <p className="text-[11px] text-ivory/60 max-w-md text-center"><Icon e="💡" size={12} className="align-middle" /> {INSURANCE_TEACHING.why}</p>}
          </div>
        )}
        {insuranceLog && game?.phase !== 'insurance' && (
          <p className={cn('text-xs', insuranceLog.correct ? 'text-emerald-400' : 'text-amber-400')}>
            {insuranceLog.correct
              ? (insuranceLog.took
                  ? <><Icon e="✅" size={12} className="align-middle" /> 真计数够高，保险合理</>
                  : <><Icon e="✅" size={12} className="align-middle" /> 不买保险是基本策略正解</>)
              : <><Icon e="⚠️" size={12} className="align-middle" /> 真计数 &lt;+3 时买保险是负期望，记住：基本策略永远不买保险</>}
          </p>
        )}

        {/* ===== 操作区 ===== */}
        <div className="flex flex-col items-center gap-3 w-full safe-bottom">
          {!game || settled ? (
            <>
              {/* 筹码选注 */}
              <div className="flex items-end gap-4">
                {BET_OPTIONS.map(b => (
                  <button key={b} onClick={() => { setBet(b); playClick(); }}
                    className={cn('transition-all duration-150 rounded-full',
                      bet === b
                        ? '-translate-y-1.5 scale-105 drop-shadow-[0_6px_8px_rgba(0,0,0,0.5)]'
                        : 'opacity-60 hover:opacity-90')}>
                    <Chip amount={b} size={48} />
                  </button>
                ))}
              </div>
              <Button size="lg" className="rounded-full bg-amber-600 hover:bg-amber-500 px-10 h-12 text-lg shadow-xl"
                disabled={!canAffordBet} onClick={deal}>
                {game ? '再来一局' : '下注发牌'}
              </Button>
              {!canAffordBet && <span className="text-red-400 text-xs">积分不足，请降低注码</span>}
            </>
          ) : game.phase === 'player' ? (
            <div className="flex items-center gap-2 justify-center flex-wrap">
              <Button className="rounded-full h-12 px-7 bg-gold hover:bg-gold-light text-base" onClick={() => act('hit')}>要牌</Button>
              <Button className="rounded-full h-12 px-7 bg-ink-light hover:bg-ink text-ivory text-base" onClick={() => act('stand')}>停牌</Button>
              {legalBjActions(game, profile.points).includes('double') && (
                <Button className="rounded-full h-12 px-6 bg-emerald-600 hover:bg-emerald-500 text-base" onClick={() => act('double')}>双倍</Button>
              )}
              {legalBjActions(game, profile.points).includes('split') && (
                <Button className="rounded-full h-12 px-6 bg-violet-600 hover:bg-violet-500 text-base" onClick={() => act('split')}>分牌</Button>
              )}
            </div>
          ) : null}
        </div>

        {/* ===== 教练 + 算牌 + 决策记录 ===== */}
        <div className="w-full grid md:grid-cols-2 gap-3 pb-4">
          {advice && (
            <div className="rounded-xl bg-ink-card/80 border border-emerald-800/60 p-3 text-sm">
              <p className="font-semibold text-emerald-300 mb-1"><Icon e="🎓" size={14} className="align-middle" /> 基本策略建议：
                <span className="text-white font-bold ml-1">{ACTION_LABEL[advice.action]}</span>
              </p>
              <p className="text-xs text-ivory/60 leading-relaxed">{advice.why}</p>
            </div>
          )}
          {showCount && ci && (
            <div className="rounded-xl bg-ink-card/80 border border-purple-800/60 p-3 text-sm">
              <p className="font-semibold text-purple-300 mb-1">
                <Icon e="🔢" size={14} className="align-middle" /> Hi-Lo：累积 <span className="font-mono text-white">{ci.running > 0 ? '+' : ''}{ci.running}</span>
                {' '}· 真计数 <span className="font-mono text-white">{ci.trueCount > 0 ? '+' : ''}{ci.trueCount}</span>
                {' '}· 剩 {ci.decksLeft} 副
              </p>
              <p className="text-xs text-ivory/60 leading-relaxed">{ci.edgeHint}</p>
            </div>
          )}
          {log.length > 0 && (
            <div className="rounded-xl bg-ink-card/80 border border-ink-light/60 p-3 text-sm md:col-span-2">
              <p className="font-semibold text-ivory/80 mb-1"><Icon e="📒" size={14} className="align-middle" /> 本局决策</p>
              <div className="space-y-1">
                {log.map((l, i) => (
                  <p key={i} className="text-xs">
                    <span className={l.correct ? 'text-emerald-400' : 'text-red-400'}>
                      <Icon e={l.correct ? '✅' : '❌'} size={12} className="align-middle" /> {game && game.hands.length > 1 ? `第${l.hand + 1}手 ` : ''}{l.action}
                    </span>
                    <span className="text-ivory/60 ml-2">{l.why}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-ivory/35 text-center pb-3">
          规则：4 副牌靴 · 庄家所有 17 停牌 · Blackjack 赔 1.5 倍 · 双倍 · 分牌（最多 4 手，分 A 各补一张）· 保险赔 2:1
        </p>
      </main>
    </div>
  );
}
