// ============================================================
// src/types/cloud.ts —— 前端侧的契约入口（纯 type，零运行时代码）
//
// ⚠️ 真正的契约定义在 shared/types.ts（前后端唯一一份）。
//    本文件只是一层 `export type` 转发，编译后 100% 被擦除，
//    不会把任何运行时代码打进前端产物。
//
// 这样做的目的：架构文档 §3.1 / §10.4 中约定的路径是 src/types/cloud.ts，
// 而 shared/ 目录同样被前端引用。两种 import 路径指向同一份契约，
// 前端同学 `import type { CloudUser } from '@/types/cloud'`
// 或 `from '../../shared/types'` 都能工作，不会因路径不一致而对不上。
// ============================================================
export type {
  AccumField,
  ApiError,
  ApiErrorCode,
  ApiResponse,
  AuthSessionResponse,
  CategoryStat,
  CloudUser,
  HealthResponse,
  LoginRequest,
  LogoutResponse,
  MigrateRequest,
  MigrateResponse,
  MigrateStrategy,
  PeakField,
  ProgressSnapshot,
  RegisterRequest,
  SyncConflictPayload,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  UpdateProfileRequest,
} from '../../shared/types';
