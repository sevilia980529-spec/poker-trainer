# PRD｜poker-trainer 账号与云同步系统（增量 PRD）

| 项目信息 | 内容 |
| --- | --- |
| Language | 简体中文 |
| 文档类型 | 增量 PRD（仅描述本次变更，不重写全站） |
| Project Name | `poker-trainer` |
| 技术栈 | React 19 + Vite 7 + TypeScript 5.9 + Tailwind 3 + shadcn/ui(Radix) + react-router 7 + zustand 5 |
| 服务端 | 原生 Node `http`（`server/standalone-entry.ts`），esbuild 打包为 `dist-server/server.mjs`；好友房 WS 挂载在 `/ws` |
| 数据存储 | Supabase 免费版 Postgres（本次新增） |
| 部署 | Render 免费层（`render.yaml`），推送 GitHub 自动部署 |
| 视觉基线 | 暗色玻璃拟态 + 金色点缀（沿用 `.glass` / `gold` / `ink` / `ivory` 令牌，不另起视觉） |
| 文档版本 | v1.0 |
| 作者 | 许清楚（产品经理） |

---

## 0. 变更范围与现状基线

### 0.1 本次要做什么

在**完全保留现有本地"伪账号"体系**的前提下，叠加一层**邮箱+密码的真实账号系统**与**云端进度同步**能力，并保证在云端不可用时自动、无声地退回纯游客模式。

### 0.2 现状事实核对（已实地读码，作为设计约束）

| 模块 | 位置 | 现状 | 对本次变更的影响 |
| --- | --- | --- | --- |
| 用户/段位 | `src/store/userStore.ts` | zustand + `persist(localStorage, key='pokermind-user', version=2)`；`Account{id,nickname,avatar,xp,lastDailyCheckin,consecutiveLoginDays,createdAt}`；顶层镜像字段 + `accounts[]` + `activeId` | 段位由 `xp` 经 `src/lib/level.ts` 推导，**同步 XP 即等于同步等级** |
| 训练统计 | `src/store/drillStats.ts` | **不是 zustand**，是裸 localStorage 函数（`loadDrillStats` / `recordAnswer`），key=`poker-trainer-drill-stats-v1`；字段 `answered/correct/streak/bestStreak/perCategory` | ⚠️ 无订阅点，**必须包一层统一写入口**才能触发同步 |
| 积分/筹码 | `src/store/points.ts` | **不是 zustand**，裸 localStorage 函数（`loadProfile`/`saveProfile`），key=`poker-trainer-profile-v1`；字段 `points/handsPlayed/handsWon/totalProfit/excellentActions/mistakes/biggestPot/createdAt`；另有 `HandReviewRecord` 复盘记录（key=`poker-trainer-reviews-v1`，本次**不同步**） | ⚠️ 同上；且**只有余额，没有流水明细**，流水需新增记录点（列 P1） |
| 入口路由 | `src/App.tsx` | `if (!activeId) return <AccountGate />` —— **当前无本地账号就完全进不去应用** | 必须改造：`AccountGate` 从"拦门"变成"欢迎页（可跳过）" |
| 账号门 | `src/components/AccountGate.tsx` | 全屏卡片，列出本地账号 or 创建账号 | 改造为三入口：游客进入 / 登录 / 注册 |
| 个人中心 | `src/pages/Profile.tsx` | 段位卡 + 战绩卡 + 训练卡 + 账号管理（切换/添加/退出/删除）+ 重置战绩 | 追加"云同步状态卡"，账号区按登录态分叉 |
| 服务端 | `server/standalone-entry.ts` | 原生 `http.createServer`，手写静态文件 + `WebSocketServer({server, path:'/ws'})`，**无 body 解析、无路由框架、无 cookie 解析** | 新增 `/api/*` 需在 `createServer` 回调里手写路由分发 + 手动读 body |
| 前端 WS | `src/pages/FriendRoom.tsx` | `new WebSocket(\`${proto}://${location.host}/ws\`)` | 好友房不改；昵称来源改为"云端昵称优先，游客回落本地昵称" |

### 0.3 不在本次范围内

好友房对局逻辑、德州/21点/掼蛋玩法、专项训练题库与判定逻辑，全部保持不变。

---

## 1. 产品目标

| # | 目标 | 度量方式 |
| --- | --- | --- |
| G1 | **把游客变成注册用户**：让已在本机积累进度的老游客有强动机完成注册 | 上线 30 天内，游客设备注册转化率 ≥ **25%**（注册成功数 ÷ 有过 ≥1 次对局/答题的游客设备数） |
| G2 | **进度永不丢**：注册用户换设备、换浏览器、清缓存后核心进度可完整恢复 | XP/等级、训练统计（答题数·正确率·最佳连对）、签到与连续天数、欢乐豆余额 四类核心字段恢复率 = **100%**（抽 20 个账号做跨设备回归） |
| G3 | **零破坏**：账号改造不引发任何玩法回归 | 德州、21点、专项训练、好友房 4 条主链路回归用例 **100% 通过**；上线后由账号改动导致的玩法缺陷 = **0** |
| G4 | **优雅降级**：云端不可用（未配置 / 超时 / 报错 / Supabase 宕机）时应用照常可玩 | 任意注入故障下，应用可玩率 **100%**，无白屏、无阻塞弹窗、无 console 未捕获异常；降级后首屏可交互 ≤ **2s** |
| G5 | **密码与密钥零泄露** | 密码 **100%** 经 bcrypt（cost ≥ 10）加盐哈希存储，服务端日志/响应体中明文密码出现次数 = **0**；`service_role` key 在前端 bundle / GitHub 仓库中命中次数 = **0**（gitleaks + `grep -r` 双重校验） |

---

## 2. 用户故事与验收标准

### 2.1 新用户（本机无任何数据）

| ID | 用户故事 | 验收标准 |
| --- | --- | --- |
| US-01 | 作为**新用户**，我想用邮箱+密码注册一个账号，这样我的训练进度就能跨设备保存 | ① 在欢迎页点「注册」进入 `/register`；② 填写邮箱+密码（≥8 位，含字母和数字）后点注册，≤3s 内注册成功并自动登录；③ 注册后自动进入 `/`，`Profile` 页显示云端邮箱与"已同步"；④ 刷新页面仍保持登录 |
| US-02 | 作为**新用户**，我想先不注册就体验一下，觉得好用再注册 | ① 欢迎页点「先以游客身份玩」直接进入 `/`；② 可完整玩德州/21点/专项训练/好友房；③ 所有页面顶部出现游客提示条，点「登录」随时跳转 |

### 2.2 老游客用户（本机已有进度）

