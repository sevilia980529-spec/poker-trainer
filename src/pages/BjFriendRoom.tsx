// 21点好友房：创建/加入房间 + 联机牌桌（结构对齐 FriendRoom.tsx：connect/lobby/game 三阶段）
// 严格消费服务端脱敏后的 BjTableState：shoe/seenCards/rng 已剔除；非自己座位的手牌在
// 结算前为 []（除庄家明牌），phase==='settled' 后全部可见。自己的手牌始终全可见。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  bjTableLegalActions, bjTablePlayerPayout,
  type BjTableState, type BjTableAction, type BjTablePhase,
} from '../games/blackjack/table';
import { handValue } from '../games/blackjack/engine';
import type { Card } from '../engine/cards';
import { loadProfile, saveProfile } from '../store/points';
import { useUserStore } from '../store/userStore';
import { PlayingCard } from '../components/PlayingCard';
import { Chip } from '../components/ChipStack';
import SettlementModal from '../components/SettlementModal';
import { playDeal, playChips, playClick, playWin, playLose } from '../lib/sound';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import ThemeToggle from '../components/common/ThemeToggle';

type Phase = 'connect' | 'lobby' | 'game';

// —— 服务端线协议（脱敏后）类型，仅消费，不外推字段 ——
interface NetHand {
  cards: Card[];
  bet: number;
  done: boolean;
  fromSplitAces: boolean;
  result?: 'win' | 'lose' | 'push' | 'bust';
  payout?: number;
}
interface NetBjPlayer {
  id: number;
  seat: number;
  name: string;
  isAI: boolean;
  hands: NetHand[];
  activeHand: number;
  chips: number;
  insuranceBet: number;
  insurancePayout?: number;
}
interface NetBjState {
  players: NetBjPlayer[];
  dealerIdx: number;
  actingSeat: number;
  phase: BjTablePhase;
  handNumber: number;
  message?: string;
  bet: number;
  maxInsurance: number;
}

interface LobbyPlayer { name: string; seatIdx: number; connected: boolean }

// 4 个 AI 对手座位（相对牌桌容器，hero 固定在底部操作区，庄家固定在顶部居中）
const AI_POS = [
  'left-[1%] top-[14%]',
  'left-[2%] bottom-[2%]',
  'right-[2%] bottom-[2%]',
  'right-[1%] top-[14%]',
];

// 纯函数只消费 players/phase/actingSeat/bet/maxInsurance，不需要 shoe/seenCards/rng
const legalOf = (s: NetBjState, seat: number) =>
  bjTableLegalActions(s as unknown as BjTableState, seat);
const payoutOf = (s: NetBjState, seat: number) =>
  bjTablePlayerPayout(s as unknown as BjTableState, seat);

const ACTION_DEFS: Record<BjTableAction, { label: string; cls: string }> = {
  hit: { label: '要牌', cls: 'bg-gold hover:bg-gold-light text-black' },
  stand: { label: '停牌', cls: 'bg-ink-light hover:bg-ink text-ivory' },
  double: { label: '双倍', cls: 'bg-emerald-600 hover:bg-emerald-500' },
  split: { label: '分牌', cls: 'bg-violet-600 hover:bg-violet-500' },
  insurance: { label: '买保险', cls: 'bg-purple-600 hover:bg-purple-500' },
  declineInsurance: { label: '不保险', cls: 'bg-ink-light hover:bg-ink text-ivory' },
};

function resultLabel(h: NetHand) {
  if (!h.result) return null;
  const map = { win: '赢', lose: '负', push: '平', bust: '爆牌' } as const;
  const tone = h.result === 'win' ? 'text-emerald-400'
    : h.result === 'push' ? 'text-ivory/80' : 'text-red-400';
  const amt = h.payout ? (h.payout > 0 ? `+${h.payout}` : `${h.payout}`) : '';
  return <span className={cn('font-bold text-[11px]', tone)}>{map[h.result]} {amt}</span>;
}

