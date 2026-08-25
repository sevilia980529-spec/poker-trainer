# 牌技 AI 训练场

德州扑克 / 掼蛋 / 21点 训练软件：AI 陪练、教练系统（胜率/位置/下注/诈唬教学）、专项刷题、好友房、积分系统。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:3000（好友房 WS 同端口 /ws）
```

## 本地生产模式

```bash
npm run start      # 构建 + 启动一体化服务器，默认 http://localhost:7100
```

## 公开部署（手机/电脑都能玩）

项目是一体化 Node 应用（静态站点 + WebSocket 好友房），任何支持 Node 的平台都能跑。

### 方案 A：Render（推荐，免费，自带 HTTPS 公网链接）

1. 把本项目上传到 GitHub（新建仓库 → 推送）
2. 打开 https://render.com → 注册 → **New → Blueprint** → 选择你的仓库
3. Render 会自动读取 `render.yaml`，几分钟后得到 `https://你的应用.onrender.com` 公开链接
4. 以后每次 `git push`，Render 自动重新部署更新

### 方案 B：Railway

1. 上传 GitHub 后，在 https://railway.app 选 **Deploy from GitHub repo**
2. 设置：Build Command `npm ci && npm run build && npm run build:server`，Start Command `node dist-server/server.mjs`
3. 在 Settings → Networking 生成公网域名

### 方案 C：自己的服务器 / VPS（Docker）

```bash
docker build -t poker-trainer .
docker run -d -p 7100:7100 poker-trainer
```

### 方案 D：VPS（不用 Docker）

```bash
npm ci && npm run build && npm run build:server
PORT=80 node dist-server/server.mjs    # 或用 pm2 常驻
```

## 注意

- 积分、战绩、复盘存在**浏览器本地**（localStorage），换设备不互通
- 好友房需要所有玩家访问**同一个服务器地址**（同一公网链接即可）
- `npm run preview`（纯静态预览）不含好友房功能，公开部署请用上面的方案
