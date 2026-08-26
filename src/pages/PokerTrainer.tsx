// 德州扑克 AI 训练场 — 主页面（专业牌类 App 布局：大牌桌 + 抽屉式教练 + 浮动菜单）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { GameState, ActionType } from '../engine/game';
import {
  newHand, applyAction, legalActions, isHeroTurn, heroPositionName, STREET_NAME,
} from '../engine/game';
import { cardToString } from '../engine/cards';
import { BOT_STYLES, botDecide, recordHeroFacingBet, type BotStyle } from '../ai/bot';
import { getCoachAdvice, gradeAction, type GradedAction, type CoachAdvice } from '../ai/coach';
import {
  loadProfile, saveProfile, claimRelief, addReview, loadReviews,
  BUY_IN, DAILY_BONUS, type PlayerProfile,
} from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Chip, ChipStack } from '../components/ChipStack';
import { playDeal, playChips, playClick, playFold, playWin, playLose, playShuffle, playPotSweep, isMuted, setMuted } from '../lib/sound';
import { loadTableConfig, DIFFICULTY_STYLES, BLIND_OPTIONS } from '../lib/tableConfig';
import { useUserStore } from '../store/userStore';
import { CoachPanel } from '../components/CoachPanel';
import { ReviewList } from '../components/ReviewList';
import { RulesGuideDialog } from '../components/RulesGuide';
import SettlementModal from '../components/SettlementModal';
import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/utils';
import { Menu, GraduationCap, Volume2, VolumeX, Coins, Target, Club, Users, BookOpen, Spade, Trophy, Settings, Home as HomeIcon } from 'lucide-react';

// 椭圆桌 5 个 AI 座位（hero 固定在桌面下方）——全部收进容器内侧，避免手机端挡牌/出屏
const AI_SEAT_POS = [
  'left-[3%] bottom-[-7%]',
  'left-[0%] top-[14%]',
  'left-1/2 -translate-x-1/2 top-[-20%]',
  'right-[0%] top-[14%]',
  'right-[3%] bottom-[-7%]',
];

const STYLE_EMOJI: Record<string, string> = {
  tag: '🦊', lag: '🔥', station: '🐷', nit: '🪨', balanced: '⚖️',
};

// 各座位中心相对牌桌容器的百分比坐标（用于筹码飞行动画）
const SEAT_PCT_HERO = { x: 50, y: 108 };
const SEAT_PCT_AI = [
  { x: 12, y: 100 },   // 左下
  { x: 8, y: 24 },     // 左上
  { x: 50, y: -10 },   // 正上
  { x: 92, y: 24 },    // 右上
  { x: 88, y: 100 },   // 右下
];

// AI 数量 → 使用哪些座位槽位（AI_SEAT_POS / SEAT_PCT_AI 的下标）
const SEAT_LAYOUTS: Record<number, number[]> = {
  1: [2],
  3: [1, 2, 3],
  5: [0, 1, 2, 3, 4],
};