| ID | 用户故事 | 验收标准 |
| --- | --- | --- |
| US-03 | 作为**已有本机进度的老游客**，我想注册后一键把进度搬到云端，这样换手机不会从零开始 | ① 注册成功瞬间弹出迁移引导弹窗，展示本机进度摘要（XP/欢乐豆/答题数·正确率/连续签到天数）；② 选择「合并到云端（推荐）」后 ≤5s 完成迁移；③ 迁移后本机数值与云端完全一致；④ 迁移完成后弹窗自动关闭并 toast「进度已上传云端」 |
| US-04 | 作为**老游客**，我担心迁移会覆盖掉我已有的云端数据，所以我希望看清楚再决定 | ① 弹窗提供三个互斥选项：合并到云端（默认选中）/ 以本机覆盖云端 / 不上传使用云端进度；② 选择"以本机覆盖云端"时有二次确认；③ 选择"不上传"时本机数据**保留不删除**，仅断开同步 |

### 2.3 已注册用户（多设备 / 回归）

| ID | 用户故事 | 验收标准 |
| --- | --- | --- |
| US-05 | 作为**已注册用户**，我希望刷新页面、关掉浏览器第二天再打开都不用重新登录 | ① 会话有效期 **30 天**；② 冷启动时 `<LoadingScreen>` 之外最多等待 **2s** 即渲染页面（登录态在后台继续确认，不阻塞）；③ 期间游客态 UI 不会闪烁出现（已登录态用本机缓存的 `user` 快照先渲染） |
| US-06 | 作为**多设备用户**（手机 + 平板），我希望两边的数据最终一致，不会互相覆盖 | ① 设备 A 打完 10 手牌得 +500 XP，设备 B 登录后刷新可见 XP 已包含这 500；② 两设备同时在线并各自产生增量时，采用增量合并，**任何一方的增量都不丢失**（验收：A、B 各玩 5 题，最终云端 `drill_answered` = 初始值 + 10，而非 5） |
| US-07 | 作为**已注册用户**，我想修改昵称和头像，并在所有设备上生效 | ① Profile 页「编辑资料」可改昵称（≤12 字符）与头像（12 个预设 + 自定义上传）；② 保存后 ≤3s 内同步到云端；③ 另一台设备重新登录后显示新昵称/头像 |
| US-08 | 作为**已注册用户**，我想能安全退出登录 | ① Profile 页「退出登录」二次确认后，清除会话 cookie 与本机云端快照；② 退出后立即变为游客态并出现游客提示条；③ **本机游戏数据不删除**（仅停止同步） |
| US-09 | 作为**已注册用户**，我希望云端挂了也能继续玩 | ① 手动把 `SUPABASE_SERVICE_ROLE_KEY` 置空后重启服务，应用全程无报错弹窗、无白屏；② 此时欢迎页/Profile 不展示登录注册入口（改为灰色"云端账号暂未开放"）；③ 已登录用户退化为只读本地，进度继续存 localStorage |

---

## 3. 需求池

优先级：**P0 = 必须有（本次上线）**，**P1 = 应该有（上线后 1–2 周）**，**P2 = 可以有（排期待定）**。

### 3.1 P0 —— 必须有

#### 认证

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| **AUTH-01** | **邮箱注册**：`POST /api/auth/register`，入参 `{email, password, nickname?}`，服务端 trim + lowercase 归一化邮箱 | 注册成功后返回 `{user}` 并下发会话 cookie；响应体**绝不包含** `password_hash`；默认昵称取 `nickname` 或 `'新玩家'`，默认头像 `/avatars/1.png` |
| **AUTH-02** | **邮箱格式校验**：前端 + 服务端**双重**校验（服务端为准） | 正则 `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`；不合法时输入框描边转 `danger`、下方 12px 红字提示、提交按钮禁用；绕过前端直接 curl 非法邮箱返回 400 |
| **AUTH-03** | **密码强度**：前端 + 服务端**双重**校验 | 规则：长度 8–64；**必须**同时包含字母与数字；不能是纯重复字符（如 `aaaaaaaa`）；不能与邮箱前缀相同（忽略大小写）。前端实时显示「弱/中/强」三格强度条；服务端不合规返回 400 + 明确错误码 |
| **AUTH-04** | **重复邮箱检测** | 利用 `users.email` 唯一索引；重复时返回 **409** + `{code:'EMAIL_TAKEN'}`，前端提示「该邮箱已注册，去登录？」（附一键跳转登录并预填邮箱）；**不得**通过先查询再插入的方式判断（有竞态） |
| **AUTH-05** | **登录**：`POST /api/auth/login` | 邮箱不存在与密码错误返回**同一**文案「邮箱或密码错误」（防账号枚举）；成功后下发会话 cookie 并返回 `{user, progress}` |
| **AUTH-06** | **登出**：`POST /api/auth/logout` | 服务端下发过期 cookie（`Max-Age=0`）；客户端清除 `authStore`；本机 localStorage 游戏数据**保留** |
| **AUTH-07** | **会话保持**：基于 HMAC 签名的无状态会话令牌（`node:crypto`），写入 `httpOnly` + `SameSite=Lax` + 生产环境 `Secure` 的 cookie `pm_session`，有效期 30 天 | ① 刷新页面、关闭浏览器重开均保持登录；② 服务端**无内存 session**（Render 免费层重启/冷启动不丢登录态）；③ 令牌载荷仅含 `{uid, iat, exp}`，签名密钥来自环境变量 `SESSION_SECRET` |
| **AUTH-08** | **会话恢复**：`GET /api/auth/me` 返回 `{user, progress, revision}`；未登录返回 401 | 前端在 `App` 挂载时调用，**超时 2s 未完成则按游客渲染并在后台重试 1 次**，绝不使用 `await` 阻塞首屏 |
| **AUTH-09** | **密码安全**：服务端 `bcryptjs`（纯 JS，免 node-gyp 编译）加盐哈希，`cost = 10`；登录校验用 `bcrypt.compare` | ① 数据库中 `password_hash` 均为 `$2a$10$...` / `$2b$10$...` 格式；② 任何日志、错误栈、API 响应中不出现明文密码；③ 登录失败返回**统一**文案，不区分"邮箱不存在"与"密码错误" |

