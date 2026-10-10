// 好友房服务器：房间管理 + 权威游戏状态机 + AI 填充
// 传输层解耦：RoomManager 接收/发送 JSON 消息，可挂到任意 ws WebSocketServer
// 同一个 RoomManager / 同一个 /ws 端点同时服务德州扑克（texas）与 21点（bj）。
import type { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  newHand, applyAction, legalActions,
  type GameState, type ActionType, type Player,
} from '../src/engine/game';
import { botDecide, BOT_STYLES } from '../src/ai/bot';
import {
  newBjTable, bjTableApply, bjTableAutoApply, bjDealerPlay,
  bjSanitizeState,
  type BjTableState, type BjTableAction, type BjTablePlayerSpec,
} from '../src/games/blackjack/table';

export interface ClientMsg {
  type: 'create' | 'join' | 'start' | 'action' | 'leave';
  name?: string;
  roomId?: string;
  seatToken?: string;   // 上次加入时的座位凭证（服务端签发，用于中途掉线后原位回归）
  action?: ActionType | BjTableAction;
  raiseTo?: number;
  gameType?: 'texas' | 'bj';  // 创建时生效；缺省 texas，保证旧客户端照常工作
}

interface Human {
  ws: WebSocket;
  name: string;
  playerId: number;   // 在 game.players 中的索引（开局时分配）
  seatIdx: number;    // 大厅座位序
  connected: boolean;
  seatToken: string;  // 服务端签发的随机座位凭证（替代明文 seatIdx，防劫持）
}

interface Room {
  id: string;
  humans: Human[];    // 大厅成员（按加入顺序）
  hostSeat: number;
  game: GameState | BjTableState | null;
  gameType: 'texas' | 'bj';
  dealerIdx: number;
  handNumber: number;
  aiStyles: string[]; // 本局 AI 填充位（仅 texas 用）
  aiThinking: boolean;
  scores: Map<string, number>;     // 持久分数（跨手累积，可为负）
  seatKeys: string[];              // 当前手牌 playerId → 分数键
  handStartChips: Map<number, number>; // 本手起手筹码（结算用）
  cleanupTimer?: ReturnType<typeof setTimeout>; // 全员离线后的延迟清理（给重连留窗口）
}

const AI_FILL_STYLES = ['tag', 'lag', 'station', 'nit', 'balanced'];
const INITIAL_SCORE = 10000; // 房间初始分数
const CREDIT_STACK = 10000;  // 负分玩家信用上桌筹码
const BJ_BASE_BET = 100;     // 21点每手基础注（每人下同样的基础注）
const BJ_DEALER_SEAT = 0;    // 21点庄家固定座位（恒为 AI）

function makeRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private wsIndex = new Map<WebSocket, { roomId: string; seatIdx: number }>();

  attach(ws: WebSocket) {
    ws.on('message', raw => {
      let msg: ClientMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try { this.handle(ws, msg); } catch (e) { console.error('[rooms] error', e); }
    });
    ws.on('close', () => this.handleClose(ws));
  }

  private send(ws: WebSocket, msg: unknown) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private handle(ws: WebSocket, msg: ClientMsg) {
    switch (msg.type) {
      case 'create': {
        const gameType = msg.gameType ?? 'texas';
        const room: Room = {
          id: makeRoomId(), humans: [], hostSeat: 0,
          game: null, gameType, dealerIdx: 0, handNumber: 0, aiStyles: [], aiThinking: false,
          scores: new Map(), seatKeys: [], handStartChips: new Map(),
        };
        this.rooms.set(room.id, room);
        this.joinRoom(ws, room, msg.name ?? '玩家');
        break;
      }
      case 'join': {
        const room = msg.roomId ? this.rooms.get(msg.roomId.toUpperCase()) : undefined;
        if (!room) return this.send(ws, { type: 'error', message: '房间不存在，请检查房间码' });
        const name = (msg.name ?? '玩家').trim().slice(0, 12) || '玩家';
        // ① 中途掉线后回归：优先按服务端签发的座位凭证，其次按昵称，认领自己的座位（保留筹码与分数）
        const ghost = room.humans.find(h =>
          !h.connected &&
          ((msg.seatToken && h.seatToken === msg.seatToken) || h.name === name));
        if (ghost) return this.reconnect(ws, room, ghost);
        // ② 牌局进行中：新玩家等这手结束再加入（已结束则可入座，下一手生效）
        if (!this.handFinished(room))
          return this.send(ws, { type: 'error', message: '该局正在进行中，请等这手结束后再加入' });
        if (room.humans.filter(h => h.connected).length >= 6)
          return this.send(ws, { type: 'error', message: '房间已满（6 人）' });
        this.joinRoom(ws, room, name);
        break;
      }
      case 'start': {
        const loc = this.wsIndex.get(ws);
        if (!loc) return;
        const room = this.rooms.get(loc.roomId)!;
        if (loc.seatIdx !== room.hostSeat) return this.send(ws, { type: 'error', message: '只有房主可以开局' });
        this.startHand(room);
        break;
      }
      case 'action': {
        const loc = this.wsIndex.get(ws);
        if (!loc) return;
        const room = this.rooms.get(loc.roomId)!;
        if (!room.game) return;
        const human = room.humans.find(h => h.seatIdx === loc.seatIdx);
        if (!human) return;
        if (room.gameType === 'bj') {
          const g = room.game as BjTableState;
          if (g.actingSeat !== human.playerId) return;
          const res = bjTableApply(g, human.playerId, (msg.action as BjTableAction) ?? 'stand');
          room.game = res;
          this.broadcastState(room);
          this.maybeRunAI(room);
          break;
        }
        const g = room.game as GameState;
        if (g.actingIdx !== human.playerId) return;
        const res = applyAction(g, human.playerId, (msg.action as ActionType) ?? 'fold', msg.raiseTo);
        if (!res.ok) return this.send(ws, { type: 'error', message: res.reason });
        room.game = res.state;
        if (res.handEnded) {
          this.settleHand(room, res.state);
          room.dealerIdx = (room.dealerIdx + 1) % res.state.players.length;
        }
        this.broadcastState(room);
        this.maybeRunAI(room);
        break;
      }
      case 'leave': this.handleClose(ws); break;
    }
  }

  private joinRoom(ws: WebSocket, room: Room, name: string) {
    const seatIdx = room.humans.length;
    const seatToken = randomBytes(8).toString('hex');
    room.humans.push({ ws, name: name.slice(0, 12), playerId: -1, seatIdx, connected: true, seatToken });
    this.wsIndex.set(ws, { roomId: room.id, seatIdx });
    if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = undefined; }
    this.send(ws, { type: 'joined', roomId: room.id, seatIdx, seatToken, isHost: seatIdx === room.hostSeat });
    this.broadcastLobby(room);
  }

  /** 中途掉线后回归：复用原座位、筹码与分数（不重开牌局） */
  private reconnect(ws: WebSocket, room: Room, human: Human) {
    this.wsIndex.delete(human.ws);          // 旧连接作废
    human.ws = ws;
    human.connected = true;
    this.wsIndex.set(ws, { roomId: room.id, seatIdx: human.seatIdx });
    if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = undefined; }
    this.send(ws, {
      type: 'joined', roomId: room.id, seatIdx: human.seatIdx, seatToken: human.seatToken,
      isHost: human.seatIdx === room.hostSeat, reconnected: true,
    });
    this.broadcastLobby(room);
    // 牌局中回归：立刻补发当前牌桌（含自己的手牌），否则会卡在大厅
    if (room.game) {
      if (room.gameType === 'bj') {
        const view = bjSanitizeState(room.game as BjTableState, human.playerId);
        const scores = room.game.players.map(p => room.scores.get(room.seatKeys[p.id]) ?? INITIAL_SCORE);
        this.send(ws, { type: 'state', state: view, yourPlayerId: human.playerId, scores });
      } else {
        const view = sanitizeState(room.game as GameState, human.playerId);
        const scores = room.game.players.map(p => room.scores.get(room.seatKeys[p.id]) ?? INITIAL_SCORE);
        this.send(ws, { type: 'state', state: view, yourPlayerId: human.playerId, scores });
      }
    }
  }

  private broadcastLobby(room: Room) {
    const players = room.humans.map(h => ({ name: h.name, seatIdx: h.seatIdx, connected: h.connected }));
    for (const h of room.humans) {
      this.send(h.ws, {
        type: 'lobby', roomId: room.id, players,
        hostSeat: room.hostSeat, youSeat: h.seatIdx,
      });
    }
  }

  private startHand(room: Room) {
    if (room.gameType === 'bj') return this.startBjHand(room);
    const humans = room.humans.filter(h => h.connected);
    if (humans.length < 2) {
      const host = room.humans[room.hostSeat];
      return this.send(host.ws, { type: 'error', message: '至少需要 2 名玩家才能开局' });
    }
    // 玩家位 = 人类 + AI 填充至 6
    room.aiStyles = AI_FILL_STYLES.slice(0, 6 - humans.length);
    const seatDefs = [
      ...humans.map(h => ({ name: h.name, style: 'human', isHero: false, seatIdx: h.seatIdx })),
      ...room.aiStyles.map(k => ({ name: BOT_STYLES[k].name.split('·')[0], style: k, isHero: false, seatIdx: -1 })),
    ];
    // 持久分数：跨手累积，可为负；负分玩家以信用筹码上桌
    room.seatKeys = seatDefs.map((s, i) => (s.seatIdx >= 0 ? `h${s.seatIdx}` : `a${i - humans.length}`));
    room.handStartChips.clear();
    const players = seatDefs.map((s, i) => {
      const carried = room.scores.get(room.seatKeys[i]) ?? INITIAL_SCORE;
      const chips = carried > 0 ? carried : CREDIT_STACK;
      room.handStartChips.set(i, chips);
      return { id: i, name: s.name, style: s.style, chips, isHero: false };
    });
    const g = newHand(players, room.dealerIdx % players.length, ++room.handNumber);
    // 记录 human 的 playerId
    humans.forEach((h, i) => { h.playerId = i; });
    room.game = g;
    this.broadcastState(room);
    this.maybeRunAI(room);
  }

  /** 本手结算：把筹码变动写回持久分数（可为负） */
  private settleHand(room: Room, finalState: GameState | BjTableState) {
    for (const p of finalState.players) {
      const key = room.seatKeys[p.id];
      const start = room.handStartChips.get(p.id) ?? p.chips;
      const carried = room.scores.get(key) ?? INITIAL_SCORE;
      room.scores.set(key, carried + (p.chips - start));
    }
  }

  /** 给每个成员发其视角的脱敏状态 */
  private broadcastState(room: Room) {
    if (!room.game) return;
    for (const h of room.humans) {
      if (!h.connected) continue;
      if (room.gameType === 'bj') {
        const view = bjSanitizeState(room.game as BjTableState, h.playerId);
        const scores = room.game.players.map(p => room.scores.get(room.seatKeys[p.id]) ?? INITIAL_SCORE);
        this.send(h.ws, { type: 'state', state: view, yourPlayerId: h.playerId, scores });
      } else {
        const view = sanitizeState(room.game as GameState, h.playerId);
        const scores = room.game.players.map(p => room.scores.get(room.seatKeys[p.id]) ?? INITIAL_SCORE);
        this.send(h.ws, { type: 'state', state: view, yourPlayerId: h.playerId, scores });
      }
    }
  }

  /** AI / 断线托管行动循环 */
  private maybeRunAI(room: Room) {
    if (!room.game || room.aiThinking) return;
    if (room.gameType === 'bj') { this.maybeRunBjAI(room); return; }
    const g = room.game as GameState;
    if (g.street === 'handOver') return;
    const idx = g.actingIdx;
    if (idx < 0) return;
    const human = room.humans.find(h => h.playerId === idx);
    const humanOnline = human?.connected === true;
    if (humanOnline) return; // 等真人操作

    room.aiThinking = true;
    setTimeout(() => {
      room.aiThinking = false;
      if (!room.game) return;
      const cur = room.game as GameState;
      if (cur.actingIdx !== idx || cur.street === 'handOver') return;
      const seat = room.humans.find(h => h.playerId === idx);
      if (seat?.connected) return;   // 玩家已重连，交给真人操作（避免刚上线就被托管弃牌）
      let res;
      if (seat) {
        // 断线托管：能过牌就过牌，否则弃牌
        const la = legalActions(cur, idx);
        res = applyAction(cur, idx, la.canCheck ? 'check' : 'fold');
      } else {
        const style = BOT_STYLES[cur.players[idx].style] ?? BOT_STYLES.balanced;
        const d = botDecide(cur, idx, style);
        res = applyAction(cur, idx, d.action, d.raiseTo);
      }
      if (res.ok) {
        room.game = res.state;
        if (res.handEnded) {
          this.settleHand(room, res.state);
          room.dealerIdx = (room.dealerIdx + 1) % res.state.players.length;
        }
        this.broadcastState(room);
        if (!res.handEnded) {
          this.maybeRunAI(room);
        }
      }
    }, 1100 + Math.random() * 700);
  }

  private handleClose(ws: WebSocket) {
    const loc = this.wsIndex.get(ws);
    if (!loc) return;
    this.wsIndex.delete(ws);
    const room = this.rooms.get(loc.roomId);
    if (!room) return;
    const human = room.humans.find(h => h.seatIdx === loc.seatIdx);
    if (!human) return;
    human.connected = false;
    if (!room.game) {
      // 大厅中退出：移除并移交房主
      room.humans = room.humans.filter(h => h.seatIdx !== loc.seatIdx);
      if (room.humans.length === 0) { this.rooms.delete(room.id); return; }
      if (room.hostSeat === loc.seatIdx) room.hostSeat = room.humans[0].seatIdx;
      this.broadcastLobby(room);
    } else {
      // 牌局中断线：保留座位等待重连（不踢出、不清分数）
      // 房主掉线则移交，否则房间会卡在“等房主开下一手”
      if (room.hostSeat === loc.seatIdx) {
        const next = room.humans.find(h => h.connected);
        if (next) room.hostSeat = next.seatIdx;
      }
      this.broadcastLobby(room);
      this.maybeRunAI(room); // 若正轮到 TA，立即托管
    }
    this.scheduleCleanup(room);
  }

  /** 全员离线时延迟销毁房间，给掉线玩家留出重连窗口 */
  private scheduleCleanup(room: Room) {
    if (room.cleanupTimer) return;
    if (room.humans.some(h => h.connected)) return;
    room.cleanupTimer = setTimeout(() => {
      if (!room.humans.some(h => h.connected)) this.rooms.delete(room.id);
    }, 10 * 60 * 1000);
  }

  /** 当前手牌是否已结束（可让新玩家入座 / 房主开下一手） */
  private handFinished(room: Room): boolean {
    if (!room.game) return true;
    if (room.gameType === 'bj') return (room.game as BjTableState).phase === 'settled';
    return (room.game as GameState).street === 'handOver';
  }

  /** 21点：开一手（庄家固定 seat 0，真人在 1..H，AI 补位到最多 6 座） */
  private startBjHand(room: Room) {
    const humans = room.humans.filter(h => h.connected);
    if (humans.length < 1) {
      const host = room.humans[room.hostSeat];
      if (host) this.send(host.ws, { type: 'error', message: '至少需要 1 名玩家才能开局' });
      return;
    }
    const H = humans.length;
    // 庄家(1) + 真人(H) + AI 补位，尽量凑到 6 座；真人超过 5 时不额外补位
    const botCount = Math.max(0, 5 - H);
    const dealerIdx = BJ_DEALER_SEAT;
    room.aiStyles = [];
    room.seatKeys = [];
    room.handStartChips.clear();

    const players: BjTablePlayerSpec[] = [];
    // seat 0：庄家（AI，不下注，chips 不参与计分）
    players[dealerIdx] = { name: '庄家', isAI: true, chips: 0 };
    room.seatKeys[dealerIdx] = 'd0';
    room.handStartChips.set(dealerIdx, 0);
    // 真人座位 1..H
    for (let i = 0; i < H; i++) {
      const seat = i + 1;
      const key = `h${humans[i].seatIdx}`;
      room.seatKeys[seat] = key;
      const carried = room.scores.get(key) ?? INITIAL_SCORE;
      const chips = carried > 0 ? carried : CREDIT_STACK;
      room.handStartChips.set(seat, chips);
      players[seat] = { name: humans[i].name, isAI: false, chips };
    }
    // AI 补位座位 H+1..
    for (let j = 0; j < botCount; j++) {
      const seat = 1 + H + j;
      const key = `b${j}`;
      room.seatKeys[seat] = key;
      const carried = room.scores.get(key) ?? INITIAL_SCORE;
      const chips = carried > 0 ? carried : CREDIT_STACK;
      room.handStartChips.set(seat, chips);
      players[seat] = { name: `AI 玩家${j + 1}`, isAI: true, chips };
    }
    // 真人 playerId → 座位映射
    humans.forEach((h, i) => { h.playerId = i + 1; });

    const g = newBjTable({ players, dealerIdx, bet: BJ_BASE_BET });
    room.game = g;
    this.broadcastState(room);
    this.maybeRunBjAI(room);
  }

  /** 21点 AI / 断线托管循环：庄家阶段跑 bjDealerPlay，其余 AI 座位/掉线真人按基本策略自动打 */
  private maybeRunBjAI(room: Room) {
    if (!room.game || room.aiThinking) return;
    const g = room.game as BjTableState;
    if (g.phase === 'settled') return; // 已结算，等房主发 'start'
    const seat = g.actingSeat;
    if (seat < 0) return;
    const human = room.humans.find(h => h.playerId === seat);
    const humanOnline = human?.connected === true;
    if (humanOnline) return; // 等真人操作

    room.aiThinking = true;
    setTimeout(() => {
      room.aiThinking = false;
      if (!room.game) return;
      const cur = room.game as BjTableState;
      if (cur.phase === 'settled') return;
      if (cur.actingSeat !== seat) return;
      const seatHuman = room.humans.find(h => h.playerId === seat);
      if (seatHuman?.connected) return; // 玩家已重连，交给真人操作
      let next: BjTableState;
      if (cur.phase === 'dealer') {
        next = bjDealerPlay(cur);                 // 庄家 S17 收牌并结算
      } else {
        next = bjTableAutoApply(cur, seat);        // AI 座位 / 掉线真人：基本策略自动打（保险阶段返回 declineInsurance）
      }
      room.game = next;
      if (next.phase === 'settled') {
        this.settleHand(room, next);              // 写回持久分数；不自动开下一手（与德州一致，等房主 'start'）
        this.broadcastState(room);
      } else {
        this.broadcastState(room);
        this.maybeRunBjAI(room);
      }
      }, 1100 + Math.random() * 700);
  }
}

/** 脱敏：隐藏其他玩家的手牌（除非摊牌/结束且未弃牌） */
export function sanitizeState(state: GameState, viewerPlayerId: number): GameState {
  const reveal = state.street === 'handOver' || state.street === 'showdown';
  const players: Player[] = state.players.map(p => {
    if (p.id === viewerPlayerId) return p;
    if (reveal && !p.folded) return p;
    return { ...p, hole: [] };
  });
  return { ...state, players, deck: [] };
}

/** 挂载到 ws WebSocketServer */
export function attachRoomServer(wss: import('ws').WebSocketServer): RoomManager {
  const mgr = new RoomManager();
  wss.on('connection', ws => mgr.attach(ws));
  return mgr;
}
