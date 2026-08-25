// 好友房：创建/加入房间 + 联机牌桌
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { GameState, ActionType } from '../engine/game';
import { legalActions, STREET_NAME } from '../engine/game';
import { loadProfile, saveProfile } from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Badge } from '../components/ui/badge';

type Phase = 'connect' | 'lobby' | 'game';

interface LobbyPlayer { name: string; seatIdx: number; connected: boolean }

const SEAT_POS = [
  'bottom-2 left-1/2 -translate-x-1/2',
  'bottom-6 left-2',
  'top-1/2 -translate-y-1/2 left-2',
  'top-2 left-1/3 -translate-x-1/2',
  'top-2 right-1/3 translate-x-1/2',
  'bottom-6 right-2',
];

export default function FriendRoom() {
  const [phase, setPhase] = useState<Phase>('connect');
  const [name, setName] = useState(() => localStorage.getItem('poker-trainer-nickname') ?? '');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [lobby, setLobby] = useState<{ roomId: string; players: LobbyPlayer[]; hostSeat: number; youSeat: number } | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [youId, setYouId] = useState(-1);
  const [raiseAmt, setRaiseAmt] = useState(60);
  const [sessionDelta, setSessionDelta] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const startChipsRef = useRef<{ hand: number; chips: number } | null>(null);
  const settledHandRef = useRef(0);

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
          const me = s.players[msg.yourPlayerId];
          // 积分互通：跟踪每手起始筹码，结束时结算进积分账户
          if (me) {
            if (s.street !== 'handOver') {
              if (startChipsRef.current?.hand !== s.handNumber) {
                startChipsRef.current = { hand: s.handNumber, chips: me.chips + me.handBet };
              }
            } else if (settledHandRef.current !== s.handNumber && startChipsRef.current?.hand === s.handNumber) {
              settledHandRef.current = s.handNumber;
              const delta = me.chips - startChipsRef.current.chips;
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

  const act = (action: ActionType, raiseTo?: number) => send({ type: 'action', action, raiseTo });

  useEffect(() => {
    if (la) setRaiseAmt(Math.min(Math.max(game!.bigBlind * 3, la.minRaiseTo), la.maxRaiseTo));
  }, [game?.actingIdx, game?.street]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900/60">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">← 德州牌桌</Link>
        <h1 className="text-lg font-bold">👥 好友房</h1>
        {lobby && <Badge className="bg-purple-700">房间 {lobby.roomId}</Badge>}
        {sessionDelta !== 0 && (
          <span className={`text-xs font-mono ${sessionDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            本场 {sessionDelta > 0 ? '+' : ''}{sessionDelta}（已计入积分）
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
              同一台电脑开多个浏览器标签页，或让好友访问同一局域网地址，输入房间码即可同桌对练。空位由 AI 自动补齐到 6 人。
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
        <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
          <div className="relative w-full max-w-3xl aspect-[16/10] rounded-[45%] bg-gradient-to-b from-emerald-800 to-emerald-950 border-8 border-amber-900/80 shadow-2xl">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
              <div className="flex gap-1.5">
                {game.community.map((c, i) => <PlayingCard key={i} card={c} />)}
                {Array.from({ length: 5 - game.community.length }).map((_, i) => (
                  <div key={`e${i}`} className="w-12 h-17 rounded-md border border-emerald-700/50" />
                ))}
              </div>
              <div className="text-amber-300 font-bold text-sm bg-slate-900/70 px-3 py-1 rounded-full">
                底池 {game.players.reduce((s, p) => s + p.handBet, 0)} · {STREET_NAME[game.street]}
              </div>
              {game.street === 'handOver' && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-slate-200 bg-slate-900/80 rounded px-3 py-1">{game.handOverInfo}</p>
                  {isHost
                    ? <Button className="bg-amber-600 hover:bg-amber-500" onClick={() => send({ type: 'start' })}>下一手 ▶</Button>
                    : <p className="text-xs text-slate-400">等待房主开始下一手…</p>}
                </div>
              )}
            </div>
            {game.players.map((p, i) => (
              <div key={p.id}
                className={`absolute ${SEAT_POS[i % SEAT_POS.length]} flex flex-col items-center gap-1 ${p.folded ? 'opacity-40' : ''}`}>
                {p.id !== youId && (
                  <div className="flex gap-1">
                    {p.hole.length > 0
                      ? p.hole.map((c, j) => <PlayingCard key={j} card={c} small />)
                      : !p.folded && <><PlayingCard faceDown small /><PlayingCard faceDown small /></>}
                  </div>
                )}
                <div className={`px-2.5 py-1 rounded-lg text-xs bg-slate-900/85 border flex flex-col items-center min-w-20
                  ${game.actingIdx === i ? 'border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]' : 'border-slate-700'}`}>
                  <span className="font-semibold">
                    {game.dealerIdx === i && <span className="text-amber-400">D </span>}
                    {p.name}{p.id === youId && <span className="text-sky-400">（你）</span>}
                  </span>
                  <span className="text-amber-300 font-mono">{p.chips}</span>
                  {p.lastAction && <span className="text-sky-300">{p.lastAction}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* 我的手牌 + 操作 */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              {youId >= 0 && game.players[youId]?.hole.map((c, i) => <PlayingCard key={i} card={c} />)}
            </div>
            {myTurn && la && !game.players[youId].folded ? (
              <div className="flex items-center gap-2 flex-wrap justify-center bg-slate-900/70 rounded-xl px-4 py-3 border border-slate-700">
                <Button variant="destructive" disabled={!la.canFold && !la.canCall} onClick={() => act('fold')}>弃牌</Button>
                {la.canCheck && <Button variant="secondary" onClick={() => act('check')}>过牌</Button>}
                {la.canCall && <Button className="bg-blue-600 hover:bg-blue-500" onClick={() => act('call')}>跟注 {la.callAmount}</Button>}
                {la.canRaise && (
                  <div className="flex items-center gap-2">
                    <Slider className="w-40" min={la.minRaiseTo} max={la.maxRaiseTo} step={10}
                      value={[raiseAmt]} onValueChange={v => setRaiseAmt(v[0])} />
                    <Button className="bg-emerald-600 hover:bg-emerald-500"
                      onClick={() => act(raiseAmt >= la.maxRaiseTo ? 'allin' : game.currentBet > 0 ? 'raise' : 'bet', raiseAmt)}>
                      {raiseAmt >= la.maxRaiseTo ? `全下 ${raiseAmt}` : `${game.currentBet > 0 ? '加注' : '下注'} ${raiseAmt}`}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              game.street !== 'handOver' && <p className="text-xs text-slate-500">等待其他玩家行动…</p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