#### 同步

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| **SYNC-01** | **云端拉取**：登录成功 / `auth/me` 成功 / 手动点「立即同步」时全量拉取云端快照并写入本地 | 拉取后 `userStore` 的 `xp/lastDailyCheckin/consecutiveLoginDays/nickname/avatar`、`drillStats`、`points` 与云端一致 |
| **SYNC-02** | **增量上报**：客户端维护 `lastSyncedSnapshot`（上次成功同步后的云端快照），上报时只提交 `snapshot → current` 的**差值**，而非整包覆盖 | ① 答题、打牌、签到、领补给等写入点触发防抖上报（防抖 **3s**，页面隐藏/卸载时立即 flush）；② 服务端执行 `cloud = cloud + delta`；③ 上报成功后更新 `lastSyncedSnapshot` |
| **SYNC-03** | **乐观锁防覆盖**：上报携带 `baseRevision`，服务端比对不匹配返回 **409** + 最新快照，客户端重算差值后自动重试（最多 2 次，指数退避 300ms/900ms） | A、B 两设备并发上报同一账号，双方增量均不丢失（对应用例 US-06 ②） |
| **SYNC-04** | **游客→注册一键迁移**（详见 §4.1）：注册/登录后若本机存在非零进度，弹出迁移引导弹窗，提供 3 种策略 | 三种策略结果均符合 §4.1 表格；迁移过程有 loading 态与失败重试；迁移只成功执行一次（`users` 表加 `migrated_at` 幂等标记） |
| **SYNC-05** | **多设备一致性**：云端为唯一真相源，本地为缓存 + 增量队列（详见 §4.2 字段合并矩阵） | ① 同一账号在 2 台设备交替使用 20 次，核心累计字段无回退、无翻倍；② `revision` 单调递增 |
| **SYNC-06** | **同步范围**：XP 与等级、训练统计（已答/正确/连对/最佳连对/分项正确数）、每日签到与连续签到天数、欢乐豆余额与牌桌计数、昵称与头像 | 对照 §5 字段清单，14 个进度字段全部可上云；`HandReviewRecord` 复盘记录、好友房房间状态、本机多账号列表**明确不同步** |

#### 界面

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| **UI-01** | 注册页 `/register`（详见 §6.1） | 375px 下无横向滚动、无元素重叠；输入框高度 48px，主按钮 52px，所有可点区 ≥ 44×44 |
| **UI-02** | 登录页 `/login`（详见 §6.2） | 同上；支持系统密码管理器自动填充（`autoComplete="email"` / `"current-password"`） |
| **UI-03** | 个人中心 Profile 改造（详见 §6.3） | 登录态与游客态两套账号区；新增云同步状态卡（已同步/同步中/离线/云端不可用 4 态） |
| **UI-04** | 游客模式提示条（详见 §6.4） | 全局展示于 `Header` 下方；可关闭，冷启动重新出现 1 次；云端不可用时**不展示**（改为提示"云端账号暂未开放"） |
| **UI-05** | 迁移引导弹窗（详见 §6.5） | 展示本机进度摘要 + 3 个互斥选项；默认选中「合并到云端」；有「稍后再说」出口 |
| **UI-06** | 欢迎页改造（`AccountGate` → 三入口，详见 §6.6） | 首启动展示「游客进入 / 登录 / 注册」；已点过游客或已有本机账号则不再拦门，直接进 `/` |

#### 非功能

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| **NFR-01** | **自动降级为纯游客模式**：服务端 `GET /api/health` 返回 `{ok:true, cloud:boolean}`，`cloud = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)` | ① 环境变量缺失时 `cloud=false`；② 前端拿到 `cloud=false` **隐藏**全部登录/注册入口，不出现"注册失败"；③ `/api/health` 请求失败或超时 3s 也按 `cloud=false` 处理，并在后台静默重试 1 次 |
| **NFR-02** | **全链路兜底**：所有云端调用（fetch / WS 无关）必须 `try/catch` + `AbortController` 超时（健康检查 3s、读写 8s） | 人为 mock 500 / 超时 / 断网三种故障，应用无未捕获异常、无白屏、仍可完整游玩；失败时采用指数退避重试（1s / 3s / 9s，最多 3 次）后静默放弃 |
| **NFR-03** | **移动端优先**：以 **375px** 为设计基准，向上适配到 430px；触控目标 ≥ **44×44px**；主按钮 ≥ 52px 高 | 在 iPhone SE（375）与 iPhone 15 Pro Max（430）真机/模拟器上逐页走查通过；输入框聚焦时不被软键盘遮挡（`visualViewport` 处理或 `scrollIntoView`） |
| **NFR-04** | **不破坏现有功能**：`userStore` 既有方法签名**一个都不改**；`drillStats`/`points` 的导出函数签名保持不变（内部改为经由统一写入口） | 德州、21点、专项训练、好友房、掼蛋 5 条链路冒烟用例 100% 通过；`git diff` 中不含对既有玩法逻辑的修改 |
| **NFR-05** | **密钥安全**：`SUPABASE_SERVICE_ROLE_KEY` / `SESSION_SECRET` 只出现在 `server/` 代码与 Render 环境变量面板 | ① 前端 bundle（`dist/assets/*.js`）中 grep `service_role` / `SERVICE_ROLE` = 0 命中；② 仓库中新增 `.env.example`（只写键名不写值），`.gitignore` 增加 `.env*`；③ 前端如需直连 Supabase 只允许用 `VITE_SUPABASE_ANON_KEY`（本次 P0 不需要） |
| **NFR-06** | **性能**：账号相关接口不拖慢首屏 | 冷启动首屏可交互 ≤ 2s（含 900ms `LoadingScreen`）；同步上报全部异步，不阻塞任何交互；单次同步 payload < 8KB |

### 3.2 P1 —— 应该有

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| **AUTH-10** | **找回密码接口预留**：服务端预留 `POST /api/auth/reset/request` 与 `POST /api/auth/reset/confirm` 路由，未配置邮件通道时返回 **501** + `{code:'NOT_IMPLEMENTED'}` | 前端「忘记密码」点击后展示「密码找回功能开发中，敬请期待」弹窗；路由已存在且可被 curl 命中，返回结构稳定（为 P2 实现留出契约） |
| **AUTH-11** | **修改密码**（已登录态）：校验原密码后可设置新密码 | 修改成功后其他设备的会话**全部失效**（通过 `users.token_version` 字段实现） |
| **AUTH-12** | **登录失败限流**：同 IP + 同邮箱，15 分钟内连续失败 ≥ 5 次则锁定 15 分钟 | 使用进程内 `Map`（Render 免费层无持久盘，属 best-effort）；超限返回 429 + 明确提示剩余等待时间 |
| **AUTH-13** | **注销云端账号**：删除 `users` + 级联删除 `user_progress`，清除会话 | 需输入密码二次确认；本机数据可选保留 |
| **SYNC-07** | **离线队列持久化**：断网期间的增量写入 localStorage 队列，恢复网络后自动补传 | 断网完成 10 题后恢复网络，30s 内云端 `drill_answered` 补齐 +10；队列持久化，刷新页面不丢 |
| **SYNC-08** | **同步状态可视化**：Profile 云同步卡展示「已同步 / 同步中… / 离线（N 条待同步）/ 云端不可用」四态 + 最后同步时间 + 「立即同步」按钮 | 断网时显示待同步条数；点击「立即同步」有 loading 与结果 toast |
| **SYNC-09** | **欢乐豆流水明细**：新增云端 `point_ledger` 表（余额仍为权威值，流水仅作审计与回溯） | 每次积分变动记录 `{delta, balance_after, reason, created_at}`；Profile 可查看最近 50 条 |
| **UI-07** | **表单体验增强**：邮箱/密码框支持一键清除、粘贴优化、错误抖动动效（复用现有 `.anim-shake`） | 与设计走查通过 |
| **NFR-07** | **简易风控日志**：记录注册/登录/失败事件（**仅记录邮箱哈希与 IP 前缀**，不记录明文邮箱与密码） | 可在服务端日志中检索到事件流水 |

