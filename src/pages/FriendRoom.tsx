// 好友房：创建/加入房间 + 联机牌桌（布局与主训练场一致：椭圆桌 + 底部操作区）
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { GameState, ActionType } from '../engine/game';
import { legalActions, STREET_NAME } from '../engine/game';
import { cardToString } from '../engine/cards';
import { loadProfile, saveProfile } from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Chip, ChipStack } from '../components/ChipStack';
import { playDeal, playChips, playClick, playFold, playWin, playLose } from '../lib/sound';
import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Badge } from '../components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

type Phase = 'connect' | 'lobby' | 'game';

interface LobbyPlayer { name: string; seatIdx: number; connected: boolean }

// 对手座位（相对牌桌容器），hero 固定在桌面下方——全部收进容器内侧，避免手机端挡牌/出屏
const SEAT_POS = [
  'left-[3%] bottom-[-7%]',
  'left-[0%] top-[14%]',
  'left-1/2 -translate-x-1/2 top-[-20%]',
  'right-[0%] top-[14%]',
  'right-[3%] bottom-[-7%]',
];

export default function FriendRoom() {
  const [phase, setPhase] = useState<Phase>('connect');
  const [name, setName] = useState(() => localStorage.getItem('poker-trainer-nickname') ?? '');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [lobby, setLobby] = useState<{ roomId: string; players: LobbyPlayer[]; hostSeat: number; youSeat: number } | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [youId, setYouId] = useState(-1);
  const [raiseAmt, setRaiseAmt] = useState(60);
  const [sessionDelta, setSessionDelta] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const startChipsRef = useRef<{ hand: number; chips: number } | null>(null);
  const settledHandRef = useRef(0);
  const prevCommunityRef = useRef(0);

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
          break;
        case 'lobby':
          setLobby({ roomId: msg.roomId, players: msg.players, hostSeat: msg.hostSeat, youSeat: msg.youSeat });
          setPhase(p => (p === 'game' ? 'game' : 'lobby'));
          break;
        case 'state': {
          const s = msg.state as GameState;
          if (Array.isArray(msg.scores)) setScores(msg.scores);
          const me = s.players[msg.yourPlayerId];
          // 新公共牌音效
          const cc = s.community.length;
          if (cc > prevCommunityRef.current) playDeal();
          prevCommunityRef.current = cc;
          // 积分互通 + 结算音效：跟踪每手起始筹码，结束时结算
          if (me) {
            if (s.street !== 'handOver') {
              if (startChipsRef.current?.hand !== s.handNumber) {
                startChipsRef.current = { hand: s.handNumber, chips: me.chips + me.handBet };
              }
            } else if (settledHandRef.current !== s.handNumber && startChipsRef.current?.hand === s.handNumber) {
              settledHandRef.current = s.handNumber;
              const delta = me.chips - startChipsRef.current.chips;
              if (delta > 0) playWin(); else if (delta < 0) playLose();
              if (delta !== 0) {
                const p = loadProfile();
                saveProfile({ ...p, points: Math.max(0, p.points + delta) });
                setSessionDelta(d => d + delta);
              }
            }
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
    send({ type: 'create', name: name.trim() });
  };
  const join = () => {
    if (!name.trim()) return setError('先给自己起个名字');
    if (!roomCode.trim()) return setError('输入 4 位房间码');
    localStorage.setItem('poker-trainer-nickname', name.trim());
    send({ type: 'join', roomId: roomCode.trim().toUpperCase(), name: name.trim() });
  };

  const isHost = lobby?.hostSeat === lobby?.youSeat;
  const connectedCount = lobby?.players.filter(p => p.connected).length ?? 0;
  const myTurn = game && game.actingIdx === youId && game.street !== 'handOver';
  const la = game && myTurn ? legalActions(game, youId) : null;

  const act = (action: ActionType, raiseTo?: number) => {
    if (action === 'fold') playFold();
    else if (action === 'check') playClick();
    else playChips();
    send({ type: 'action', action, raiseTo });
  };

  useEffect(() => {
    if (la) setRaiseAmt(Math.min(Math.max(game!.bigBlind * 3, la.minRaiseTo), la.maxRaiseTo));
  }, [game?.actingIdx, game?.street]);

  const pot = game?.players.reduce((s, p) => s + p.handBet, 0) ?? 0;
  // 座位旋转：自己永远在桌面正下方
  const seatRel = (pid: number) => game ? (pid - youId + game.players.length) % game.players.length : pid;

  return (
    <div className="min-h-dvh bg-[#071007] text-slate-100 flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2.5 safe-top">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />牌桌
        </Link>
        <h1 className="text-base font-bold">好友房</h1>
        {lobby && <Badge className="bg-purple-700">房间 {lobby.roomId}</Badge>}
        {sessionDelta !== 0 && (
          <span className={`text-xs font-mono ml-auto ${sessionDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
          <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-700 p-6 space-y-4">
            <h2 className="font-bold text-lg">和好友一起训练</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              把这个网址发给好友，输入同一个房间码即可同桌对练。每人固定 {10000} 分起手，
              分数跨手累积、可以为负（负分玩家每手信用上桌），空位由 AI 自动补齐到 6 人。
            </p>
            <div>
              <label className="text-xs text-slate-400">你的昵称</label>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={12}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="例如：德州小辣椒" />
            </div>
            <Button className="w-full bg-amber-600 hover:bg-amber-500" onClick={create}>创建房间</Button>
            <div className="flex gap-2">
              <input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} maxLength={4}
                className="flex-1 rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm outline-none focus:border-amber-500 font-mono tracking-widest"
                placeholder="房间码" />
              <Button variant="secondary" onClick={join}>加入房间</Button>
            </div>
          </div>
        </main>
      )}

      {/* 大厅 */}
      {phase === 'lobby' && lobby && (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-700 p-6 space-y-4">
            <div className="text-center">
              <p className="text-xs text-slate-400">房间码（发给好友）</p>
              <p className="text-4xl font-mono font-bold tracking-[0.3em] text-amber-300">{lobby.roomId}</p>
            </div>
            <div className="space-y-1.5">
              {lobby.players.map(p => (
                <div key={p.seatIdx} className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm">
                  <span className={p.connected ? 'text-emerald-400' : 'text-slate-600'}>●</span>
                  <span className={p.connected ? '' : 'text-slate-500 line-through'}>{p.name}</span>
                  {p.seatIdx === lobby.hostSeat && <Badge className="bg-amber-700 ml-auto">房主</Badge>}
                  {p.seatIdx === lobby.youSeat && <span className="text-xs text-sky-400 ml-auto">你</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">已就绪 {connectedCount}/6 · 空位由 AI 陪练补齐</p>
            {isHost ? (
              <Button className="w-full bg-amber-600 hover:bg-amber-500" disabled={connectedCount < 2}
                onClick={() => send({ type: 'start' })}>
                {connectedCount < 2 ? '等待至少 2 人…' : '开始游戏 ▶'}
              </Button>
            ) : (
              <p className="text-center text-xs text-slate-400">等待房主开始…</p>
            )}
          </div>
        </main>
      )}

      {/* 牌桌 */}
      {phase === 'game' && game && (
        <>
          <main className="flex-1 relative flex items-center justify-center px-2 min-h-0">
            <div className="relative w-[min(96vw,820px)] aspect-[1.55/1] sm:aspect-[2.1/1]">
              {/* 桌面呢绒：多层渐变 + 木质桌沿 + 外发光（纵向内缩，给座位让位） */}
              <div className="absolute inset-x-0 top-[9%] bottom-[9%] rounded-[2.5rem] border-[10px] border-[#4a3325]
                bg-[radial-gradient(ellipse_at_center_top,#1A7A52_0%,#0E5C3A_35%,#084A2D_75%,#053822_100%)]
                shadow-[inset_0_20px_60px_rgba(0,0,0,0.4),inset_0_-10px_30px_rgba(0,0,0,0.3),0_0_80px_rgba(14,92,58,0.35)]" />
              {/* 桌面中心聚光光斑 */}
              <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-2/5 h-1/3 rounded-[50%] pointer-events-none"
                style={{ background: 'radial-gradient(ellipse, rgba(255,255,200,0.09) 0%, transparent 70%)' }} />

              {/* 中央：底池 + 公共牌 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
                {pot > 0 && game.street !== 'handOver' && <ChipStack amount={pot} size={22} />}
                <div key={pot} className="text-gold font-bold text-xs sm:text-sm bg-gold/25 backdrop-blur-sm border border-gold/60 px-3 py-0.5 rounded-full anim-pot num">
                  底池 {pot} · {STREET_NAME[game.street]}
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
                    {isHost
                      ? <Button size="sm" className="bg-amber-600 hover:bg-amber-500" onClick={() => send({ type: 'start' })}>下一手 ▶</Button>
                      : <p className="text-[11px] text-slate-400">等待房主开始下一手…</p>}
                  </div>
                )}
              </div>

              {/* 对手座位（旋转视角：自己恒在下方；左右下角手牌横排在头像旁，收进桌面外暗区） */}
              {game.players.filter(p => p.id !== youId).map(p => {
                const rel = seatRel(p.id);
                const slot = (rel - 1 + 6) % 6;
                const corner = slot === 0 || slot === 4;
                const posClass = SEAT_POS[slot] ?? SEAT_POS[0];
                const revealed = p.hole.length > 0;
                const score = scores[p.id];
                return (
                  <div key={p.id} className={cn('absolute flex gap-1',
                    corner ? (slot === 0 ? 'flex-row-reverse items-center' : 'flex-row items-center')
                      : slot === 2 ? 'flex-col-reverse items-center' : 'flex-col items-center',
                    posClass, p.folded && 'opacity-40')}>
                    <div className="flex -space-x-3">
                      {revealed
                        ? p.hole.map((c, j) => (
                          <span key={`${game.handNumber}-${p.id}-${j}-r`} className="anim-flip" style={{ animationDelay: `${j * 120}ms` }}>
                            <PlayingCard card={c} small />
                          </span>
                        ))
                        : !p.folded && (
                          <>
                            <span key={`${game.handNumber}-${p.id}-a`} className="anim-deal"><PlayingCard faceDown small /></span>
                            <span key={`${game.handNumber}-${p.id}-b`} className="anim-deal" style={{ animationDelay: '90ms' }}><PlayingCard faceDown small /></span>
                          </>
                        )}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                    <div className={cn('flex items-center gap-1.5 rounded-full bg-black/70 pl-1 pr-2.5 py-1 border',
                      game.actingIdx === p.id && game.street !== 'handOver' ? 'border-2 border-gold' : 'border-slate-700',
                      game.street === 'handOver' && game.winners?.some(w => w.playerId === p.id) && 'anim-winner border-amber-300')}>
                      <span className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs relative font-bold">
                        {p.name.slice(0, 1)}
                        {game.dealerIdx === p.id && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-[8px] text-black font-bold flex items-center justify-center">D</span>
                        )}
                      </span>
                      <div className="leading-tight">
                        <div className="text-[11px] font-semibold whitespace-nowrap">{p.name}</div>
                        <div className="text-[10px] font-mono">
                          <span className="text-amber-300">{p.chips}</span>
                          {score !== undefined && (
                            <span className={cn('ml-1', score < 0 ? 'text-red-400' : 'text-slate-400')}>
                              / {score}
                            </span>
                          )}
                        </div>
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
                    </div>
                    {p.streetBet > 0 && (
                      <div className={cn('absolute left-1/2 -translate-x-1/2',
                        slot === 2 ? '-top-1 -translate-y-full' : '-bottom-1 translate-y-full')}>
                        <span key={p.streetBet} className="anim-chip inline-flex items-center gap-1 bg-black/70 rounded-full pl-0.5 pr-1.5 py-0.5">
                          <Chip size={15} />
                          <span className="text-[10px] font-mono text-amber-300 font-bold">{p.streetBet}</span>
                        </span>
                      </div>
                    )}
                    {p.lastAction && (
                      <div key={`${p.id}-${p.lastAction}-${game.actingIdx}`}
                        className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] bg-sky-600/90 rounded-full px-2 py-0.5 whitespace-nowrap anim-pop">
                        {p.lastAction}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </main>

          {/* 我的手牌 + 操作区 */}
          <footer className="relative z-30 pb-3 pt-1 flex flex-col items-center gap-2 safe-bottom">
            <div className="flex gap-2">
              {youId >= 0 && game.players[youId]?.hole.map((c, i) => (
                <span key={`${game.handNumber}-me-${cardToString(c)}`} className="anim-deal" style={{ animationDelay: `${i * 130}ms` }}>
                  <PlayingCard card={c} />
                </span>
              ))}
            </div>
            {scores[youId] !== undefined && (
              <span className={cn('text-[11px] font-mono', scores[youId] < 0 ? 'text-red-400' : 'text-slate-400')}>
                我的分数 {scores[youId]}{scores[youId] <= 0 && '（信用上桌）'}
              </span>
            )}
            {myTurn && la && !game.players[youId].folded ? (
              <div className="w-full max-w-lg flex flex-col items-center gap-2">
                {la.canRaise && (
                  <div className="flex items-center gap-3 w-full px-4">
                    <Slider className="flex-1" min={la.minRaiseTo} max={la.maxRaiseTo} step={10}
                      value={[raiseAmt]} onValueChange={v => setRaiseAmt(v[0])} />
                    <span className="font-mono font-bold text-amber-300 w-16 text-right">{raiseAmt}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 justify-center flex-wrap">
                  {(la.canFold || la.canCall) && (
                    <Button className="rounded-full h-12 px-6 bg-red-700 hover:bg-red-600 text-base" onClick={() => act('fold')}>弃牌</Button>
                  )}
                  {la.canCheck && (
                    <Button className="rounded-full h-12 px-6 bg-slate-600 hover:bg-slate-500 text-base" onClick={() => act('check')}>过牌</Button>
                  )}
                  {la.canCall && (
                    <Button className="rounded-full h-12 px-6 bg-blue-600 hover:bg-blue-500 text-base" onClick={() => act('call')}>
                      跟注 {la.callAmount}
                    </Button>
                  )}
                  {la.canRaise && (
                    <Button className="rounded-full h-12 px-6 bg-emerald-600 hover:bg-emerald-500 text-base"
                      onClick={() => act(raiseAmt >= la.maxRaiseTo ? 'allin' : game.currentBet > 0 ? 'raise' : 'bet', raiseAmt)}>
                      {raiseAmt >= la.maxRaiseTo ? `全下 ${raiseAmt}` : `${game.currentBet > 0 ? '加注到' : '下注'} ${raiseAmt}`}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              game.street !== 'handOver' && <p className="text-[11px] text-slate-500 h-6">等待其他玩家行动…</p>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
