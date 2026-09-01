# 账号系统 · 部署与配置指南

本指南说明如何把云端账号系统（邮箱+密码注册/登录 + 跨端进度同步）真正跑起来。
涉及三方：本地开发、Supabase（数据库）、Render（生产部署）。

---

## 0. 前置条件

- 已有一个 Supabase 项目（免费版即可）。
- 仓库已推送到 GitHub，且 Render 已按 `render.yaml` 接入（push 即自动部署）。
- 分支策略：本功能在 `feature/cloud-account` 分支开发，**合入 main 后才触发 Render 部署**。
  切勿直接把未经验证的改动推到 main。

环境变量名（服务端只读，绝不可加 `VITE_` 前缀，否则密钥会被打进前端）：

| 变量 | 作用 | 本地 | Render |
|------|------|------|--------|
| `SUPABASE_URL` | 项目 URL | `.env` | 面板手填（`sync:false`） |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端直连密钥（绕过 RLS） | `.env` | 面板手填（`sync:false`） |
| `SESSION_SECRET` | HMAC 会话签名密钥 | `.env`（或留空自动随机） | 自动生成 |
| `PORT` | 服务端口 | `.env`（默认 7100） | 平台注入 |

---

## 1. 建表（Supabase）

1. 打开 Supabase Dashboard → 你的项目 → **SQL Editor**。
2. 新建查询，把仓库里的 **`supabase/schema.sql`** 全文粘贴进去。
3. 点击 **Run**。

该脚本：
- 创建 `public.users`（账号主表）和 `public.user_progress`（每位用户一行进度）。
- 建立大小写不敏感唯一索引 `users_email_lower_uidx` —— 与服务端 409「邮箱已注册」探测正则**强绑定**，改名会导致注册冲突识别失效。
- 全部 `IF NOT EXISTS`，可重复执行。

> 列名全部 snake_case，与 `server/types.ts` 的 `UserRow` / `ProgressRow` 一一对应；service_role 默认绕过 RLS，故未启用行级安全。

验证建表成功（SQL Editor 执行）：
```sql
select count(*) from information_schema.tables
where table_schema='public' and table_name in ('users','user_progress');
-- 期望返回 2
```

---

## 2. 取 service_role key

1. Supabase Dashboard → **Project Settings → API**。
2. 复制 **`service_role`**（注意不是 `anon`，`anon` 权限不够且不能绕过 RLS）。
3. 这就是要填到 `.env` / Render 面板的 `SUPABASE_SERVICE_ROLE_KEY`。

> ⚠️ service_role 拥有完全读写权限，**只在服务端使用**，绝不出现在任何前端代码或响应里。
> 前端若需要 Supabase 能力，应另用 anon key + RLS，但本项目前端**完全不连 Supabase**（只连我们自己的 `/api/*`）。

---

## 3. 本地开发

```bash
# 1) 准备 .env（已 gitignore）
cp .env.example .env
#    编辑 .env，填入 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY
#    SESSION_SECRET 可留空（会自动生成临时密钥）

# 2) 启动「一体化」开发服务器（Vite 前端 + 注入的 /api 路由，单端口）
npm run dev:server
#    默认 http://localhost:7100

# 仅改了前端时的热更新开发：
npm run dev          # 纯前端，/api 走 Vite dev-api-plugin 注入
```

探测云端是否生效：
```
GET http://localhost:7100/api/health
→ {"ok":true,"cloud":true}      # 配置正确
→ {"ok":true,"cloud":false}     # 未配置/配置缺失，自动游客模式，前端不崩
```

---

## 4. 生产部署（Render）

`render.yaml` 已定义：
- `buildCommand: npm ci --include=dev && npm run build && npm run build:server`
- `startCommand: node dist-server/server.mjs`
- `healthCheckPath: /api/health`

上线步骤：
1. 在 Render Dashboard → 该服务 → **Environment** 面板，设置：
   - `SUPABASE_URL`（你的项目 URL）
   - `SUPABASE_SERVICE_ROLE_KEY`（步骤 2 复制的 key）
   - `SESSION_SECRET` 由 `render.yaml` 的 `generateValue: true` 自动生成，**不要手填固定值以外的**。
2. 确认代码已合入 `main` 并推送到 GitHub → Render 自动重新部署。
3. 部署完成后访问 `https://<你的render域名>/api/health`，确认 `cloud:true`。

> 若忘记填 Supabase 变量：应用不会崩，只是 `cloud:false`，全体用户走游客模式（进度仅存本地）。

---

## 5. 端到端冒烟测试（部署后必做）

1. 游客进入：未登录应能正常游戏，本地有进度。
2. 注册：`/login` → 切到注册 → 用真实邮箱 + 合规密码注册成功，自动登录。
3. 改端同步：设备 A 玩几局 → 退出登录（或等防抖同步）→ 设备 B 用同账号登录 → 进度应合并出现。
4. 迁移弹窗：用「已有云端账号」在一台**新设备/清缓存**后登录，若本机有进度，应弹出迁移对话框（合并/覆盖/保留云端三选一）。
5. 密码强度：弱密码（<8 位、纯重复、与邮箱前缀相同）应被前端+后端双拒。

---

## 6. 排错速查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `/api/health` 返回 `cloud:false` | `SUPABASE_URL` 或 `SERVICE_ROLE_KEY` 缺失/拼错 | 检查环境变量是否生效（注意 dev 下 `.env` 由 dev-api-plugin 注入） |
| 注册报「邮箱已注册」误判 | `users_email_lower_uidx` 索引被改名/删除 | 重新执行 `schema.sql` |
| 登录 401 | 密码错 / 账号不存在（统一文案「邮箱或密码错误」） | 正常防枚举行为 |
| 同步 409 反复 | 多端高频并发 | 客户端已实现「换基准、留增量」自动重试，无需人工介入 |
| 重启后全部掉登录 | `SESSION_SECRET` 未固定（本地留空时每次随机） | 生产务必在 Render 固定 `SESSION_SECRET` |
| 前端报网络错误但后端正常 | 跨域 / 路径不对 | 一体化服务器同源，确认访问的是 `:7100` 而非纯 Vite `:5173` 跨域 |