### 3.3 P2 —— 可以有

| ID | 需求 | 说明 |
| --- | --- | --- |
| **AUTH-14** | 找回密码完整实现（邮件验证码 + `password_resets` 表） | 依赖邮件通道选型，见 §7 Q2 |
| **AUTH-15** | 邮箱验证（注册后发验证邮件，未验证限制同步频率） | 建议默认关闭，避免抬高注册门槛 |
| **AUTH-16** | 第三方登录（Apple / Google） | Supabase Auth 托管时才低成本 |
| **SYNC-10** | 复盘记录 `HandReviewRecord` 上云 | 当前仅存本机，最多 50 条 |
| **SYNC-11** | 设备管理与强制下线（查看登录设备列表、踢出其他设备） | 需新增 `user_sessions` 表 |
| **UI-08** | 头像上传至 Supabase Storage（替代 dataURL 存库） | 当前 dataURL 约 30–120KB/条，免费版 500MB 约可存 4000 个 |

---

## 4. 关键流程设计

### 4.1 游客 → 注册的一键迁移

触发时机：`register` 成功 或 `login` 成功 的响应返回后，检测本机是否存在"非零进度"
（判据：`xp > 0 || points !== 10000 || drillStats.answered > 0 || handsPlayed > 0`），且云端账号 `migrated_at IS NULL`。

| 策略 | 语义 | 各字段处理 |
| --- | --- | --- |
| **① 合并到云端（默认推荐）** | 双端进度取并集，谁也不丢 | 累计型字段走**增量累加**；峰值型字段取 `max`；覆盖型字段（昵称/头像）以 `updated_at` 较新者胜；签到取 `max` 且服务端按日期重算连续天数 |
| **② 以本机覆盖云端** | 本机为准，云端被替换 | 需二次确认，明确列出将被丢弃的云端数值；本质是"用本机快照整体覆盖"+ `revision+1` |
| **③ 不上传，使用云端进度** | 云端为准，本机停用 | 云端快照下发覆盖本地；**本机旧数据不删除**，写入 `localStorage['pm_local_backup_<timestamp>']` 保留 30 天；此后本机进入正常同步模式 |

迁移执行步骤（策略①）：
1. 客户端计算本地相对"零值基线"的全量快照 `S_local`；
2. `POST /api/sync/migrate`，body `{strategy:'merge'|'overwrite'|'keep_cloud', snapshot:S_local}`；
3. 服务端在**单个事务**内按字段合并矩阵（§4.2）写入 `user_progress`，置 `migrated_at = now()`，`revision +1`；
4. 返回合并后快照，客户端写入本地 store 并初始化 `lastSyncedSnapshot`；
5. 弹窗关闭，toast「进度已上传云端」。

失败处理：任意一步失败则整体回滚，弹窗回到可选状态并展示「迁移失败，可稍后在个人中心重试」；Profile 页保留「重新迁移」入口。

### 4.2 字段合并矩阵（SYNC-05 的权威定义）

| 字段类别 | 字段 | 合并规则 | 说明 |
| --- | --- | --- | --- |
| **增量累计型** | `xp`、`points`、`hands_played`、`hands_won`、`total_profit`、`excellent_actions`、`mistakes`、`drill_answered`、`drill_correct`、`drill_per_category[*].answered/correct` | `cloud = cloud + delta`，`delta = local - lastSyncedSnapshot` | 云端为权威账本，本地只提交增量；支持离线与多设备并发 |
| **峰值型** | `biggest_pot`、`drill_best_streak` | `cloud = max(cloud, local)` | 单调不减，不允许回退 |
| **LWW 状态型** | `nickname`、`avatar`、`drill_streak`（当前连对） | `updated_at` 较新者胜 | `drill_streak` 错答会清零，不能用 max |
| **签到型** | `last_daily_checkin`、`consecutive_login_days` | `last_daily_checkin = max(...)`；`consecutive_login_days` 由服务端依据 `last_daily_checkin` 日期**重算**后取 `max` | 关键：杜绝跨设备/改系统时间重复领取签到奖励 |
| **幂等标记** | `migrated_at` | 仅首次写入 | 防止重复迁移导致数据翻倍 |

### 4.3 优雅降级流程（NFR-01 / NFR-02）

```
App 挂载
  ├─ 并行：GET /api/health（超时 3s）
  │    ├─ 成功 cloud=true  → cloudEnabled = true   → 正常展示登录/注册入口
  │    ├─ 成功 cloud=false → cloudEnabled = false  → 隐藏入口，展示"云端账号暂未开放"
  │    └─ 失败/超时        → cloudEnabled = false（后台静默重试 1 次）
  │
  └─ 并行：GET /api/auth/me（超时 2s，不阻塞首屏）
       ├─ 200 → 已登录，写入 authStore，触发 SYNC-01 拉取
       ├─ 401 → 游客态
       └─ 超时/失败 → 先按"上次本机缓存的登录快照"渲染，后台重试 1 次；仍失败 → 转游客态

任何一次云端 fetch 失败：
  try/catch 捕获 → 指数退避重试(1s/3s/9s, 上限 3 次) → 仍失败则
    ├─ 标记 syncStatus='offline'，待同步变更入队
    ├─ 静默（不弹错误 toast、不阻塞交互）
    └─ 游戏继续，数据照写 localStorage
```

### 4.4 会话生命周期

| 事件 | 行为 |
| --- | --- |
| 注册 / 登录成功 | 服务端 `Set-Cookie: pm_session=<HMAC(uid.iat.exp)>; HttpOnly; SameSite=Lax; Secure(prod); Max-Age=2592000` |
| 每次请求 | 服务端用 `SESSION_SECRET` 验签；失败 → 401 |
| 30 天到期 | 401 → 前端转游客态并 toast「登录已过期，请重新登录」（数据不丢） |
| 登出 | 服务端下发 `Max-Age=0` cookie；客户端清空 `authStore` 与 `lastSyncedSnapshot`；**localStorage 游戏数据保留** |
| 改密（P1） | `users.token_version +1`，验签时校验版本号，实现全局下线 |

---

## 5. 数据字段清单（本地 → 云端映射）

### 5.1 表 `users`（认证 + 资料）

