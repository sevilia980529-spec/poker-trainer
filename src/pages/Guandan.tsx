// 掼蛋训练页面：你 + 对家 AI vs 左右 AI
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  newGuandanRound, gdPlay, analyzeCombo, isWild, gdCardLabel, teamOf, COMBO_NAME,
  rankPower,
  type GdState, type GdCard, type Level,
} from '../games/guandan/engine';
import { guandanAI } from '../games/guandan/ai';
import { loadProfile, saveProfile } from '../store/points';
import { RANK_LABEL } from '../engine/cards';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { cn } from '../lib/utils';

function GdCardView({ card, level, selected, onClick, mini }: {
  card: GdCard; level: Level; selected?: boolean; onClick?: () => void; mini?: boolean;
}) {
  const wild = isWild(card, level);
  const red = card.suit === 'h' || card.suit === 'd';
  const isJoker = card.rank >= 15;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        mini ? 'w-7 h-10 text-[10px]' : 'w-11 h-16 text-sm',
        'rounded border font-bold flex flex-col items-center justify-center leading-tight transition select-none shadow-md',
        isJoker ? 'bg-violet-100 text-violet-900 border-violet-400'
          : red ? 'bg-white text-red-600 border-gray-300' : 'bg-white text-gray-900 border-gray-300',
        wild && 'ring-2 ring-amber-400',
        selected && '-translate-y-3.5 ring-2 ring-gold',
        onClick && 'cursor-pointer hover:-translate-y-2',
      )}>
      {isJoker ? <span>{card.rank === 15 ? '小王' : '大王'}</span> : (
        <>
          <span>{RANK_LABEL[card.rank]}</span>
          <span>{{ s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit as string]}</span>
        </>
      )}
      {wild && !mini && <span className="text-[8px] text-amber-600">配</span>}
    </button>
  );
}

// 扇形手持布局：牌相互重叠，像手里拿牌一样；选中的牌弹起
const HAND_CARD_W = 44; // 对应 w-11
const HAND_CARD_H = 64; // 对应 h-16

