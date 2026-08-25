import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { WebSocketServer } from 'ws'
import { attachRoomServer } from './server/rooms'

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
  plugins: [inspectAttr(), react(), friendRoomPlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