| 云端字段 | Postgres 类型 | 约束 | 本地来源 | 同步方向 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | 新建 | → | 服务端生成 |
| `email` | `text`（建议 `citext`） | UNIQUE, NOT NULL | 注册输入 | → | 统一 `trim().toLowerCase()` |
| `password_hash` | `text` | NOT NULL | bcrypt(cost=10) | →（**永不回传**） | 绝不出现在任何响应体 |
| `nickname` | `text` | NOT NULL, default `'新玩家'`, ≤12 字符 | `userStore.nickname` | ↕ LWW | |
| `avatar` | `text` | default `'/avatars/1.png'` | `userStore.avatar` | ↕ LWW | 预设路径或 dataURL（限 128KB） |
| `created_at` | `timestamptz` | default `now()` | `Account.createdAt` | → | |
| `updated_at` | `timestamptz` | default `now()` | — | → | LWW 依据 |
| `last_login_at` | `timestamptz` | nullable | — | → | 登录成功时写 |
| `migrated_at` | `timestamptz` | nullable | — | → | 迁移幂等标记（SYNC-04） |
| `token_version` | `int4` | default 0 | — | → | P1 改密全局下线 |
| `email_verified` | `bool` | default false | — | → | P2 预留 |

### 5.2 表 `user_progress`（游戏进度，1:1 关联 users）

| 云端字段 | Postgres 类型 | 约束 | 本地来源 | 合并规则 |
| --- | --- | --- | --- | --- |
| `user_id` | `uuid` | PK, FK → `users(id)` ON DELETE CASCADE | — | — |
| `xp` | `int4` | default 0, `CHECK >= 0` | `userStore.xp` | 增量累加（**等级由 xp 推导，不单独存**） |
| `last_daily_checkin` | `int8` | default 0（毫秒 epoch） | `userStore.lastDailyCheckin` | `max` |
| `consecutive_login_days` | `int4` | default 0 | `userStore.consecutiveLoginDays` | 服务端按日期重算后取 `max` |
| `points` | `int8` | default 10000 | `points.ts → profile.points` | 增量累加（delta 可为负） |
| `hands_played` | `int4` | default 0 | `profile.handsPlayed` | 增量累加 |
| `hands_won` | `int4` | default 0 | `profile.handsWon` | 增量累加 |
| `total_profit` | `int8` | default 0 | `profile.totalProfit` | 增量累加（可为负） |
| `excellent_actions` | `int4` | default 0 | `profile.excellentActions` | 增量累加 |
| `mistakes` | `int4` | default 0 | `profile.mistakes` | 增量累加 |
| `biggest_pot` | `int8` | default 0 | `profile.biggestPot` | `max` |
| `drill_answered` | `int4` | default 0 | `drillStats.answered` | 增量累加 |
| `drill_correct` | `int4` | default 0 | `drillStats.correct` | 增量累加 |
| `drill_streak` | `int4` | default 0 | `drillStats.streak` | LWW(`updated_at`) |
| `drill_best_streak` | `int4` | default 0 | `drillStats.bestStreak` | `max` |
| `drill_per_category` | `jsonb` | default `'{}'::jsonb` | `drillStats.perCategory` | 逐 key 增量累加<br>`{[cat]: {answered, correct}}` |
| `revision` | `int8` | default 0 | — | 每次写入 +1，乐观锁（SYNC-03） |
| `updated_at` | `timestamptz` | default `now()` | — | LWW / 冲突判定依据 |

### 5.3 P1/P2 预留表

```sql
-- P1：欢乐豆流水（SYNC-09）
point_ledger (id bigserial PK, user_id uuid FK, delta int8, balance_after int8,
              reason text, created_at timestamptz)

-- P2：密码重置令牌（AUTH-14）
password_resets (id bigserial PK, user_id uuid FK, token_hash text,
                 expires_at timestamptz, used_at timestamptz)
```

### 5.4 明确**不同步**的数据

| 数据 | 存储位置 | 理由 |
| --- | --- | --- |
| `HandReviewRecord` 复盘记录 | `poker-trainer-reviews-v1` | 最多 50 条、体量大、属本地回溯用途（P2 再议） |
| `userStore.accounts[]` 本机多账号列表 | `pokermind-user` | 属"本机多配置文件"概念，与云端账号正交；**登录后隐藏该 UI**，游客态保留 |
| 好友房房间/座位状态 | 服务端内存 | 原本就在服务端，不属账号数据 |
| `lastSyncedSnapshot`、离线队列 | 本机 localStorage | 同步机制自身状态 |

### 5.5 ⚠️ 给架构师的实现提示（重要）

`src/store/drillStats.ts` 与 `src/store/points.ts` **都不是 zustand store**，而是直接读写 localStorage 的裸函数，被 `Home / PokerTrainer / Blackjack / Drills / FriendRoom / Guandan / TrainingHub / Profile / Header` 9 个文件直接调用。若不加改造，**没有任何统一挂载点可以触发云端同步**。

要求：**保持导出函数签名不变**的前提下，内部收敛为统一写入口（例如 `commitProfile(mutator)` / `commitDrillStats(mutator)`），由该入口负责：写 localStorage → 更新 `authStore.pendingDelta` → 触发防抖上报。这样既满足 NFR-04「不破坏现有功能」，又能让 SYNC-02 落地。

---

## 6. UI 设计稿

### 6.0 通用视觉与移动端规范（所有界面共用）

| 项 | 规范 |
| --- | --- |
| 设计基准 | **375 × 812**（iPhone SE / 12 mini 级），向上适配至 430px；`max-w-2xl mx-auto` 居中 |
| 背景 | 沿用 `body` 的 `/images/bg-dark-cards.png` 深色牌桌底纹 + `#0A0A0A` |
| 卡片 | 一律使用现有 `.glass`（`rgba(26,26,26,.6)` + `blur(20px) saturate(180%)` + `1px rgba(212,168,87,.15)` 金边），`rounded-2xl`，`p-5` |
| 主色 | 金 `#D4A857` / 浅金 `#E8C273` / 暗金 `#A67C32`；文字 `ivory #F5EFE0`（主）/ `ivory/60`（次）/ `ivory/30`（弱） |
| 主按钮 | 沿用 `AccountForm` 现有效果：`bg-gradient-to-r from-gold-dark to-gold text-black font-bold rounded-full`，**高度 52px**，`active:scale-95` |
| 次按钮 | 透明底 + `border border-gold/30` + 金色文字，高度 48px |
| 输入框 | `bg-ink-light` + `border border-gold-dark/40` + `rounded-lg` + `text-ivory`，**高度 48px**，`focus:border-gold`；错误态 `border-danger` + 下方 12px `#E53935` 文案 |
| 触控 | 所有可点区 ≥ **44×44px**；`components/common/Button.tsx` 已内置 `min-h-[44px]`，复用即可 |
| 弹窗 | 复用 `components/common/Modal.tsx`（`bg-ink-card` + 金边 + `rounded-2xl` + `max-h-[85vh] overflow-y-auto`） |
| 反馈 | 复用 `components/common/Toast.tsx`（`useToast().success/error/info`） |
| 动效 | 复用 `animate-fade-up` / `.anim-shake`（表单校验抖动）；尊重 `prefers-reduced-motion` |
| 安全区 | 顶部 `.safe-top`、底部 `.safe-bottom`（`index.css` 已有工具类） |
| 键盘 | 输入框聚焦时 `scrollIntoView({block:'center'})`，保证提交按钮不被软键盘遮挡 |