export default function PokerTrainer() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PlayerProfile>(loadProfile);
  const [tableConfig] = useState(loadTableConfig);
  const botStyles = DIFFICULTY_STYLES[tableConfig.difficulty].slice(0, tableConfig.playerCount - 1);
  const botCount = botStyles.length;
  const seatSlots = SEAT_LAYOUTS[botCount] ?? SEAT_LAYOUTS[5];
  const [game, setGame] = useState<GameState | null>(null);
  const [dealerIdx, setDealerIdx] = useState(0);
  const [handNumber, setHandNumber] = useState(0);
  const [coachOn, setCoachOn] = useState(true);
  const [raiseAmt, setRaiseAmt] = useState(60);
  const [showRaise, setShowRaise] = useState(false);
  const [gradedActions, setGradedActions] = useState<GradedAction[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [handResult, setHandResult] = useState<{ delta: number; info: string } | null>(null);
  const [reviews, setReviews] = useState(loadReviews);
  const [showRules, setShowRules] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [soundOn, setSoundOn] = useState(!isMuted());
  const [blinds, setBlinds] = useState<[number, number]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('poker-blinds') ?? '[10,20]') as unknown;
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        return [v[0], v[1]];
      }
      return [10, 20];
    } catch { return [10, 20]; }
  });
  const heroStackRef = useRef(BUY_IN);
  const aiStacksRef = useRef<number[]>([]);
  const nickname = useUserStore((s) => s.nickname);
  const avatar = useUserStore((s) => s.avatar);
  const startStackRef = useRef(BUY_IN);
  const heroPosRef = useRef('');

  const startHand = useCallback((nextDealer: number) => {
    playShuffle();
    aiStacksRef.current = botStyles.map((_, i) => {
      const c = aiStacksRef.current[i];
      return c == null || c <= 0 ? BUY_IN : c;
    });
    if (heroStackRef.current <= 0) heroStackRef.current = Math.min(BUY_IN, profile.points);
    const players = [
      { id: 0, name: '你', style: 'hero', isHero: true, chips: heroStackRef.current },
      ...botStyles.map((k, i) => ({
        id: i + 1, name: BOT_STYLES[k].name.split('·')[0], style: k, isHero: false,
        chips: aiStacksRef.current[i],
      })),
    ];
    const g = newHand(players, nextDealer, handNumber + 1, blinds[0], blinds[1]);
    startStackRef.current = players[0].chips;
    heroPosRef.current = heroPositionName(g, 0);
    setHandNumber(h => h + 1);
    setGradedActions([]);
    setHandResult(null);
    setShowReview(false);
    setShowRaise(false);
    setShowSettle(false);
    setGame(g);
  }, [handNumber, profile.points, blinds]);

  // AI 行动循环
  useEffect(() => {
    if (!game || game.street === 'handOver' || game.street === 'showdown') return;
    const idx = game.actingIdx;
    if (idx < 0 || game.players[idx].isHero) return;
    const timer = setTimeout(() => {
      const style: BotStyle = BOT_STYLES[game.players[idx].style] ?? BOT_STYLES.balanced;
      const d = botDecide(game, idx, style, tableConfig.difficulty);
      if (d.action === 'fold') playFold();
      else if (d.action === 'check') playClick();
      else playChips();
      const res = applyAction(game, idx, d.action, d.raiseTo);
      if (res.ok) {
        setGame(res.state);
        if (res.handEnded) onHandEnd(res.state);
      }
    }, 1200 + Math.random() * 900);
    return () => clearTimeout(timer);
  }, [game]);

  // 新公共牌发出时播放发牌音
  const prevCommunityRef = useRef(0);
  useEffect(() => {
    const n = game?.community.length ?? 0;
    if (n > prevCommunityRef.current) playDeal();
    prevCommunityRef.current = n;
  }, [game?.community.length]);

  const toggleSound = () => {
    setSoundOn(prev => {
      const next = !prev;
      setMuted(!next);
      return next;
    });
  };

  // 结算时：底池筹码滑向赢家座位
  const [potFly, setPotFly] = useState<{ x: number; y: number; amount: number } | null>(null);
  useEffect(() => {
    if (!game || game.street !== 'handOver' || !game.winners?.length) return;
    const pot = game.winners.reduce((s, w) => s + w.amount, 0);
    const wId = game.winners[0].playerId;
    const target = wId === 0 ? SEAT_PCT_HERO : (SEAT_PCT_AI[seatSlots[wId - 1]] ?? SEAT_PCT_AI[2]);
    if (game.winners[0].playerId !== 0) playPotSweep();
    setPotFly({ x: 50, y: 42, amount: pot });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() =>
      setPotFly({ x: target.x, y: target.y, amount: pot })));
    const timer = setTimeout(() => setPotFly(null), 1000);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [game?.street]);

  // 结算面板：延迟 1.6s 弹出（先看清最终牌面）
  useEffect(() => {
    if (!game || game.street !== 'handOver') return;
    const t = setTimeout(() => setShowSettle(true), 1600);
    return () => clearTimeout(t);
  }, [game?.street, game?.handNumber]);

  const onHandEnd = useCallback((finalState: GameState) => {    const hero = finalState.players[0];
    const delta = hero.chips - startStackRef.current;
    if (delta > 0) playWin(); else if (delta < 0) playLose();
    const heroWon = finalState.winners?.some(w => w.playerId === 0) ?? false;
    useUserStore.getState().addXP(heroWon ? 30 : 10);
    aiStacksRef.current = finalState.players.slice(1).map(p => p.chips);
    heroStackRef.current = hero.chips;
    setProfile(prev => {
      const won = heroWon;
      const wonAmount = finalState.winners?.find(w => w.playerId === 0)?.amount ?? 0;
      const next: PlayerProfile = {
        ...prev,
        points: Math.max(0, prev.points + delta),
        handsPlayed: prev.handsPlayed + 1,
        handsWon: prev.handsWon + (won ? 1 : 0),
        totalProfit: prev.totalProfit + delta,
        biggestPot: Math.max(prev.biggestPot, wonAmount),
      };
      saveProfile(next);
      return next;
    });
    setGradedActions(prev => {
      addReview({
        handNumber: finalState.handNumber, timestamp: Date.now(),
        heroCards: hero.hole.map(cardToString).join(' '),
        position: heroPosRef.current, result: delta, actions: prev,
      });
      setReviews(loadReviews());
      return prev;
    });
    setHandResult({ delta, info: finalState.handOverInfo ?? '' });
  }, []);

  const heroAct = useCallback((action: ActionType, raiseTo?: number) => {
    if (!game || !isHeroTurn(game)) return;
    if (coachOn) {
      const advice = getCoachAdvice(game, 0);
      const actual: 'fold' | 'check' | 'call' | 'raise' =
        action === 'allin' || action === 'bet' ? 'raise' : action;
      const { grade, comment } = gradeAction(advice, actual, raiseTo);
      if (grade === 'excellent') useUserStore.getState().addXP(5);
      setProfile(prev => {
        const next = {
          ...prev,
          excellentActions: prev.excellentActions + (grade === 'excellent' ? 1 : 0),
          mistakes: prev.mistakes + (grade === 'mistake' ? 1 : 0),
        };
        saveProfile(next);
        return next;
      });
      setGradedActions(prev => [...prev, {
        street: STREET_NAME[game.street],
        action: action === 'raise' || action === 'bet' ? `加注到 ${raiseTo}` :
          action === 'allin' ? '全下' : { fold: '弃牌', check: '过牌', call: '跟注' }[action],
        grade, comment, concepts: advice.concepts,
      }]);
    }
    const res = applyAction(game, 0, action, raiseTo);
    if (res.ok) {
      if (game.currentBet > game.players[0].streetBet) recordHeroFacingBet(action === 'fold');
      if (action === 'fold') playFold();
      else if (action === 'check') playClick();
      else playChips();
      setShowRaise(false);
      setGame(res.state);
      if (res.handEnded) onHandEnd(res.state);
    }
  }, [game, coachOn, onHandEnd]);

  const advice: CoachAdvice | null = useMemo(() => {
    if (!game || !coachOn || !isHeroTurn(game) || game.players[0].folded) return null;
    return getCoachAdvice(game, 0);
  }, [game, coachOn]);

  useEffect(() => {
    if (!game || !isHeroTurn(game)) return;
    const la = legalActions(game, 0);
    const def = advice?.raiseSize ?? Math.min(game.bigBlind * 3, la.maxRaiseTo);
    setRaiseAmt(Math.min(Math.max(def, la.minRaiseTo), la.maxRaiseTo));
  }, [game?.actingIdx, game?.street]);

  const la = game && isHeroTurn(game) ? legalActions(game, 0) : null;
  const heroTurn = !!la && game !== null && !game.players[0].folded;

  const relief = () => {
    setProfile(prev => { const n = claimRelief(prev); saveProfile(n); return n; });
    if (heroStackRef.current <= 0) heroStackRef.current = BUY_IN;
  };

  const nextHand = () => { const d = (dealerIdx + 1) % tableConfig.playerCount; setDealerIdx(d); startHand(d); };

  return (
    <div className="h-dvh flex flex-col bg-[#071007] text-slate-100 overflow-hidden select-none">
      {/* ===== 浮动顶栏 ===== */}
      <header className="relative z-30 flex items-center justify-between px-3 py-2 safe-top">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-9 h-9 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-slate-300">
              <Menu className="w-[18px] h-[18px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-slate-900 border-slate-700 text-slate-100">
            <DropdownMenuItem asChild><Link to="/" className="flex items-center gap-2"><HomeIcon className="w-4 h-4 text-amber-400" />首页</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/training" className="flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" />训练中心</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/blackjack" className="flex items-center gap-2"><Club className="w-4 h-4 text-emerald-400" />21点训练室</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/room" className="flex items-center gap-2"><Users className="w-4 h-4 text-sky-400" />好友房</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowRules(true)}><BookOpen className="w-4 h-4 text-violet-400 mr-2" />规则与术语</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5 text-sm font-bold tracking-widest text-slate-300">
          <Spade className="w-4 h-4 text-emerald-400" />德州训练场
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setCoachOn(v => !v)} title="实时教练"
            className={cn('w-9 h-9 rounded-full border flex items-center justify-center transition-all',
              coachOn
                ? 'bg-emerald-900/80 border-emerald-600 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.45)]'
                : 'bg-slate-900/80 border-slate-700 text-slate-500')}>
            <GraduationCap className="w-[18px] h-[18px]" />
          </button>
          <button onClick={toggleSound} title="音效"
            className="w-9 h-9 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-slate-300">
            {soundOn ? <Volume2 className="w-[18px] h-[18px]" /> : <VolumeX className="w-[18px] h-[18px] text-slate-500" />}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button title="设置"
                className="w-9 h-9 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-slate-300">
                <Settings className="w-[18px] h-[18px]" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="bg-slate-900 border-slate-700 text-slate-100 w-56 text-sm">
              <p className="font-bold mb-2">牌桌设置</p>
              <p className="text-xs text-slate-400 mb-1.5">盲注（最低下注）</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BLIND_OPTIONS.map(([sb, bb]) => (
                  <button key={bb}
                    onClick={() => {
                      setBlinds([sb, bb]);
                      try { localStorage.setItem('poker-blinds', JSON.stringify([sb, bb])); } catch { /* ignore */ }
                    }}
                    className={cn('rounded-lg border px-2 py-1.5 text-xs font-mono transition',
                      blinds[1] === bb
                        ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                        : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500')}>
                    {sb} / {bb}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">从下一手牌开始生效</p>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button className="rounded-full bg-slate-900/80 border border-amber-700 px-3 py-1.5 text-sm font-bold text-amber-300 flex items-center gap-1.5">
                <Coins className="w-4 h-4" />{profile.points.toLocaleString()}
              </button>
            </PopoverTrigger>
            <PopoverContent className="bg-slate-900 border-slate-700 text-slate-100 w-64 text-sm">
              <p className="font-bold mb-2 flex items-center gap-1.5"><Trophy className="w-4 h-4 text-amber-400" />我的战绩</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">
                <span className="text-slate-500">积分</span><span className="text-amber-300 font-mono">{profile.points.toLocaleString()}</span>
                <span className="text-slate-500">手数</span><span>{profile.handsPlayed}</span>
                <span className="text-slate-500">胜率</span><span>{profile.handsPlayed ? Math.round(profile.handsWon / profile.handsPlayed * 100) : 0}%</span>
                <span className="text-slate-500">总盈亏</span><span>{profile.totalProfit >= 0 ? '+' : ''}{profile.totalProfit}</span>
                <span className="text-slate-500">最大底池</span><span>{profile.biggestPot}</span>
                <span className="text-slate-500">决策准确率</span>
                <span>{profile.excellentActions + profile.mistakes > 0
                  ? Math.round(profile.excellentActions / (profile.excellentActions + profile.mistakes) * 100) + '%' : '—'}</span>
              </div>
              {profile.points < BUY_IN && (
                <Button size="sm" className="w-full mt-3 bg-amber-600 hover:bg-amber-500" onClick={relief}>
                  领取补给 +{DAILY_BONUS}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* ===== 牌桌 ===== */}
      <main className="flex-1 relative flex items-center justify-center px-2">
        <div className="relative w-[min(96vw,820px)] aspect-[1.55/1] sm:aspect-[2.1/1]">
          {/* 桌面呢绒：多层渐变 + 木质桌沿 + 外发光（纵向内缩，给座位让位） */}
          <div className="absolute inset-x-0 top-[9%] bottom-[9%] rounded-[2.5rem] border-[10px] border-[#4a3325]
            bg-[radial-gradient(ellipse_at_center_top,#1A7A52_0%,#0E5C3A_35%,#084A2D_75%,#053822_100%)]
            shadow-[inset_0_20px_60px_rgba(0,0,0,0.4),inset_0_-10px_30px_rgba(0,0,0,0.3),0_0_80px_rgba(14,92,58,0.35)]" />
          {/* 桌面中心聚光光斑 */}
          <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-2/5 h-1/3 rounded-[50%] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse, rgba(255,255,200,0.09) 0%, transparent 70%)' }} />

          {/* 结算：底池筹码滑向赢家 */}
          {potFly && (
            <div className="pot-fly absolute z-40 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${potFly.x}%`, top: `${potFly.y}%` }}>
              <ChipStack amount={potFly.amount} size={30} />
            </div>
          )}

          {!game ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button size="lg" className="bg-amber-600 hover:bg-amber-500 text-lg px-10 h-14 rounded-full shadow-xl"
                onClick={() => startHand(dealerIdx)}>
                开始训练<span className="text-xs opacity-80 ml-2">盲注 {blinds[0]}/{blinds[1]}</span>
              </Button>
            </div>
          ) : (
            <>
              {/* 中央：底池 + 公共牌 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
                {game.players.reduce((s, p) => s + p.handBet, 0) > 0 && game.street !== 'handOver' && (
                  <ChipStack amount={game.players.reduce((s, p) => s + p.handBet, 0)} size={24} />
                )}
                <div key={game.players.reduce((s, p) => s + p.handBet, 0)}
                  className="text-gold font-bold text-xs sm:text-sm bg-gold/25 backdrop-blur-sm border border-gold/60 px-3 py-0.5 rounded-full anim-pot num">
                  底池 {game.players.reduce((s, p) => s + p.handBet, 0)} · {STREET_NAME[game.street]}
                </div>
                <div className="flex gap-1 sm:gap-1.5">
                  {game.community.map((c, i) => (
                    <span key={cardToString(c)} className="anim-flip" style={{ animationDelay: `${(i % 3) * 90}ms` }}>
                      <PlayingCard card={c} />
                    </span>
                  ))}
                  {Array.from({ length: 5 - game.community.length }).map((_, i) => (
                    <div key={`e${i}`} className="w-12 aspect-[5/7] rounded-md border-2 border-white/10" />
                  ))}
                </div>
                {game.street === 'handOver' && (
                  <div className="flex flex-col items-center gap-1.5 mt-1">
                    <p className="text-xs text-slate-200 bg-black/60 rounded-full px-3 py-1 max-w-72 text-center">{game.handOverInfo}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="border-slate-500 text-slate-200"
                        onClick={() => setShowReview(true)}>复盘</Button>
                      <Button size="sm" className="bg-amber-600 hover:bg-amber-500" onClick={nextHand}>下一手 ▶</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* AI 座位（左右下角的手牌横排在头像旁，收进桌面外暗区，不挡公共牌） */}
              {game.players.slice(1).map((p, i) => {
                const slot = seatSlots[i] ?? 2;
                const corner = slot === 0 || slot === 4;
                return (
                <div key={p.id} className={cn('absolute flex gap-1',
                  corner ? (slot === 0 ? 'flex-row-reverse items-center' : 'flex-row items-center')
                    : slot === 2 ? 'flex-col-reverse items-center' : 'flex-col items-center',
                  AI_SEAT_POS[slot], p.folded && 'opacity-40')}>
                  <div className="flex -space-x-3">
                    {p.hole.map((c, j) => {
                      const revealed = game.street === 'handOver' && !p.folded && !!game.winners;
                      return (
                        <span key={`${handNumber}-${p.id}-${j}-${revealed}`}
                          className={revealed ? 'anim-flip' : 'anim-deal'}
                          style={{ animationDelay: revealed ? `${j * 120}ms` : `${(i * 2 + j) * 90}ms` }}>
                          <PlayingCard card={c} small faceDown={!revealed} />
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex flex-col items-center gap-1">
                  <div className={cn('flex items-center gap-1.5 rounded-full bg-black/70 pl-1 pr-2.5 py-1 border',
                    game.actingIdx === p.id ? 'border-2 border-gold' : 'border-slate-700',
                    game.street === 'handOver' && game.winners?.some(w => w.playerId === p.id) && 'anim-winner border-amber-300')}>
                    <span className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-sm relative">
                      {STYLE_EMOJI[p.style] ?? '🤖'}
                      {game.dealerIdx === p.id && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-[8px] text-black font-bold flex items-center justify-center">D</span>
                      )}
                    </span>
                    <div className="leading-tight">
                      <div className="text-[11px] font-semibold whitespace-nowrap">{p.name}</div>
                      <div className="text-[10px] text-amber-300 font-mono">{p.chips}</div>
                    </div>
                  </div>
                  {game.actingIdx === p.id && game.street !== 'handOver' && (
                    <div className="flex gap-1 py-0.5">
                      {[0, 1, 2].map(d => (
                        <span key={d} className="think-dot w-1 h-1 rounded-full bg-amber-300"
                          style={{ animationDelay: `${d * 0.15}s` }} />
                      ))}
                    </div>
                  )}
                  {/* 下注徽章：统一在名字正下方 */}
                  {p.streetBet > 0 && (
                    <span key={p.streetBet} className="anim-chip inline-flex items-center gap-1 bg-black/70 rounded-full pl-0.5 pr-1.5 py-0.5">
                      <Chip size={15} />
                      <span className="text-[10px] font-mono text-amber-300 font-bold">{p.streetBet}</span>
                    </span>
                  )}
                  </div>
                  {p.lastAction && (
                    <div key={`${p.id}-${p.lastAction}-${game.actingIdx}`}
                      className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] bg-sky-600/90 rounded-full px-2 py-0.5 whitespace-nowrap anim-pop">
                      {p.lastAction}
                    </div>
                  )}
                </div>
                );
              })}

              {/* 我的座位（牌桌正下方暗区） */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-[-4%] flex flex-col items-center gap-1">
                {game.players[0].lastAction && (
                  <div key={`hero-${game.players[0].lastAction}-${game.actingIdx}`}
                    className="text-[10px] bg-sky-600/90 rounded-full px-2 py-0.5 whitespace-nowrap anim-pop">
                    {game.players[0].lastAction}
                  </div>
                )}
                <div className={cn('flex items-center gap-1.5 rounded-full bg-black/70 pl-1 pr-2.5 py-1 border',
                  game.actingIdx === 0 && game.street !== 'handOver' ? 'border-2 border-gold' : 'border-slate-700',
                  game.street === 'handOver' && game.winners?.some(w => w.playerId === 0) && 'anim-winner border-amber-300')}>
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-sm relative">
                    {avatar}
                    {game.dealerIdx === 0 && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-[8px] text-black font-bold flex items-center justify-center">D</span>
                    )}
                  </span>
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold whitespace-nowrap">{nickname}</div>
                    <div className="text-[10px] text-amber-300 font-mono num">{game.players[0].chips}</div>
                  </div>
                </div>
                {game.players[0].streetBet > 0 && (
                  <span key={`hero-bet-${game.players[0].streetBet}`} className="anim-chip inline-flex items-center gap-1 bg-black/70 rounded-full pl-0.5 pr-1.5 py-0.5">
                    <Chip size={15} />
                    <span className="text-[10px] font-mono text-amber-300 font-bold">{game.players[0].streetBet}</span>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ===== Hero 区域：手牌 + 教练条 + 操作 ===== */}
      {game && (
        <footer className="relative z-30 pb-3 pt-2 flex flex-col items-center gap-2 safe-bottom bg-gradient-to-t from-ink via-ink/95 to-ink/70 border-t border-white/5">
          {/* 位置 + 手牌 */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-2">
              {game.players[0].hole.map((c, i) => (
                <span key={`${handNumber}-${cardToString(c)}`} className="anim-deal" style={{ animationDelay: `${i * 130}ms` }}>
                  <PlayingCard card={c} />
                </span>
              ))}
            </div>
          </div>

          {/* 我的信息行：头像 + 昵称 + 位置 | 筹码 */}
          <div className="w-full max-w-lg flex items-center justify-between text-xs px-4">
            <div className="flex items-center gap-1.5">
              <span className="text-base">{avatar}</span>
              <span className="text-ivory font-medium">{nickname}</span>
              <span className="text-gold/80 font-bold">
                · {heroPositionName(game, 0)}{game.dealerIdx === 0 && ' · 庄家'}
              </span>
            </div>
            <div className="text-gold font-bold num">💰 {game.players[0].chips.toLocaleString()}</div>
          </div>

          {/* 教练建议条（点开看详情） */}
          {advice && (
            <Sheet>
              <SheetTrigger asChild>
                <button className="flex items-center gap-2 bg-emerald-950/80 border border-emerald-700 rounded-full px-4 py-1.5 text-xs">
                  <GraduationCap className="w-4 h-4 text-emerald-300" />
                  <span className="font-bold text-emerald-300">
                    {advice.recommendation === 'raise' ? `建议加注${advice.raiseSize ? '到 ' + advice.raiseSize : ''}`
                      : advice.recommendation === 'fold' ? '建议弃牌'
                      : advice.recommendation === 'call' ? '建议跟注' : '建议过牌'}
                  </span>
                  {advice.equity && <span className="text-sky-300 font-mono">胜率 {(advice.equity.equity * 100).toFixed(0)}%</span>}
                  <span className="text-slate-500">详情 ›</span>
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="bg-slate-950 border-slate-800 text-slate-100 w-full sm:max-w-md overflow-y-auto">
                <SheetHeader><SheetTitle className="text-slate-100">🎓 教练分析</SheetTitle></SheetHeader>
                <Tabs defaultValue="coach" className="mt-2">
                  <TabsList className="w-full">
                    <TabsTrigger value="coach" className="flex-1">教练</TabsTrigger>
                    <TabsTrigger value="history" className="flex-1">复盘记录</TabsTrigger>
                  </TabsList>
                  <TabsContent value="coach" className="mt-3">
                    <CoachPanel state={game} heroIdx={0} advice={advice} />
                  </TabsContent>
                  <TabsContent value="history" className="mt-3">
                    <ReviewHistory reviews={reviews} />
                  </TabsContent>
                </Tabs>
              </SheetContent>
            </Sheet>
          )}

          {/* 结算横幅 */}
          {handResult && game.street === 'handOver' && (
            <div className={cn('text-sm font-bold px-4 py-1 rounded-full',
              handResult.delta >= 0 ? 'bg-emerald-900/80 text-emerald-300' : 'bg-red-900/80 text-red-300')}>
              {handResult.delta >= 0 ? '+' : ''}{handResult.delta}
            </div>
          )}

          {/* 操作区 */}
          {heroTurn && game.street !== 'handOver' && (
            <div className="w-full max-w-lg flex flex-col items-center gap-2">
              {showRaise && la!.canRaise && (
                <div className="flex items-center gap-3 w-full px-4">
                  <Slider className="flex-1" min={la!.minRaiseTo} max={la!.maxRaiseTo} step={10}
                    value={[raiseAmt]} onValueChange={v => setRaiseAmt(v[0])} />
                  <span className="font-mono font-bold text-amber-300 w-16 text-right">{raiseAmt}</span>
                </div>
              )}
              <div className="flex items-center gap-2 justify-center">
                {(la!.canFold || la!.canCall) && (
                  <Button className="rounded-xl h-12 px-6 bg-danger hover:bg-red-600 text-base font-semibold" onClick={() => heroAct('fold')}>弃牌</Button>
                )}
                {la!.canCheck && (
                  <Button className="rounded-xl h-12 px-6 bg-ink-light hover:bg-ink-card border border-gold-dark/40 text-ivory text-base font-semibold" onClick={() => heroAct('check')}>过牌</Button>
                )}
                {la!.canCall && (
                  <Button className="rounded-xl h-12 px-6 bg-ink-light hover:bg-ink-card border border-gold-dark/40 text-ivory text-base font-semibold" onClick={() => heroAct('call')}>
                    跟注 {la!.callAmount}
                  </Button>
                )}
                {la!.canRaise && !showRaise && (
                  <Button className="rounded-xl h-12 px-6 bg-gold hover:bg-gold-light text-ink text-base font-bold" onClick={() => setShowRaise(true)}>
                    加注
                  </Button>
                )}
                {la!.canRaise && showRaise && (
                  <>
                    <Button className="rounded-xl h-12 px-5 bg-gold hover:bg-gold-light text-ink text-base font-bold"
                      onClick={() => heroAct(raiseAmt >= la!.maxRaiseTo ? 'allin' : game.currentBet > 0 ? 'raise' : 'bet', raiseAmt)}>
                      {raiseAmt >= la!.maxRaiseTo ? `全下 ${raiseAmt}` : `加到 ${raiseAmt}`}
                    </Button>
                    <Button variant="ghost" className="rounded-xl text-slate-400" onClick={() => setShowRaise(false)}>收起</Button>
                  </>
                )}
              </div>
            </div>
          )}
          {!heroTurn && game.street !== 'handOver' && game.street !== 'showdown' && (
            <p className="text-[11px] text-slate-500 h-6">等待其他玩家行动…</p>
          )}
        </footer>
      )}

      {/* 结算弹窗 */}
      {game && game.street === 'handOver' && (
        <SettlementModal
          open={showSettle}
          onClose={() => setShowSettle(false)}
          heroWon={!!game.winners?.some(w => w.playerId === 0)}
          delta={handResult?.delta ?? null}
          xpGain={game.winners?.some(w => w.playerId === 0) ? 30 : 10}
          info={game.handOverInfo ?? ''}
          players={game.players.map(p => ({
            name: p.isHero ? nickname : p.name,
            avatar: p.isHero ? avatar : (STYLE_EMOJI[p.style] ?? '🤖'),
            hole: p.folded ? [] : p.hole,
            folded: p.folded,
            winner: !!game.winners?.some(w => w.playerId === p.id),
            isHero: p.isHero,
            winAmount: game.winners?.find(w => w.playerId === p.id)?.amount,
          }))}
          onNext={nextHand}
          onReview={() => { setShowSettle(false); setShowReview(true); }}
          onHome={() => navigate('/')}
        />
      )}

      {/* 规则与术语弹窗 */}
      <RulesGuideDialog open={showRules} onOpenChange={setShowRules} />

      {/* 复盘弹窗 */}
      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              本手复盘
              {handResult && (
                <span className={cn('font-mono font-bold', handResult.delta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {handResult.delta >= 0 ? '+' : ''}{handResult.delta}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {handResult && <p className="text-sm text-slate-300">{handResult.info}</p>}
          <ReviewList actions={gradedActions} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewHistory({ reviews }: { reviews: ReturnType<typeof loadReviews> }) {
  if (reviews.length === 0) return <p className="text-xs text-slate-500">打完的手牌会在这里生成复盘记录。</p>;
  return (
    <div className="space-y-3">
      {reviews.slice(0, 10).map((r, i) => (
        <details key={i} className="rounded-lg bg-slate-800/60 border border-slate-700 p-2">
          <summary className="text-xs cursor-pointer flex items-center gap-2">
            <span className="text-slate-400">#{r.handNumber}</span>
            <span className="font-semibold">{r.heroCards}</span>
            <span className="text-slate-500">{r.position.split(' ')[0]}</span>
            <span className={cn('ml-auto font-mono font-bold', r.result >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {r.result >= 0 ? '+' : ''}{r.result}
            </span>
          </summary>
          <div className="mt-2"><ReviewList actions={r.actions as GradedAction[]} /></div>
        </details>
      ))}
    </div>
  );
}
