// 生产模式一体化服务器：静态托管 dist/ + 好友房 WebSocket（/ws）
// 构建：npm run build:server → dist-server/server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { attachRoomServer } from './rooms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT ?? 7100);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let filePath = path.join(DIST, urlPath);
    // 防目录穿越
    if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    // SPA 路由回退
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = path.join(DIST, 'index.html');
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(body);
  } catch {
    res.writeHead(500); res.end('server error');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
attachRoomServer(wss);

server.listen(PORT, () => {
  console.log(`[poker-trainer] 服务已启动: http://localhost:${PORT}（好友房 WS: /ws）`);
});