---

### 6.1 UI-01 注册页 `/register`

**布局描述**：单列纵向滚动。顶栏固定（返回 + 右侧"登录"文字按钮）→ 品牌区（LOGO + 标题 + 副标题）→ 玻璃卡片内放表单（昵称选填 → 邮箱 → 密码（含强度条 + 明文切换）→ 确认密码 → 主按钮 → 去登录）→ 底部协议说明 → 分割线 → 游客入口。

```
┌─────────────────────────────────────┐  ← 375px
│ safe-top                            │
│  ‹ 返回                      登录   │  44px 顶栏，右为金色文字按钮
├─────────────────────────────────────┤
│                                     │
│                🃏                    │  88×88 圆角渐变（from-gold→gold-dark）
│            创建账号                  │  22px bold ivory
│      云端保存进度 · 换设备不丢       │  13px ivory/50
│                                     │
│ ┌─────────────────────────────────┐ │  .glass 卡片
│ │ 昵称（选填）                     │ │  12px ivory/60 标签
│ │ ┌─────────────────────────────┐ │ │
│ │ │ 牌桌高手                12  │ │ │  48px；右下角字数计数
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ 邮箱 *                          │ │
│ │ ┌─────────────────────────────┐ │ │  48px，type=email
│ │ │ you@example.com             │ │ │  inputMode=email
│ │ └─────────────────────────────┘ │ │
│ │ ⚠ 邮箱格式不正确                │ │  12px danger（错误时显示）
│ │                                 │ │
│ │ 密码 *                          │ │
│ │ ┌───────────────────────┐ ┌──┐ │ │  48px；右侧 44×44 眼睛按钮
│ │ │ ••••••••              │ │👁│ │ │  切换 type=text/password
│ │ └───────────────────────┘ └──┘ │ │
│ │ 强度  ▰▰▰▱▱  中                 │ │  3 格：弱#E53935 / 中#E8C273 / 强#43A047
│ │ 8-64 位，需含字母和数字          │ │  11px ivory/40
│ │                                 │ │
│ │ 确认密码 *                      │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ ••••••••                    │ │ │  两次不一致时边框转 danger
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │        注 册 并 进 入         │ │ │  52px 金色渐变主按钮
│ │ └─────────────────────────────┘ │ │  校验未过 = disabled+opacity-50
│ │                                 │ │
│ │         已有账号？去登录         │ │  13px gold 居中
│ └─────────────────────────────────┘ │
│                                     │
│  注册即同意《用户协议》《隐私政策》 │  11px ivory/30 居中
│  我们不会向第三方共享你的邮箱       │
│                                     │
│  ──────────── 或 ────────────       │  分割线 + 12px ivory/30
│ ┌─────────────────────────────────┐ │
│ │   🎮  先以游客身份玩（不注册）   │ │  48px ghost 金边按钮
│ └─────────────────────────────────┘ │
│ safe-bottom                         │
└─────────────────────────────────────┘
```

**交互要点**
- 邮箱 `onBlur` 立即校验；密码强度**实时**计算（长度 ≥8 记 1 分，含字母记 1 分，含数字记 1 分，≥10 位记 1 分；0–1 弱 / 2 中 / 3–4 强）。
- 提交按钮在「邮箱格式 OK + 密码强度 ≥ 中 + 两次密码一致」前保持 disabled；点击时若未过校验，卡片整体 `.anim-shake` 抖动 0.4s。
- 邮箱已存在（409 `EMAIL_TAKEN`）：邮箱框转红 + 下方提示「该邮箱已注册，[去登录]」，`[去登录]` 为可点金色文字，跳转 `/login?email=xxx` 预填。
- 注册中按钮进入 loading（`Spinner` + disabled），禁止重复提交。
- 顶面/底面安全区适配；软键盘弹起时自动滚动使激活输入框居中。

---

### 6.2 UI-02 登录页 `/login`

**布局描述**：比注册页精简。顶栏（返回 + "注册"）→ 品牌区 → 玻璃卡片（邮箱 → 密码 → 错误提示 → 主按钮 → 忘记密码/去注册）→ 游客入口。

```
┌─────────────────────────────────────┐
│ safe-top                            │
│  ‹ 返回                      注册   │
├─────────────────────────────────────┤
│                🃏                    │  88×88
│            欢迎回来                  │  22px bold ivory
│       登录后继续你的牌手之路         │  13px ivory/50
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 邮箱                             │ │
│ │ ┌─────────────────────────────┐ │ │  48px，autoComplete="email"
│ │ │ you@example.com             │ │ │  预填上次登录邮箱（本机记住）
│ │ └─────────────────────────────┘ │ │
│ │ 密码                             │ │
│ │ ┌───────────────────────┐ ┌──┐  │ │  48px，autoComplete="current-password"
│ │ │ ••••••••              │ │👁│  │ │
│ │ └───────────────────────┘ └──┘  │ │
│ │ ⚠ 邮箱或密码错误（还可尝试 4 次）│ │  12px danger
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │           登  录             │ │ │  52px 金色渐变
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │  忘记密码？            去注册 →  │ │  左右分布 13px，左 ivory/50 右 gold
│ └─────────────────────────────────┘ │
│                                     │
│  ──────────── 或 ────────────       │
│ ┌─────────────────────────────────┐ │
│ │   🎮  先以游客身份玩（不登录）   │ │  48px ghost 金边
│ └─────────────────────────────────┘ │
│ safe-bottom                         │
└─────────────────────────────────────┘
```

**交互要点**
- 支持系统密码管理器自动填充；回车（Go 键）即提交。
- 失败提示**不区分**"邮箱不存在"与"密码错误"；连续失败时展示剩余尝试次数（P1 AUTH-12 限流后）。
- 登录成功后 `navigate('/', {replace:true})`，并立即触发 SYNC-01 拉取；若本机有进度则弹出迁移弹窗（UI-05）。
- 「忘记密码」P0 点击弹窗提示「密码找回功能开发中，敬请期待」（接口已预留 501，见 AUTH-10）。

---

### 6.3 UI-03 个人中心 `Profile.tsx` 改造

**改造原则**：现有 4 个区块（段位卡 / 牌桌战绩 / 训练数据 / 操作）**保持原样**，只做两件事 —— ① 在段位卡与战绩卡之间**插入云同步状态卡**；② 账号区按登录态分叉。

#### A. 已登录态