export default function BjFriendRoom() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('connect');
  const [name, setName] = useState(() => localStorage.getItem('poker-trainer-nickname') ?? '');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [lobby, setLobby] = useState<{ roomId: string; players: LobbyPlayer[]; hostSeat: number; youSeat: number } | null>(null);
  const [game, setGame] = useState<NetBjState | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [youId, setYouId] = useState(-1);
  const [sessionDelta, setSessionDelta] = useState(0);
  const [showSettle, setShowSettle] = useState(false);
  const [handDelta, setHandDelta] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const settledHandRef = useRef(0);
  const prevHandRef = useRef(0);
  const lastDealHandRef = useRef(0);

  // 建立连接
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'joined':
          setError('');
          if (msg.roomId && msg.seatToken !== undefined) {
            // 座位凭证：中途掉线后凭房间码 + 凭证原地回归（保住筹码与分数）
            localStorage.setItem(`poker-trainer-seat-${msg.roomId}`, String(msg.seatToken));
          }
          break;
        case 'lobby':
          setLobby({ roomId: msg.roomId, players: msg.players, hostSeat: msg.hostSeat, youSeat: msg.youSeat });
          setPhase(p => (p === 'game' ? 'game' : 'lobby'));
          break;
        case 'state': {
          const s = msg.state as NetBjState;
          if (Array.isArray(msg.scores)) setScores(msg.scores);
          // 发牌音效：每手切换时播放一次
          if (s.handNumber !== lastDealHandRef.current) {
            lastDealHandRef.current = s.handNumber;
            playDeal();
          }
          // 结算：算本手 delta + 音效 + 写入本地训练欢乐豆
          if (s.phase === 'settled') {
            if (settledHandRef.current !== s.handNumber) {
              settledHandRef.current = s.handNumber;
              const delta = payoutOf(s, msg.yourPlayerId);
              setHandDelta(delta);
              if (delta > 0) playWin(); else if (delta < 0) playLose();
              if (delta !== 0) {
                const p = loadProfile();
                saveProfile({ ...p, points: Math.max(0, p.points + delta) });
                setSessionDelta(d => d + delta);
              }
            }
          } else if (prevHandRef.current !== s.handNumber) {
            // 新一手开始：重置结算态
            prevHandRef.current = s.handNumber;
            setHandDelta(null);
            setShowSettle(false);
          }
          setGame(s);
          setYouId(msg.yourPlayerId);
          setPhase('game');
          break;
        }
        case 'error':
          setError(msg.message);
          break;
      }
    };
    ws.onerror = () => setError('连接好友房服务器失败');
    return () => ws.close();
  }, []);

  const send = useCallback((msg: unknown) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const create = () => {
    if (!name.trim()) return setError('先给自己起个名字');
    localStorage.setItem('poker-trainer-nickname', name.trim());
    send({ type: 'create', name: name.trim(), gameType: 'bj' });
  };
  const join = () => {
    if (!name.trim()) return setError('先给自己起个名字');
    if (!roomCode.trim()) return setError('输入房间码');
    localStorage.setItem('poker-trainer-nickname', name.trim());
    const rid = roomCode.trim().toUpperCase();
    send({
      type: 'join', roomId: rid, name: name.trim(), gameType: 'bj',
      seatToken: localStorage.getItem(`poker-trainer-seat-${rid}`) ?? undefined,
    });
  };

  const isHost = lobby?.hostSeat === lobby?.youSeat;
  const connectedCount = lobby?.players.filter(p => p.connected).length ?? 0;

  // 操作栏：仅当合法且轮到你时渲染
  const myTurn = !!game && (game.phase === 'player' || game.phase === 'insurance') && game.actingSeat === youId;
  const legal = game && myTurn ? legalOf(game, youId) : [];

  const act = (action: BjTableAction) => {
    if (!game || game.actingSeat !== youId) return;
    if (action === 'hit') playDeal();
    else if (action === 'stand' || action === 'declineInsurance') playClick();
    else playChips();
    send({ type: 'action', action });
  };

  // 结算面板：延迟 1.6s 弹出（先看清最终牌面）
  useEffect(() => {
    if (!game || game.phase !== 'settled') return;
    const t = setTimeout(() => setShowSettle(true), 1600);
    return () => clearTimeout(t);
  }, [game?.phase, game?.handNumber]);

  // —— 牌桌派生数据 ——
  const dealer = game ? game.players[game.dealerIdx] : null;
  const hero = game && youId >= 0 ? game.players[youId] : null;
  const opponents = game ? game.players.filter(p => p.seat !== game.dealerIdx && p.seat !== youId) : [];
  const scoreOf = (id: number) => (scores[id] !== undefined ? scores[id] : game?.players[id]?.chips);

  return (
    <div className="min-h-dvh app-canvas text-ivory flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 safe-top">
        <Link to="/friend-room" className="text-ivory/60 hover:text-ivory text-base flex items-center gap-1.5">
          <ArrowLeft className="w-5 h-5" />德州好友房
        </Link>
        <h1 className="text-xl font-bold">21点好友房</h1>
        {lobby && <Badge className="bg-purple-700">房间 {lobby.roomId}</Badge>}
        <ThemeToggle />
        {sessionDelta !== 0 && (
          <span className={`text-sm font-mono ml-auto ${sessionDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            本场 {sessionDelta > 0 ? '+' : ''}{sessionDelta}
          </span>
        )}
      </header>

      {error && (
        <div className="bg-red-900/60 text-red-200 text-sm px-4 py-2 text-center">{error}</div>
      )}

      {/* 加入界面 */}
      {phase === 'connect' && (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-xl bg-ink-card border border-ink-light/60 p-6 space-y-4">
            <h2 className="font-bold text-lg">21点好友房</h2>
            <p className="text-xs text-ivory/60 leading-relaxed">
              把这个网址发给好友，输入同一个房间码即可同桌对练。和 AI 庄家 + AI 补位玩家一起打，
              每人固定 {10000} 分起手，空位由 AI 自动补齐。
            </p>
            <div>
              <label className="text-xs text-ivory/60">你的昵称</label>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={12}
                className="mt-1 w-full rounded-lg bg-ink-light border border-ink-light/70 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="例如：21点小王" />
            </div>
            <Button className="w-full bg-amber-600 hover:bg-amber-500" onClick={create}>创建房间</Button>
            <div className="flex gap-2">
              <input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} maxLength={6}
                className="flex-1 rounded-lg bg-ink-light border border-ink-light/70 px-3 py-2 text-sm outline-none focus:border-amber-500 font-mono tracking-widest"
                placeholder="房间码" />
              <Button variant="secondary" onClick={join}>加入房间</Button>
            </div>
            <Link to="/friend-room" className="block text-center text-xs text-gold hover:underline">← 返回德州扑克好友房</Link>
          </div>
        </main>
      )}

      {/* 大厅 */}
      {phase === 'lobby' && lobby && (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-xl bg-ink-card border border-ink-light/60 p-6 space-y-4">
            <div className="text-center">
              <p className="text-xs text-ivory/60">房间码（发给好友）</p>
              <p className="text-4xl font-mono font-bold tracking-[0.3em] text-amber-300">{lobby.roomId}</p>
            </div>
            <div className="space-y-1.5">
              {lobby.players.map(p => (
                <div key={p.seatIdx} className="flex items-center gap-2 rounded-lg bg-ink-light/70 px-3 py-2 text-sm">
                  <span className={p.connected ? 'text-emerald-400' : 'text-ivory/35'}>●</span>
                  <span className={p.connected ? '' : 'text-ivory/45 line-through'}>{p.name}</span>
                  {p.seatIdx === lobby.hostSeat && <Badge className="bg-amber-700 ml-auto">房主</Badge>}
                  {p.seatIdx === lobby.youSeat && <span className="text-xs text-gold ml-auto">你</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-ivory/45">已就绪 {connectedCount} 人 · 空位由 AI 陪练补齐</p>
            {isHost ? (
              <Button className="w-full bg-amber-600 hover:bg-amber-500" disabled={connectedCount < 2}
                onClick={() => send({ type: 'start' })}>
                {connectedCount < 2 ? '等待至少 2 人…' : '开始游戏 ▶'}
              </Button>
            ) : (
              <p className="text-center text-xs text-ivory/60">等待房主开始…</p>
            )}
          </div>
        </main>
      )}

      {/* 牌桌 */}
      {phase === 'game' && game && dealer && (
        <>
          <main className="flex-1 relative flex items-center justify-center px-2 min-h-0">
            <div className="relative w-[min(96vw,820px)] aspect-[1.7/1]">
              {/* 桌面呢绒：木质桌沿 + 绒布呢面 + 暗角（对齐 PokerTrainer 主题桌） */}
              <div className="absolute inset-x-0 top-[6%] bottom-[6%] rounded-[2.6rem] p-[9px] table-rim">
                <div className="relative w-full h-full rounded-[2rem] overflow-hidden table-felt table-felt-inner">
                  {/* 中心聚光光斑 */}
                  <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 w-2/5 h-1/3 rounded-[50%] pointer-events-none"
                    style={{ background: 'radial-gradient(ellipse, rgba(255,255,200,0.09) 0%, transparent 70%)' }} />

                  {/* 庄家区（顶部居中） */}
                  <div className={cn('absolute left-1/2 -translate-x-1/2 top-[3%] flex flex-col items-center gap-1',
                    game.actingSeat === game.dealerIdx && game.phase !== 'settled' && 'drop-shadow-[0_0_14px_rgba(212,168,87,0.7)]')}>
                    <div className="flex items-center gap-1.5 rounded-full bg-black/70 pl-1 pr-2.5 py-1 border border-ink-light/60">
                      <span className="w-7 h-7 rounded-full bg-gradient-to-b from-ink-light to-[#071007] border-amber-500/80 text-amber-200 flex items-center justify-center text-xs font-bold">庄</span>
                      <div className="leading-tight">
                        <div className="text-[11px] font-semibold whitespace-nowrap">庄家 {dealer.isAI ? '· AI' : ''}</div>
                        <div className="text-[10px] font-mono text-amber-300">{scoreOf(dealer.id) ?? dealer.chips}</div>
                      </div>
                    </div>
                    <div className="flex gap-1 min-h-[50px] items-center">
                      {dealer.hands[0].cards.length > 0 ? (
                        dealer.hands[0].cards.map((c, i) => (
                          <span key={i} className="anim-deal">
                            <PlayingCard card={i === 0 || game.phase === 'settled' ? c : undefined} faceDown={i !== 0 && game.phase !== 'settled'} small />
                          </span>
                        ))
                      ) : (
                        <>
                          <PlayingCard faceDown small />
                          <PlayingCard faceDown small />
                        </>
                      )}
                    </div>
                    {game.phase === 'settled' && (
                      <span className="text-[10px] font-mono text-ivory/70">
                        {(() => { const v = handValue(dealer.hands[0].cards); return `${v.value}点${v.soft ? '(软)' : ''}`; })()}
                      </span>
                    )}
                  </div>

                  {/* 台面装饰文字 */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center select-none pointer-events-none">
                    <p className="text-[10px] tracking-[0.3em] text-emerald-200/30 font-bold">BLACKJACK PAYS 3 TO 2</p>
                    <p className="text-[9px] tracking-[0.2em] text-emerald-200/20 mt-0.5">INSURANCE PAYS 2 TO 1</p>
                  </div>

                  {/* AI 对手座位（环绕，hero 在底部操作区，庄家在顶部） */}
                  {opponents.map((p, i) => {
                    const pos = AI_POS[i % AI_POS.length];
                    const visible = game.phase === 'settled';
                    const acting = game.actingSeat === p.seat && game.phase !== 'settled';
                    return (
                      <div key={p.seat} className={cn('absolute flex flex-col items-center gap-1', pos,
                        acting && 'drop-shadow-[0_0_14px_rgba(212,168,87,0.7)]')}>
                        <div className={cn('flex items-center gap-1.5 rounded-full bg-black/70 pl-1 pr-2.5 py-1 border',
                          acting ? 'border-2 border-gold' : 'border-ink-light/60')}>
                          <span className="w-7 h-7 rounded-full bg-gradient-to-b from-emerald-700 to-emerald-950 border-emerald-400/80 text-emerald-100 flex items-center justify-center text-xs font-bold">
                            {p.name.slice(0, 1)}
                          </span>
                          <div className="leading-tight">
                            <div className="text-[11px] font-semibold whitespace-nowrap flex items-center gap-1">
                              {p.name}{p.isAI && <span className="text-[9px] text-emerald-300/80">AI</span>}
                            </div>
                            <div className="text-[10px] font-mono text-amber-300">{scoreOf(p.id) ?? p.chips}</div>
                          </div>
                        </div>
                        {/* 多手（分牌后最多 4 手），每手一个小牌堆 */}
                        <div className="flex gap-1.5 flex-wrap justify-center max-w-[150px]">
                          {p.hands.map((h, hi) => (
                            <div key={hi} className={cn('flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 border',
                              game.phase === 'player' && game.actingSeat === p.seat && p.activeHand === hi ? 'border-gold bg-amber-950/20' : 'border-white/5')}>
                              <div className="flex gap-0.5">
                                {visible ? h.cards.map((c, j) => (
                                  <PlayingCard key={j} card={c} small />
                                )) : (
                                  Array.from({ length: Math.max(2, h.cards.length) }).map((_, j) => (
                                    <PlayingCard key={j} faceDown small />
                                  ))
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-amber-300/90 font-mono">
                                <Chip exact amount={100} size={12} showLabel={false} />{h.bet}
                              </div>
                              {visible && resultLabel(h)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* 暗角 */}
                  <div className="absolute inset-0 rounded-[2rem] pointer-events-none table-vignette" />
                </div>
              </div>
            </div>
          </main>

          {/* 我的手牌 + 操作区（底部 hero 座位） */}
          <footer className="relative z-30 pb-3 pt-1 flex flex-col items-center gap-2 safe-bottom">
            {/* 横幅：保险提示 / 阶段信息 */}
            {game.message && game.phase !== 'settled' && (
              <div className={cn('anim-pop text-sm font-bold px-4 py-1.5 rounded-full text-center',
                game.phase === 'insurance' ? 'bg-purple-900/80 text-purple-200' : 'bg-black/60 text-ivory/80')}>
                {game.message}
              </div>
            )}

            {/* hero 信息牌 */}
            {hero && (
              <div className="flex items-center gap-2 rounded-full bg-black/70 pl-1 pr-3 py-1 border border-ink-light/60">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-gold to-amber-700 flex items-center justify-center text-xs font-bold text-black">
                  {hero.name.slice(0, 1)}
                </span>
                <div className="leading-tight">
                  <div className="text-[11px] font-semibold whitespace-nowrap">{hero.name}<span className="text-gold text-[10px] ml-1">(你)</span></div>
                  <div className="text-[10px] font-mono text-amber-300">{scoreOf(hero.id) ?? hero.chips}</div>
                </div>
              </div>
            )}

            {/* hero 各手牌（分牌后最多 4 手） */}
            {hero && (
              <div className="flex gap-2 flex-wrap justify-center">
                {hero.hands.map((h, hi) => {
                  const v = handValue(h.cards);
                  const isActive = game.phase === 'player' && game.actingSeat === youId && hero.activeHand === hi;
                  return (
                    <div key={hi} className={cn('flex flex-col items-center gap-1 rounded-2xl px-3 py-2 border transition-all',
                      isActive ? 'border-2 border-gold bg-amber-950/25' : 'border-white/5')}>
                      <div className="flex gap-1.5">
                        {h.cards.map((c, j) => (
                          <span key={`${game.handNumber}-${hi}-${j}-${c.rank}${c.suit}`} className="anim-deal"
                            style={{ animationDelay: `${(j + 1) * 130}ms` }}>
                            <PlayingCard card={c} />
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-ivory/80">
                        <span className={cn('font-mono font-bold',
                          v.value > 21 ? 'text-red-400' : v.value === 21 ? 'text-amber-300' : 'text-ivory')}>
                          {hero.hands.length > 1 ? `第${hi + 1}手 · ` : ''}{v.value} 点{v.soft ? '（软）' : ''}
                        </span>
                        <span className="inline-flex items-center gap-1 text-amber-300/90 font-mono">
                          <Chip exact amount={100} size={14} showLabel={false} />{h.bet}
                        </span>
                        {game.phase === 'settled' && resultLabel(h)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 操作栏 */}
            {myTurn && legal.length > 0 ? (
              <div className="w-full max-w-lg flex flex-wrap items-center gap-2 justify-center">
                {legal.map(a => (
                  <Button key={a} className={cn('rounded-full h-12 px-6 text-base', ACTION_DEFS[a].cls)} onClick={() => act(a)}>
                    {ACTION_DEFS[a].label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ivory/45 h-6">
                {game.phase === 'dealer' ? '庄家行动中…'
                  : game.phase === 'betting' ? '等待发牌…'
                  : game.phase === 'insurance' ? '等待保险决策…'
                  : '等待其他玩家行动…'}
              </p>
            )}
          </footer>

          {/* 结算弹窗 */}
          {game.phase === 'settled' && youId >= 0 && (
            <SettlementModal
              open={showSettle}
              onClose={() => setShowSettle(false)}
              heroWon={payoutOf(game, youId) > 0}
              delta={handDelta}
              info={game.message ?? ''}
              players={game.players.map(p => ({
                name: p.name,
                avatar: p.seat === youId ? useUserStore.getState().avatar : p.name.slice(0, 1),
                hole: game.phase === 'settled' ? p.hands.flatMap(h => h.cards) : [],
                folded: false,
                winner: payoutOf(game, p.seat) > 0,
                isHero: p.seat === youId,
                winAmount: payoutOf(game, p.seat) > 0 ? payoutOf(game, p.seat) : undefined,
              }))}
              onNext={() => {
                setShowSettle(false);
                if (isHost) send({ type: 'start' });
              }}
              nextLabel={isHost ? '下一手 ▶' : '知道了'}
              onHome={() => navigate('/friend-room')}
            />
          )}
        </>
      )}
    </div>
  );
}
