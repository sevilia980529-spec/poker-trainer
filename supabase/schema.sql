-- =====================================================================
-- poker-trainer · 云端账号系统 DDL（Supabase 免费版 Postgres）
-- 文件：supabase/schema.sql
-- 用法：Supabase Dashboard → SQL Editor → 全选粘贴 → Run
-- 幂等：全部使用 IF NOT EXISTS，可重复执行
--
-- ⚠️ 安全约定（务必遵守）：
--   1. 本 schema 启用 RLS 但【不创建任何 policy】。
--      service_role 天然绕过 RLS，anon / authenticated 一律拒绝。
--      因此绝不可添加 `using (true)` 之类的宽松 policy，否则密钥一旦
--      泄露，全表数据裸奔。
--   2. 所有访问只经由服务端（server/*.ts），浏览器永远拿不到 service_role。
-- =====================================================================

-- gen_random_uuid() 需要 pgcrypto（Supabase 默认已装，这里做幂等兜底）
create extension if not exists pgcrypto with schema extensions;


-- =====================================================================
-- 一、users：认证 + 资料（对应 PRD §5.1）
-- =====================================================================
create table if not exists public.users (
  id              uuid        primary key default gen_random_uuid(),
  email           text        not null,
  password_hash   text        not null,             -- bcryptjs $2a$10$... / $2b$10$...
  nickname        text        not null default '新玩家',
  avatar          text        not null default '/avatars/1.png',  -- 预设路径 或 dataURL(≤128KB)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),  -- 昵称/头像 LWW 的依据
  last_login_at   timestamptz,
  migrated_at     timestamptz,                      -- 游客迁移幂等标记（SYNC-04）
  token_version   int4        not null default 0,   -- P1 改密全局下线（AUTH-11）
  email_verified  boolean     not null default false, -- P2 预留（AUTH-15）

  constraint users_nickname_len   check (char_length(nickname) between 1 and 12),
  constraint users_email_format   check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint users_avatar_len     check (char_length(avatar) <= 200000)  -- 兜底：dataURL ≤ ~128KB
);

comment on table  public.users is '云端账号（认证 + 资料），密码经 bcryptjs cost=10 哈希';
comment on column public.users.password_hash is 'bcrypt 哈希，永不出库到任何 API 响应体';
comment on column public.users.migrated_at   is '游客→云端迁移的幂等标记，非空表示已迁移过';
comment on column public.users.token_version is 'P1：改密后 +1，使已签发会话令牌全部失效';
-- P1 预留（PM Q1 约束②，本文件暂不建此列）：
--   alter table public.users add column if not exists client_updated_at timestamptz not null default now();
--   P0 用「到达顺序」LWW（后改者生效）即可，因为昵称/头像不在防抖 push 的载荷里，
--   只在用户显式编辑时走 PUT /api/profile，且 register/login/me 一律采纳云端值 ——
--   「改了昵称却被旧值覆盖」在 P0 结构上不可能发生。P1 落地时该列与 /api/profile、
--   migrate 的 LWW 判定一并改造。

-- 唯一邮箱（大小写不敏感）：即使应用层漏了 lowercase 也能挡住重复注册
-- 说明：PRD 建议 citext，这里改用 lower() 表达式索引，避免依赖扩展可用性
create unique index if not exists users_email_lower_uidx
  on public.users (lower(email));

-- 风控排查 / 运营按时间捞号
create index if not exists users_created_at_idx
  on public.users (created_at desc);


-- =====================================================================
-- 二、user_progress：游戏进度（1:1 关联 users，对应 PRD §5.2）
-- =====================================================================
create table if not exists public.user_progress (
  user_id                uuid   primary key references public.users(id) on delete cascade,

  -- —— 增量累计型（cloud = cloud + delta）——
  xp                     int4   not null default 0,       -- 段位由 xp 经 src/lib/level.ts 推导，不单独存等级
  points                 int8   not null default 10000,   -- 欢乐豆余额（delta 可为负）
  hands_played           int4   not null default 0,
  hands_won              int4   not null default 0,
  total_profit           int8   not null default 0,       -- 累计盈亏（可为负）
  excellent_actions      int4   not null default 0,
  mistakes               int4   not null default 0,
  drill_answered         int4   not null default 0,
  drill_correct          int4   not null default 0,

  -- —— 峰值型（cloud = max(cloud, local)）——
  biggest_pot            int8   not null default 0,
  drill_best_streak      int4   not null default 0,

  -- —— LWW 状态型（按 client_updated_at 较新者胜）——
  drill_streak           int4   not null default 0,       -- 当前连对：错答会清零，不能用 max

  -- —— 签到型——
  last_daily_checkin     int8   not null default 0,       -- 毫秒 epoch，取 max
  consecutive_login_days int4   not null default 0,       -- 服务端按日期重算后取 max

  -- —— 分项训练统计（逐 key 增量累加）——
  drill_per_category     jsonb  not null default '{}'::jsonb,  -- { [cat]: { answered, correct } }

  -- —— 同步元数据——
  revision               int8   not null default 0,       -- 每次写入 +1，乐观锁（SYNC-03）
  client_updated_at      timestamptz not null default now(), -- 客户端快照最后变更时刻，drill_streak 的 LWW 依据
  updated_at             timestamptz not null default now(),

  constraint progress_xp_nonneg        check (xp >= 0),
  constraint progress_consec_nonneg    check (consecutive_login_days >= 0),
  constraint progress_streak_nonneg    check (drill_streak >= 0),
  constraint progress_best_streak_nonneg check (drill_best_streak >= 0),
  constraint progress_revision_nonneg  check (revision >= 0)
);

comment on table  public.user_progress is '游戏进度快照；云端为唯一真相源，本地为缓存 + 增量';
comment on column public.user_progress.revision is '乐观锁版本号，单调递增；PATCH 时作为 CAS 条件';
comment on column public.user_progress.drill_per_category is '{"preflop":{"answered":10,"correct":8}} 逐 key 增量累加';

create index if not exists user_progress_updated_at_idx
  on public.user_progress (updated_at desc);


-- =====================================================================
-- 三、行级安全（RLS）
-- =====================================================================
alter table public.users         enable row level security;
alter table public.user_progress enable row level security;

-- 故意不建 policy：
--   · service_role（我们的 server）绕过 RLS，读写正常；
--   · anon / authenticated 即使拿到 anon key 也一行读不到。
-- 如需校验，可在 SQL Editor 执行：
--   set local role anon; select count(*) from public.users;  -- 期望 0 行 / 报错


-- =====================================================================
-- 四、P1 / P2 预留表（PRD §5.3，P0 阶段不使用，仅占位避免日后 ALTER）
-- =====================================================================

-- 【仅登记契约，本文件不建表】P1 SYNC-12：签到服务端裁决
--   契约：POST /api/sync/checkin → { snapshot, revision, granted:{xp,points,consecutiveLoginDays} }
--   服务端按 UTC+8 判定「今天是否已签到」并发放奖励；离线时仍本地发放。
--   P0 已知缺口：签到奖励（+50 XP / +500 欢乐豆）走的是增量累加通道，
--   换设备或手动回拨系统时间可重复领取。P0 接受（XP 无货币价值），P1 收口。
--   兜底：单次 delta 绝对值 > 10_000_000 时告警并截断。

-- P1 SYNC-09：欢乐豆流水（余额仍是权威值，流水只做审计与回溯）
create table if not exists public.point_ledger (
  id             bigserial   primary key,
  user_id        uuid        not null references public.users(id) on delete cascade,
  delta          int8        not null,
  balance_after  int8        not null,
  reason         text        not null,
  created_at     timestamptz not null default now()
);
create index if not exists point_ledger_user_created_idx
  on public.point_ledger (user_id, created_at desc);
alter table public.point_ledger enable row level security;

-- P2 AUTH-14：密码重置令牌（只存 token 的 sha256，不存明文）
create table if not exists public.password_resets (
  id          bigserial   primary key,
  user_id     uuid        not null references public.users(id) on delete cascade,
  token_hash  text        not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists password_resets_token_hash_idx
  on public.password_resets (token_hash);
create index if not exists password_resets_user_idx
  on public.password_resets (user_id, created_at desc);
alter table public.password_resets enable row level security;


-- =====================================================================
-- 五、权限（Supabase 默认 service_role 已具备，此处做幂等兜底）
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant all on public.users, public.user_progress, public.point_ledger, public.password_resets to service_role';
    execute 'grant all on all sequences in schema public to service_role';
  end if;
end $$;


-- =====================================================================
-- 六、刷新 PostgREST schema 缓存
-- 建表后 Supabase 通常自动刷新；若调用报
--   "Could not find the table 'public.users' in the schema cache"
-- 再单独执行下面这一行。
-- =====================================================================
notify pgrst, 'reload schema';


-- =====================================================================
-- 附：本地自检 SQL（不需要执行，供联调排查）
--   select id, email, nickname, migrated_at from public.users order by created_at desc limit 10;
--   select * from public.user_progress where user_id = '<uid>';
--   select email from public.users where lower(email) = lower('Test@Mail.com');  -- 重复检测
-- =====================================================================