```
┌─────────────────────────────────────┐
│  ‹   个人中心                       │  PageHeader（不变）
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │  段位卡（完全不变）
│ │ ┌────┐  牌桌高手  ✏️            │ │  头像 64px 可点 → 编辑资料
│ │ │ 🖼 │  🥇 黄金 II              │ │  LevelBadge
│ │ └────┘              12,480 欢乐豆│ │
│ │  ▓▓▓▓▓▓▓▓▓░░░░░  1,850/2,500 XP │ │  金色进度条
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │  ★ 新增：云同步状态卡
│ │ ☁️ 云端账号          ● 已同步    │ │  14px；状态点：绿/黄/灰/红
│ │ player@mail.com                  │ │  13px ivory/60，邮箱★号脱敏
│ │ 上次同步：2 分钟前    [立即同步] │ │  12px ivory/40 + 右侧文字按钮
│ └─────────────────────────────────┘ │     （离线时显示「3 条待同步」）
│                                     │
│ ┌─────────────────────────────────┐ │  牌桌战绩（不变，3 列网格）
│ │ 总场次 │ 胜率 │ 总盈亏            │ │
│ │ 最大底池 │ 决策准确率 │ 连续登录   │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │  训练数据（不变）
│ │ 已答题数 │ 答题正确率 │ 最佳连对  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │  账号区（改造，列表项 48px 高）
│ │ 👤 编辑资料                   › │ │  → 弹窗（复用 AccountForm）
│ │ 🔑 修改密码                   › │ │  P1 AUTH-11
│ │ 🚪 退出登录                   › │ │  ivory/70，点击弹二次确认
│ │ 🗑 删除云端账号               › │ │  P1 AUTH-13，danger 红字
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │  操作区（不变）
│ │ 领取补给 / 重置战绩数据          │ │
│ └─────────────────────────────────┘ │
│   进度已自动云端备份 · 换设备登录即可恢复  │  11px ivory/30
│ safe-bottom                         │
└─────────────────────────────────────┘
```

#### B. 游客态（`cloudEnabled=true` 时）

账号区替换为：

```
┌─────────────────────────────────┐
│ 未登录 · 进度仅存本机，清缓存会丢失│  12px 警告黄 #E8C273
│ ┌─────────────────────────────┐ │
│ │      登录 / 注册账号          │ │  52px 金色渐变主按钮
│ └─────────────────────────────┘ │
│ 📱 切换本机账号（3）           › │ │  保留现有本地多账号能力
│ 📤 把本机进度导入云端           › │ │  跳转 /login 并标记 intent=migrate
└─────────────────────────────────┘
```

#### C. 云端不可用时（`cloudEnabled=false`）

账号区替换为灰色禁用态 + 文案「云端账号暂未开放，当前为纯本地模式」，**不展示**登录/注册按钮。

**云同步状态卡四态定义**

| 状态 | 圆点 | 文案 | 右侧操作 |
| --- | --- | --- | --- |
| 已同步 | 🟢 `#43A047` | 已同步 · 上次同步：X 分钟前 | 立即同步 |
| 同步中 | 🟡 `#D4A857`（脉冲） | 同步中… | 禁用 |
| 离线 | ⚪ `#8A8A8A` | 离线 · N 条待同步 | 立即同步（点击重试） |
| 不可用 | 🔴 `#E53935` | 云端不可用（本地模式） | 隐藏 |

---

### 6.4 UI-04 游客模式提示条

**位置**：全局，位于 `components/common/Header.tsx` 之下、`main` 内容之上，所有页面共享（`Home / Lobby / TrainingHub / Drills / Profile` 等），游戏对局页（`PokerTrainer / Blackjack / FriendRoom / Guandan`）**不展示**（避免干扰牌局）。

```
┌─────────────────────────────────────┐
│ 👤 游客模式 · 进度仅存本机  [登录] ✕ │  高度 44px
└─────────────────────────────────────┘
   整条区域可点 → 跳转 /login
```

**规格**
- 背景 `rgba(212,168,87,.10)`，下边框 `1px rgba(212,168,87,.25)`，无圆角（通栏）。
- 左：👤 图标 16px + 「游客模式 · 进度仅存本机」13px `ivory/70`。
- 右：金色 pill 按钮「登录」（高 32px，横向 padding 12px，**连同整条热区 ≥ 44px**）+ 关闭 ✕（32×32，触控热区扩展到 44×44）。
- 点击整条 → `/login`；点击 ✕ → 本次会话不再展示，冷启动后重新出现 1 次。
- 已登录 或 `cloudEnabled=false` 时**完全不渲染**。

---

### 6.5 UI-05 迁移引导弹窗

**触发**：注册/登录成功后，检测到本机有非零进度且 `migrated_at IS NULL`。

```
        ┌───────────────────────────────────┐
        │      🎉  发现本机游戏进度          │  18px gold bold，居中
        │                                   │
        │  检测到你在本机已积累：            │  13px ivory/70
        │  ┌─────────────────────────────┐  │  bg-ink-light/50 rounded-xl p-3
        │  │ XP        1,850             │  │  两列：标签 ivory/60 + 数值
        │  │ 欢乐豆    12,480            │  │  数值 gold bold，等宽 .num
        │  │ 答题      320 题 · 正确率 78%│  │
        │  │ 连续签到  5 天               │  │
        │  └─────────────────────────────┘  │
        │                                   │
        │  要把这些进度上传到云端账号        │  13px ivory/70
        │  「p****r@mail.com」吗？           │  邮箱脱敏，13px ivory
        │                                   │
        │  ┌─────────────────────────────┐  │
        │  │ ● 合并到云端（推荐）         │  │  RadioGroup，选项行高 56px
        │  │   XP/欢乐豆累加，峰值取高    │  │  11px ivory/40 副说明
        │  └─────────────────────────────┘  │  选中项：ring-1 ring-gold + bg-gold/10
        │  ┌─────────────────────────────┐  │
        │  │ ○ 以本机进度覆盖云端         │  │
        │  │   云端现有数据将被替换       │  │  11px danger/70
        │  └─────────────────────────────┘  │
        │  ┌─────────────────────────────┐  │
        │  │ ○ 不上传，使用云端进度       │  │
        │  │   本机数据保留但不再同步     │  │
        │  └─────────────────────────────┘  │
        │                                   │
        │  ┌─────────────────────────────┐  │
        │  │        确 认 迁 移           │  │  52px 金色渐变
        │  └─────────────────────────────┘  │  执行中 → Spinner + disabled
        │           稍后再说                 │  14px ivory/50 ghost
        └───────────────────────────────────┘
                                            Modal: max-w-md，max-h-[85vh] 可滚动
```

**交互要点**
- 默认选中「合并到云端」；选择「以本机进度覆盖云端」时，点击「确认迁移」弹**二次确认**（列出将被丢弃的云端数值）。
- 「确认迁移」执行中禁止关闭弹窗（遮罩点击/返回键无效）；失败时弹窗回到可选状态 + 顶部红字「迁移失败：{原因}，可稍后重试」。
- 「稍后再说」关闭弹窗并 `sessionStorage` 标记，本次会话不再打扰；Profile 页保留「把本机进度导入云端」入口。
- 若云端账号已有数据（非新注册），弹窗顶部追加一行灰色提示：「云端账号现有：XP 3,200 · 欢乐豆 8,000」，便于用户对比决策。