function HandFan({ hand, level, selected, canPick, onToggle }: {
  hand: GdCard[]; level: Level; selected: Set<number>; canPick: boolean; onToggle: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = hand.length;
  const step = n > 1 ? Math.min(30, Math.max(9, (w - HAND_CARD_W) / (n - 1))) : 0;
  const totalW = n > 0 ? (n - 1) * step + HAND_CARD_W : 0;
  const startX = Math.max(0, (w - totalW) / 2);
  return (
    <div ref={ref} className="relative w-full" style={{ height: HAND_CARD_H + 18 }}>
      {hand.map((c, i) => (
        <div key={c.id} className="absolute bottom-0 transition-transform duration-150"
          style={{ left: startX + i * step, zIndex: i }}>
          <GdCardView card={c} level={level}
            selected={selected.has(c.id)} onClick={canPick ? () => onToggle(c.id) : undefined} />
        </div>
      ))}
    </div>
  );
}

export default function Guandan() {
  const [profile, setProfile] = useState(loadProfile);
  const [level, setLevel] = useState<[Level, Level]>([2, 2]);
  const [playingLevel, setPlayingLevel] = useState<Level>(2);
  const [game, setGame] = useState<GdState>(() => newGuandanRound([2, 2], 2, 0));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState<'rank' | 'suit'>('rank');
  const [error, setError] = useState('');
  const [showRoundOver, setShowRoundOver] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const creditedRef = useRef(false);

  // AI 循环
  useEffect(() => {
    if (game.phase !== 'playing') return;
    const seat = game.turn;
    if (game.players[seat].isHero) return;
    const t = setTimeout(() => {
      const ids = guandanAI(game, seat);
      const r = gdPlay(game, seat, ids);
      if (r.ok && r.state) setGame(r.state);
    }, 1300 + Math.random() * 700);
    return () => clearTimeout(t);
  }, [game]);

  // 局结束 → 积分结算
  useEffect(() => {
    if ((game.phase === 'roundOver' || game.phase === 'matchOver') && !creditedRef.current && game.roundResult) {
      creditedRef.current = true;
      const win = game.roundResult.winningTeam === 0;
      const delta = win ? game.roundResult.levelGain * 50 : -50;
      const matchBonus = game.phase === 'matchOver' ? (game.matchWinner === 0 ? 500 : -200) : 0;
      setProfile(prev => {
        const next = { ...prev, points: Math.max(0, prev.points + delta + matchBonus) };
        saveProfile(next);
        return next;
      });
      setShowRoundOver(true);
    }
  }, [game]);

  const startRound = useCallback((lv: [Level, Level], pl: Level, first: number) => {
    creditedRef.current = false;
    setSelected(new Set());
    setError('');
    setShowRoundOver(false);
    setGame(newGuandanRound(lv, pl, first));
  }, []);

  const nextRound = () => {
    if (!game.roundResult) return;
    const newLv = game.level;
    const winTeam = game.roundResult.winningTeam;
    setLevel(newLv);
    setPlayingLevel(newLv[winTeam]); // 打胜方级牌
    startRound(newLv, newLv[winTeam], game.roundResult.order[0]); // 头游领出
  };

  const restartMatch = () => {
    setLevel([2, 2]);
    setPlayingLevel(2);
    startRound([2, 2], 2, 0);
  };

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setError('');
  };

  const hero = game.players[0];
  const myTurn = game.phase === 'playing' && game.turn === 0 && !hero.finished;
  const canPass = game.currentTrick !== null && game.passCount < 3;

  const play = () => {
    if (!myTurn) return;
    const r = gdPlay(game, 0, [...selected]);
    if (!r.ok) { setError(r.reason ?? '无法出牌'); return; }
    setSelected(new Set());
    setHintUsed(false);
    setGame(r.state!);
  };

  const pass = () => {
    if (!myTurn || !canPass) return;
    const r = gdPlay(game, 0, []);
    if (r.ok) { setSelected(new Set()); setGame(r.state!); }
  };

  const hint = () => {
    if (!myTurn) return;
    const ids = guandanAI(game, 0);
    if (ids.length === 0) {
      setError(canPass ? '💡 建议：过牌' : '💡 你领出，必须出牌');
      return;
    }
    setSelected(new Set(ids));
    const cards = hero.hand.filter(c => ids.includes(c.id));
    const combo = analyzeCombo(cards, game.playingLevel);
    setError(`💡 建议出：${combo ? COMBO_NAME[combo.type] : ''} ${cards.map(gdCardLabel).join(' ')}`);
    setHintUsed(true);
  };

  const selCards = hero.hand.filter(c => selected.has(c.id));
  const selCombo = selCards.length > 0 ? analyzeCombo(selCards, game.playingLevel) : null;

  // 手牌展示顺序：按大小（默认，引擎已排好）或按花色理牌
  const displayHand = useMemo(() => {
    if (sortMode === 'rank') return hero.hand;
    const suitOrder = ['j', 's', 'h', 'c', 'd']; // 王牌最前，再按花色分组
    return [...hero.hand].sort((a, b) => {
      const sa = suitOrder.indexOf(a.suit as string);
      const sb = suitOrder.indexOf(b.suit as string);
      if (sa !== sb) return sa - sb;
      return rankPower(b.rank, game.playingLevel) - rankPower(a.rank, game.playingLevel);
    });
  }, [hero.hand, sortMode, game.playingLevel]);

  // 最近一手出牌展示
  const lastPlay = game.currentTrick?.plays[game.currentTrick.plays.length - 1];

  const renderSeat = (seat: number, posClass: string, vertical: boolean) => {
    const p = game.players[seat];
    const theirLast = lastPlay && lastPlay.seat === seat ? lastPlay : null;
    return (
      <div className={cn('absolute', posClass, 'flex', vertical ? 'flex-col items-center' : 'flex-col items-center', 'gap-1')}>
        <div className={cn('px-2.5 py-1 rounded-lg text-xs bg-ink-card/85 border text-center min-w-16',
          game.turn === seat && game.phase === 'playing' ? 'border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'border-ink-light/60')}>
          <div className="font-semibold">
            {p.name}
            <span className={cn('ml-1', teamOf(seat) === 0 ? 'text-gold' : 'text-red-400')}>
              {teamOf(seat) === 0 ? '我方' : '对方'}
            </span>
          </div>
          <div className="text-ivory/60">余 {p.hand.length} 张</div>
          {p.finished && (
            <div className="text-amber-300 font-bold">{['头游', '二游', '三游', '末游'][p.finishOrder - 1]}</div>
          )}
        </div>
        {theirLast && (
          <div className="flex gap-0.5 bg-ink-card/60 rounded p-1">
            {theirLast.cards.map(c => <GdCardView key={c.id} card={c} level={game.playingLevel} mini />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#071007] text-ivory flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-ink-light/50 bg-ink-card/60 flex-wrap">
        <Link to="/" className="text-ivory/60 hover:text-ivory text-sm">← 德州牌桌</Link>
        <Link to="/drills" className="text-ivory/60 hover:text-ivory text-sm">🎯 专项训练</Link>
        <Link to="/blackjack" className="text-ivory/60 hover:text-ivory text-sm">♣ 21点</Link>
        <h1 className="text-lg font-bold">🃏 掼蛋训练场</h1>
        <Badge className="bg-emerald-700">本局打 {RANK_LABEL[playingLevel]}</Badge>
        <Badge variant="outline" className="text-amber-300 border-amber-700">红桃{RANK_LABEL[playingLevel]} = 百搭</Badge>
        <span className="text-xs text-ivory/60">我方级牌 {RANK_LABEL[level[0]]} · 对方 {RANK_LABEL[level[1]]}</span>
        <Badge className="bg-amber-600 ml-auto">🫘 {profile.points.toLocaleString()} 分</Badge>
      </header>

      <main className="flex-1 flex flex-col p-3 gap-2 max-w-5xl mx-auto w-full">
        {/* 桌面 */}
        <div className="relative flex-1 min-h-72 rounded-3xl bg-gradient-to-b from-emerald-800/60 to-emerald-950/60 border border-emerald-900">
          {renderSeat(2, 'top-2 left-1/2 -translate-x-1/2', false)}
          {renderSeat(3, 'top-1/2 -translate-y-1/2 left-2', true)}
          {renderSeat(1, 'top-1/2 -translate-y-1/2 right-2', true)}

          {/* 中央信息 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center space-y-1">
            {lastPlay ? (
              <>
                <p className="text-xs text-ivory/80">
                  {game.players[lastPlay.seat].name}：{COMBO_NAME[lastPlay.combo.type]}
                </p>
                {lastPlay.seat === 0 && (
                  <div className="flex gap-0.5 justify-center bg-ink-card/60 rounded p-1">
                    {lastPlay.cards.map(c => <GdCardView key={c.id} card={c} level={game.playingLevel} mini />)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-ivory/60">新一轮领出</p>
            )}
            {game.message && <p className="text-[11px] text-ivory/45 max-w-64 mx-auto">{game.message}</p>}
          </div>
        </div>

        {/* 提示/错误 */}
        {error && (
          <p className={cn('text-xs text-center', error.startsWith('💡') ? 'text-gold-light' : 'text-red-400')}>{error}</p>
        )}

        {/* 我的手牌（扇形手持布局） */}
        <div className="space-y-2">
          {hero.hand.length > 0 ? (
            <HandFan hand={displayHand} level={game.playingLevel} selected={selected}
              canPick={myTurn} onToggle={toggle} />
          ) : (
            <p className="text-amber-300 font-bold text-center py-4">
              你已出完 · {['头游', '二游', '三游', '末游'][hero.finishOrder - 1]}
            </p>
          )}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button
              onClick={() => setSortMode(m => (m === 'rank' ? 'suit' : 'rank'))}
              className="text-xs rounded-full px-3 py-1.5 border border-ink-light/70 bg-ink-light/80 text-ivory/80 hover:bg-ink-light">
              🔄 理牌 · {sortMode === 'rank' ? '按大小' : '按花色'}
            </button>
            <span className="text-xs text-ivory/60">
              {selCards.length > 0
                ? selCombo ? `已选 ${selCards.length} 张：${COMBO_NAME[selCombo.type]}` : `已选 ${selCards.length} 张：不是合法牌型`
                : myTurn ? '点击手牌选择要出的牌' : '等待其他玩家…'}
            </span>
            {myTurn && (
              <>
                <Button className="bg-amber-600 hover:bg-amber-500" disabled={!selCombo} onClick={play}>出牌</Button>
                {canPass && <Button variant="secondary" onClick={pass}>过牌</Button>}
                <Button variant="outline" className="border-gold-dark text-gold-light" onClick={hint}>
                  {hintUsed ? '再想想' : '💡 提示'}
                </Button>
              </>
            )}
          </div>
        </div>
      </main>

      {/* 局结束弹窗 */}
      <Dialog open={showRoundOver} onOpenChange={setShowRoundOver}>
        <DialogContent className="bg-ink-card border-ink-light/60 text-ivory max-w-md">
          <DialogHeader>
            <DialogTitle>{game.phase === 'matchOver' ? '🏆 比赛结束' : '本局结束'}</DialogTitle>
          </DialogHeader>
          {game.roundResult && (
            <div className="space-y-2 text-sm">
              <p>名次：{game.roundResult.order.map((s, i) => (
                <span key={s} className={cn(teamOf(s) === 0 ? 'text-gold-light' : 'text-red-300')}>
                  {['①', '②', '③', '④'][i]}{game.players[s].name}{'　'}
                </span>
              ))}</p>
              <p className={game.roundResult.winningTeam === 0 ? 'text-emerald-400' : 'text-red-400'}>
                {game.roundResult.winningTeam === 0 ? '我方' : '对方'}升 {game.roundResult.levelGain} 级
                （{game.roundResult.winningTeam === 0 ? '+' + game.roundResult.levelGain * 50 : '-50'} 积分）
              </p>
              <p className="text-ivory/60">级牌：我方 {RANK_LABEL[game.level[0]]} · 对方 {RANK_LABEL[game.level[1]]}</p>
              {game.phase === 'matchOver' && (
                <p className="font-bold text-amber-300">
                  {game.matchWinner === 0 ? '🎉 你方打穿 A 级，赢下整场比赛！+500 积分' : '对方打穿 A 级获胜。-200 积分'}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {game.phase === 'matchOver'
              ? <Button className="bg-amber-600 hover:bg-amber-500" onClick={restartMatch}>再来一场</Button>
              : <Button className="bg-amber-600 hover:bg-amber-500" onClick={nextRound}>下一局 ▶</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
