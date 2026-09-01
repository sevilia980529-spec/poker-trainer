import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { WebSocketServer } from 'ws'
import { attachRoomServer } from './server/rooms'
import { apiPlugin } from './server/dev-api-plugin'

// 好友房 WebSocket 服务器：挂在 Vite dev server 同一端口，路径 /ws
function friendRoomPlugin(): Plugin {
  return {
    name: 'friend-room-ws',
    configureServer(server) {
      if (!server.httpServer) return;
      const wss = new WebSocketServer({ server: server.httpServer as import('http').Server, path: '/ws' });
      attachRoomServer(wss);
      console.log('[friend-room] WebSocket 好友房服务已启动: /ws');
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // apiPlugin()：把 /api/* 挂到 Vite dev server 同端口（与好友房 WS 共用 3000）
  plugins: [inspectAttr(), react(), friendRoomPlugin(), apiPlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