---

### 6.6 UI-06 欢迎页 `AccountGate` 改造（首启动）

**改造原因**：当前 `App.tsx` 中 `if (!activeId) return <AccountGate />` 会**完全阻断**未建本地账号的用户。游客模式要求必须放行。

```
┌─────────────────────────────────────┐
│ safe-top                            │
│                                     │
│                                     │
│                🃏                    │  80×80 金色渐变圆角
│            扑克训练场                │  26px bold ivory
│       训练你的决策，赢在牌桌之前      │  13px ivory/50
│                                     │
│ ┌─────────────────────────────────┐ │  .glass 卡片 max-w-sm
│ │ ┌─────────────────────────────┐ │ │
│ │ │       📧  邮箱注册            │ │ │  52px 金色渐变主按钮 → /register
│ │ └─────────────────────────────┘ │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │         已有账号登录          │ │ │  48px ghost 金边 → /login
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │  ─────────── 或 ───────────    │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │   🎮  直接开始（游客模式）    │ │ │  48px ghost → 写 pm_guest_seen
│ │ └─────────────────────────────┘ │ │     并 navigate('/')
│ └─────────────────────────────────┘ │
│                                     │
│  游客模式可完整游玩，进度保存在本机浏览器  │  11px ivory/30
│  注册后可云端备份，换设备不丢失            │
│                                     │
│ safe-bottom                         │
└─────────────────────────────────────┘
```

**触发规则**（替换 `App.tsx` 中 `if (!activeId)` 的判断）
- 条件：本机**无**云端登录快照 **且** 无 `localStorage['pm_guest_seen']` **且** `accounts.length === 0` → 展示欢迎页。
- 其余情况（已有本地账号 / 已点过游客 / 已登录）→ **直接进 `/`**，不再拦门。
- 云端不可用（`cloudEnabled=false`）时，隐藏「邮箱注册」「已有账号登录」，仅保留「直接开始（游客模式）」+ 灰字「云端账号暂未开放」。

---

## 7. 待确认问题

| # | 问题 | 说明与建议 |
| --- | --- | --- |
| **Q1** | **认证实现方案**：A) 自建 `users` 表 + 服务端 bcrypt（本 PRD 默认） vs B) 直接用 Supabase Auth（GoTrue）托管密码？ | 方案 A 完全满足"必须 bcrypt"要求、密钥全在服务端、UI 完全可控，但找回密码/邮箱验证需自建；方案 B 自带找回密码与邮箱验证、省去密码逻辑，但自定义 UI 与迁移策略受限，且"是否 bcrypt"由 Supabase 决定。**建议选 A**，请拍板 |
| **Q2** | **找回密码的邮件通道**：Supabase 内置 SMTP（免费版约 3–4 封/小时）还是外接 Resend（免费 3000 封/月，需新增 `RESEND_API_KEY`）？P1 阶段是否接受"点击忘记密码 → 提示人工重置"作为兜底？ | 影响 AUTH-14 的实现成本与上线时间 |
| **Q3** | **自定义头像是否允许**？当前 `AccountForm` 支持上传图片并压缩为 256px dataURL 直接存库（约 30–120KB/条）。Supabase 免费版 500MB 约可存 4000 个自定义头像 | 建议 P0 允许但限制 ≤128KB，P2 迁至 Supabase Storage |
| **Q4** | **多设备同时在线**是否允许？本 PRD 按"允许 + 增量合并"设计（SYNC-03 乐观锁）。若业务要求"后登录踢掉前者"，需额外增加 `user_sessions` 表与强制下线逻辑 | 建议保持"允许" |
| **Q5** | **Render 免费层冷启动约 30–60s**，首次 `/api/auth/me` 与 `/api/health` 大概率超时。是否接受"首屏 2s 后按游客渲染、登录态在后台静默重试"？ | 这是 NFR-01 的设计前提，需确认体验可接受 |
| **Q6** | **是否需要邮箱验证**才能同步数据？ | 建议 P0 不需要（降低注册门槛、无邮件通道），列为 P2 |
| **Q7** | **登录后是否保留"本机多账号"功能**？ | 建议：登录态**隐藏**"切换本机账号"，游客态保留，避免两套账号概念混淆。若需保留请确认交互 |

---

## 附录 A：本次涉及的新增/修改文件清单（供架构师排期参考）

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | `src/store/authStore.ts` | 会话态 `status / user / cloudEnabled / syncStatus / pendingDelta` |
| 新增 | `src/lib/api.ts` | 统一 fetch 封装：`/api/health`、`/api/auth/*`、`/api/sync/*`，带超时 + 重试 + try/catch |
| 新增 | `src/hooks/useCloudSync.ts` | 启动拉取、防抖上报、离线队列、页面隐藏 flush |
| 新增 | `src/pages/Login.tsx`、`src/pages/Register.tsx` | UI-01 / UI-02 |
| 新增 | `src/components/GuestBanner.tsx` | UI-04 |
| 新增 | `src/components/MigrateDialog.tsx` | UI-05 |
| 新增 | `server/auth.ts` | bcrypt、HMAC 会话令牌、cookie 读写、`/api/auth/*` 与 `/api/sync/*` 路由处理器 |
| 新增 | `server/supabase.ts` | 仅服务端引用的 Supabase REST 客户端（service_role，通过环境变量注入） |
| 新增 | `supabase/schema.sql` | 建表 + 索引 + RLS 关闭说明（service_role 绕过 RLS） |
| 新增 | `.env.example` | 只写键名：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SESSION_SECRET` |
| 修改 | `src/App.tsx` | 路由追加 `/login`、`/register`；`AccountGate` 放行逻辑（UI-06） |
| 修改 | `src/components/AccountGate.tsx` | 三入口欢迎页 |
| 修改 | `src/pages/Profile.tsx` | 云同步卡 + 账号区分叉（UI-03） |
| 修改 | `src/store/drillStats.ts`、`src/store/points.ts` | **保持导出签名不变**，内部收敛为统一写入口（见 §5.5） |
| 修改 | `server/standalone-entry.ts` | 在 `createServer` 回调中增加 `/api/*` 路由分发与 JSON body 解析 |
| 修改 | `render.yaml` | 新增三个环境变量占位（`sync: false`，在 Render 面板填值） |
| 修改 | `.gitignore` | 追加 `.env*`、`!.env.example` |
| 修改 | `package.json` | 新增依赖 `bcryptjs` + `@types/bcryptjs`（纯 JS，无需 node-gyp） |
| 不改 | `server/rooms.ts`、好友房、德州/21点/掼蛋/专项训练逻辑 | — |
