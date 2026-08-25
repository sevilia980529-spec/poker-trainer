// 好友房集成测试：起真实 WS 服务器，两个客户端完整打一手牌
import { WebSocketServer, WebSocket } from 'ws';
import { attachRoomServer } from './server/rooms';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };

interface Client {
  ws: WebSocket;
  name: string;
  seatIdx: number;
  playerId: number;
  roomId: string;
  lastState: any;
  isHost: boolean;
  sawOpponentCards: boolean; // 游戏进行中是否看到过对手手牌（不应看到）
}

function makeClient(name: string, port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c: Client = { ws, name, seatIdx: -1, playerId: -1, roomId: '', lastState: null, isHost: false, sawOpponentCards: false };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'joined') { c.seatIdx = msg.seatIdx; c.roomId = msg.roomId; c.isHost = msg.isHost; }
      if (msg.type === 'state') {
        c.lastState = msg.state;
        c.playerId = msg.yourPlayerId;
        // 脱敏检查：游戏未结束时，别人的 hole 必须是空
        if (msg.state.street !== 'handOver' && msg.state.street !== 'showdown') {
          for (const p of msg.state.players) {
            if (p.id !== msg.yourPlayerId && p.hole.length > 0) c.sawOpponentCards = true;
          }
        }
      }
    });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeout = 15000, label = ''): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await sleep(100);
  }
  console.error('TIMEOUT waiting for:', label);
  return false;
}

async function main() {
  const wss = new WebSocketServer({ port: 0 });
  attachRoomServer(wss);
  const port = (wss.address() as any).port;

  const alice = await makeClient('Alice', port);
  const bob = await makeClient('Bob', port);

  // 1. Alice 建房，Bob 加入
  alice.ws.send(JSON.stringify({ type: 'create', name: 'Alice' }));
  assert(await waitFor(() => alice.roomId !== '', 3000, 'alice create'), 'Alice 应收到房间码');
  assert(alice.isHost, 'Alice 应为房主');
  const roomId = alice.roomId;
  bob.ws.send(JSON.stringify({ type: 'join', roomId, name: 'Bob' }));
  await sleep(300);

  // 2. 房主开局
  alice.ws.send(JSON.stringify({ type: 'start' }));
  assert(await waitFor(() => !!alice.lastState && !!bob.lastState, 3000, 'initial state'), '双方都应收到开局状态');
  assert(alice.lastState.players.length === 6, `应填充到 6 人，实际 ${alice.lastState.players.length}`);
  assert(alice.playerId !== bob.playerId, '两人玩家位应不同');

  // 3. 轮到自己时随机行动，直到本手结束
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const c of [alice, bob]) {
      const s = c.lastState;
      if (s && s.actingIdx === c.playerId && s.street !== 'handOver') {
        const me = s.players[c.playerId];
        const toCall = s.currentBet - me.streetBet;
        const r = Math.random();
        let action: string;
        if (toCall === 0) action = r < 0.7 ? 'check' : 'bet';
        else action = r < 0.55 ? 'call' : r < 0.8 ? 'fold' : 'raise';
        c.ws.send(JSON.stringify({ type: 'action', action, raiseTo: s.currentBet + s.minRaise }));
      }
    }
    if (alice.lastState?.street === 'handOver') break;
    await sleep(150);
  }

  assert(alice.lastState?.street === 'handOver', `一手牌应打完，实际 ${alice.lastState?.street}`);
  assert(!!alice.lastState?.winners?.length, '应有赢家');
  const total = alice.lastState.players.reduce((s: number, p: any) => s + p.chips, 0);
  assert(total === 6 * 2000, `筹码守恒：${total} 应为 12000`);
  assert(!alice.sawOpponentCards && !bob.sawOpponentCards, '游戏进行中不应看到对手手牌');

  // 4. 下一手（房主）
  alice.ws.send(JSON.stringify({ type: 'start' }));
  assert(await waitFor(() => alice.lastState?.handNumber === 2, 3000, 'second hand'), '应开始第二手');

  wss.close();
  console.log(failures === 0 ? '✅ 好友房集成测试通过' : `❌ ${failures} 个失败`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
