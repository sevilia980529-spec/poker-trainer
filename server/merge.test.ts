// ============================================================
// server/merge.test.ts —— 合并矩阵单元测试（可脱离网络运行）
//
// 运行：npm run test:merge
//   （先用 esbuild 打包成 dist-test/merge.test.mjs，再交给 node --test，
//     这样不依赖 Node 的实验性 type-stripping，Node 20+ 都能跑）
//
// 覆盖：ACCUM 累加 / PEAK 不回退 / LWW 取新 / 签到 max / perCategory /
//       clamp 收敛 / 迁移三策略 / **409 换基准留增量推演（ARCH §6.4）**
// ============================================================
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ZERO_BASELINE } from '../shared/constants';
import type { ProgressSnapshot, SyncPushRequest } from '../shared/types';
import {
  clampInt,
  computeMigrate,
  mergeCheckin,
  mergePerCategory,
  mergeProgress,
  mergeSnapshot,
  rowToSnapshot,
  sanitizeSnapshot,
  snapshotToRow,
} from './merge';
import type { ProgressRow } from './types';

const NOW = 1_756_000_000_000;              // 固定「现在」，保证结果可复现
const iso = (ts: number): string => new Date(ts).toISOString();

/** 构造一条云端行（默认 = 全新账号） */
function makeRow(over: Partial<ProgressRow> = {}): ProgressRow {
  return {
    user_id: 'u-1',
    xp: 0,
    points: 10000,
    hands_played: 0,
    hands_won: 0,
    total_profit: 0,
    excellent_actions: 0,
    mistakes: 0,
    drill_answered: 0,
    drill_correct: 0,
    biggest_pot: 0,
    drill_best_streak: 0,
    drill_streak: 0,
    last_daily_checkin: 0,
    consecutive_login_days: 0,
    drill_per_category: {},
    revision: 5,
    client_updated_at: iso(NOW - 60_000),
    updated_at: iso(NOW - 60_000),
    ...over,
  };
}

/** 构造一次 push 请求（只填关心的字段） */
function makePush(over: Partial<SyncPushRequest> = {}): SyncPushRequest {
  return {
    baseRevision: 5,
    delta: {},
    peak: {},
    perCategoryDelta: {},
    checkin: null,
    lww: null,
    ...over,
  };
}

function snapshot(over: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return { ...ZERO_BASELINE, drillPerCategory: {}, ...over };
}

describe('clampInt', () => {
  test('越界被夹逼，非有限数一律按下界处理（脏数据不放大）', () => {
    assert.equal(clampInt(10, 0, 5), 5);
    assert.equal(clampInt(-3, 0, 5), 0);
    assert.equal(clampInt(3.9, 0, 100), 3);      // 取整
    assert.equal(clampInt(Number.NaN, 2, 5), 2);
    assert.equal(clampInt(Number.POSITIVE_INFINITY, 2, 5), 2, '非有限数按下界，绝不取上界');
    assert.equal(clampInt(Number.NEGATIVE_INFINITY, 2, 5), 2);
  });
});

describe('增量累加型（ACCUM）', () => {
  test('云端 + delta，正负增量都生效', () => {
    const cloud = makeRow({ xp: 100, points: 10000, drill_answered: 4, drill_correct: 3 });
    const merged = mergeProgress(cloud, makePush({
      delta: { xp: 50, points: -200, drillAnswered: 3, drillCorrect: 2 },
    }), NOW);

    assert.equal(merged.xp, 150);
    assert.equal(merged.points, 9800);
    assert.equal(merged.drill_answered, 7);
    assert.equal(merged.drill_correct, 5);
    assert.equal(merged.revision, cloud.revision + 1);
  });

  test('非法 delta（NaN / 字符串）被忽略，不污染云端', () => {
    const cloud = makeRow({ xp: 100 });
    const merged = mergeProgress(cloud, {
      ...makePush(),
      delta: { xp: Number.NaN, points: Number.POSITIVE_INFINITY },
    } as SyncPushRequest, NOW);
    assert.equal(merged.xp, 100);
    assert.equal(merged.points, 10000);
  });

  test('xp / points 不会被减成负数', () => {
    const cloud = makeRow({ xp: 10, points: 50 });
    const merged = mergeProgress(cloud, makePush({ delta: { xp: -999, points: -9999 } }), NOW);
    assert.equal(merged.xp, 0);
    assert.equal(merged.points, 0);
  });
});

describe('峰值型（PEAK）：只进不退', () => {
  test('本地值更小 → 保持云端；更大 → 更新', () => {
    const cloud = makeRow({ biggest_pot: 500, drill_best_streak: 7 });
    const smaller = mergeProgress(cloud, makePush({
      peak: { biggestPot: 300, drillBestStreak: 2 },
    }), NOW);
    assert.equal(smaller.biggest_pot, 500);
    assert.equal(smaller.drill_best_streak, 7);

    const bigger = mergeProgress(cloud, makePush({
      peak: { biggestPot: 900, drillBestStreak: 11 },
    }), NOW);
    assert.equal(bigger.biggest_pot, 900);
    assert.equal(bigger.drill_best_streak, 11);
  });

  test('drill_streak 涨了会自动抬升 drill_best_streak', () => {
    const cloud = makeRow({ drill_streak: 3, drill_best_streak: 5 });
    const merged = mergeProgress(cloud, makePush({
      lww: { drillStreak: 9, clientUpdatedAt: NOW },
    }), NOW);
    assert.equal(merged.drill_streak, 9);
    assert.equal(merged.drill_best_streak, 9);
  });
});

describe('LWW：drill_streak 取 clientUpdatedAt 较新者', () => {
  const cloudClientUpdatedAt = iso(NOW - 60_000);

  test('客户端较新 → 采纳客户端值，并前移 client_updated_at', () => {
    const r = mergeSnapshot(
      snapshot({ drillStreak: 2 }),
      makePush({ lww: { drillStreak: 8, clientUpdatedAt: NOW } }),
      NOW,
      cloudClientUpdatedAt,
    );
    assert.equal(r.snapshot.drillStreak, 8);
    assert.equal(r.clientUpdatedAt, iso(NOW));
  });

  test('客户端较旧 → 保持云端值（连对可以被清零，不能用 max）', () => {
    const r = mergeSnapshot(
      snapshot({ drillStreak: 6 }),
      makePush({ lww: { drillStreak: 0, clientUpdatedAt: NOW - 120_000 } }),
      NOW,
      cloudClientUpdatedAt,
    );
    assert.equal(r.snapshot.drillStreak, 6, '云端更新，本地的 0 不应覆盖');
    assert.equal(r.clientUpdatedAt, cloudClientUpdatedAt);
  });

  test('时刻相同 → 客户端胜（>= 语义）', () => {
    const ts = NOW - 60_000;
    const r = mergeSnapshot(
      snapshot({ drillStreak: 1 }),
      makePush({ lww: { drillStreak: 4, clientUpdatedAt: ts } }),
      NOW,
      iso(ts),
    );
    assert.equal(r.snapshot.drillStreak, 4);
  });
});

describe('签到型（CHECKIN）', () => {
  test('last / days 均取 max：陈旧设备重复签到不会 +1', () => {
    const today = NOW;
    const yesterday = NOW - 86_400_000;
    const r = mergeCheckin(
      { lastDailyCheckin: today, consecutiveLoginDays: 5 },
      { lastDailyCheckin: yesterday, consecutiveLoginDays: 4 },
      NOW,
    );
    assert.equal(r.lastDailyCheckin, today);
    assert.equal(r.consecutiveLoginDays, 5, '取 max 具备幂等性，不会变成 6');
  });

  test('未提交时原样返回云端值', () => {
    const r = mergeCheckin({ lastDailyCheckin: 123, consecutiveLoginDays: 2 }, null, NOW);
    assert.deepEqual(r, { lastDailyCheckin: 123, consecutiveLoginDays: 2 });
  });

  test('未来时间戳收敛到 now（防改系统时间）', () => {
    const future = NOW + 10 * 86_400_000;
    const r = mergeCheckin(
      { lastDailyCheckin: 0, consecutiveLoginDays: 0 },
      { lastDailyCheckin: future, consecutiveLoginDays: 30 },
      NOW,
    );
    assert.equal(r.lastDailyCheckin, NOW);
  });

  test('last 为 0 时 days 强制归零', () => {
    const r = mergeCheckin(
      { lastDailyCheckin: 0, consecutiveLoginDays: 0 },
      { lastDailyCheckin: 0, consecutiveLoginDays: 9 },
      NOW,
    );
    assert.equal(r.consecutiveLoginDays, 0);
  });
});

describe('分项正确数（perCategory）', () => {
  test('逐 key 累加，正确数不超过已答数', () => {
    const out = mergePerCategory(
      { preflop: { answered: 10, correct: 8 } },
      { preflop: { answered: 3, correct: 2 }, flop: { answered: 1, correct: 5 } },
    );
    assert.deepEqual(out.preflop, { answered: 13, correct: 10 });
    assert.deepEqual(out.flop, { answered: 1, correct: 1 }, 'correct 被 clamp 到 answered');
  });

  test('超长 key / 非法 key 被丢弃', () => {
    const out = mergePerCategory({}, { ['x'.repeat(41)]: { answered: 1 } });
    assert.deepEqual(out, {});
  });
});

describe('防御性 clamp', () => {
  test('hands_won 不会超过 hands_played', () => {
    const merged = mergeProgress(
      makeRow({ hands_played: 5, hands_won: 3 }),
      makePush({ delta: { handsWon: 10 } }),
      NOW,
    );
    assert.equal(merged.hands_won, 5);
  });

  test('drill_correct 不会超过 drill_answered', () => {
    const merged = mergeProgress(
      makeRow({ drill_answered: 4, drill_correct: 0 }),
      makePush({ delta: { drillCorrect: 10 } }),
      NOW,
    );
    assert.equal(merged.drill_correct, 4);
  });

  test('sanitizeSnapshot 把脏数据洗成合法快照', () => {
    const s = sanitizeSnapshot({
      xp: 'oops', points: -5, handsPlayed: 10, handsWon: 99,
      drillAnswered: 3, drillCorrect: 99, drillPerCategory: { a: { answered: 'x', correct: 2 } },
    });
    assert.equal(s.xp, 0);
    assert.equal(s.points, 0);
    assert.equal(s.handsWon, 10);
    assert.equal(s.drillCorrect, 3);
    assert.deepEqual(s.drillPerCategory, { a: { answered: 0, correct: 0 } });
  });
});

describe('行 ↔ 快照 互转', () => {
  test('rowToSnapshot → snapshotToRow 往返无损', () => {
    const row = makeRow({
      xp: 321, points: 12345, hands_played: 9, hands_won: 4, total_profit: -500,
      excellent_actions: 7, mistakes: 2, drill_answered: 20, drill_correct: 15,
      biggest_pot: 8888, drill_best_streak: 6, drill_streak: 3,
      last_daily_checkin: NOW, consecutive_login_days: 4,
      drill_per_category: { preflop: { answered: 5, correct: 4 } },
    });
    const back = snapshotToRow(rowToSnapshot(row));
    assert.equal(back.xp, row.xp);
    assert.equal(back.points, row.points);
    assert.equal(back.total_profit, -500);
    assert.equal(back.biggest_pot, 8888);
    assert.deepEqual(back.drill_per_category, { preflop: { answered: 5, correct: 4 } });
  });
});

/* ============================================================
 * ⚠️ 最关键的一条：409 冲突后「只换基准、留增量」（ARCH §6.4）
 * ============================================================ */
describe('409 冲突：换基准、留增量（禁止重算 delta）', () => {
  test('A +10 先落库，B +5 后重试 → 云端最终 = 初始 + 15（不是 +5）', () => {
    const initial = 10000;
    const cloud0 = makeRow({ points: initial, revision: 5 });

    // ① A 基于 rev5 提交 +10 → 云端 10010 / rev6
    const afterA = mergeProgress(cloud0, makePush({ baseRevision: 5, delta: { points: 10 } }), NOW);
    assert.equal(afterA.points, initial + 10);
    assert.equal(afterA.revision, 6);

    // ② B 也基于 rev5 提交 +5 → 服务端 revision 不匹配，返回 409 + 云端最新快照
    //    客户端正确姿势：base := 云端最新快照(10010)，**delta 原样保留 +5**
    const snapshotAfterA = rowToSnapshot(afterA);
    const mergedLocal = mergeSnapshot(
      snapshotAfterA,
      makePush({ baseRevision: 6, delta: { points: 5 } }),   // ← 同一个 +5，绝不重算
      NOW,
      afterA.client_updated_at,
    ).snapshot;
    assert.equal(mergedLocal.points, initial + 15, '本地镜像 = 云端最新 + 我的增量');

    // ③ B 用新基准重发 → 服务端在 10010 上再 +5 → 10015
    const afterB = mergeProgress(
      { ...cloud0, ...snapshotToRow(snapshotAfterA), revision: 6 },
      makePush({ baseRevision: 6, delta: { points: 5 } }),
      NOW,
    );
    assert.equal(afterB.points, initial + 15, 'A 与 B 的增量都必须保留');
    assert.equal(afterB.revision, 7);
  });

  test('反例：若 409 后重算 delta（错误姿势），A 的增量会被吞掉', () => {
    const initial = 10000;
    const afterA = rowToSnapshot(
      mergeProgress(makeRow({ points: initial }), makePush({ delta: { points: 10 } }), NOW),
    );
    // 错误姿势：base 换成云端 10010，local 是 10005 → 重算出 delta = -5
    const recomputedDelta = (initial + 5) - afterA.points;      // = -5
    assert.equal(recomputedDelta, -5);
    const wrong = mergeProgress(
      { ...makeRow(), ...snapshotToRow(afterA), revision: 6 },
      makePush({ delta: { points: recomputedDelta } }),
      NOW,
    );
    assert.equal(wrong.points, initial + 5, '❌ 错误姿势会把 A 的 +10 抹成 +5');
  });

  test('连续三次并发提交，增量全部累加', () => {
    let row = makeRow({ xp: 0, revision: 0 });
    for (const d of [10, 5, 7]) {
      const base = rowToSnapshot(row);
      // 每个设备都基于自己看到的旧基准提交（模拟 409 后重试成功）
      row = mergeProgress(
        { ...row, ...snapshotToRow(base) },
        makePush({ baseRevision: row.revision, delta: { xp: d } }),
        NOW,
      );
    }
    assert.equal(row.xp, 22);
    assert.equal(row.revision, 3);
  });
});

/* ============================================================
 * 迁移三策略（ARCH §6.5 / §12-Q2）
 * ============================================================ */
describe('迁移三策略', () => {
  const localSnapshot = snapshot({
    xp: 120,
    points: 12000,
    handsPlayed: 30,
    handsWon: 12,
    drillAnswered: 20,
    drillCorrect: 16,
    biggestPot: 999,
    drillBestStreak: 5,
    drillStreak: 2,
    lastDailyCheckin: NOW,
    consecutiveLoginDays: 3,
    drillPerCategory: { preflop: { answered: 20, correct: 16 } },
  });
  const profile = { nickname: '本机昵称', avatar: '/avatars/7.png' };

  test('merge：delta = 本机 − ZERO_BASELINE，累加到云端；云端昵称是默认值才采纳本机', () => {
    const cloud = makeRow({ points: 10000 });
    const plan = computeMigrate(
      cloud,
      { nickname: '新玩家', avatar: '/avatars/1.png' },   // 云端仍是默认值
      { strategy: 'merge', snapshot: localSnapshot, profile, clientUpdatedAt: NOW },
      NOW,
    );
    const s = rowToSnapshot(plan.row);
    assert.equal(s.xp, 120);                       // 0 + (120 − 0)
    assert.equal(s.points, 12000);                 // 10000 + (12000 − 10000)
    assert.equal(s.drillAnswered, 20);
    assert.equal(s.biggestPot, 999);
    assert.equal(s.drillPerCategory.preflop.answered, 20);
    assert.equal(plan.row.revision, cloud.revision + 1);
    assert.equal(plan.skipWrite, false);
    // 云端 users.nickname 仍是默认值 '新玩家' → 采纳本机昵称（由调用方写入）
    assert.equal(plan.nickname, '本机昵称');
    assert.equal(plan.avatar, '/avatars/7.png');
  });

  test('merge：云端已有自定义昵称时保留云端（不被本机覆盖）', () => {
    const plan = computeMigrate(
      makeRow(),
      { nickname: '云端昵称', avatar: '/avatars/3.png' },   // 云端已改过
      { strategy: 'merge', snapshot: localSnapshot, profile, clientUpdatedAt: NOW },
      NOW,
    );
    assert.equal(plan.nickname, '云端昵称');
    assert.equal(plan.avatar, '/avatars/3.png');
  });

  test('overwrite：云端整行被本机快照覆盖，revision 仍 +1', () => {
    const cloud = makeRow({ points: 30000, xp: 9999, drill_answered: 100 });
    const plan = computeMigrate(
      cloud,
      { nickname: '云端昵称', avatar: '/avatars/3.png' },
      { strategy: 'overwrite', snapshot: localSnapshot, profile, clientUpdatedAt: NOW },
      NOW,
    );
    const s = rowToSnapshot(plan.row);
    assert.equal(s.xp, 120);
    assert.equal(s.points, 12000);              // 不是 10000+12000，而是直接覆盖
    assert.equal(s.drillAnswered, 20);
    assert.equal(plan.row.revision, cloud.revision + 1);
    assert.equal(plan.nickname, '本机昵称');
  });

  test('keep_cloud：一行不改，原样返回', () => {
    const cloud = makeRow({ points: 30000, xp: 9999 });
    const plan = computeMigrate(
      cloud,
      { nickname: '云端昵称', avatar: '/avatars/3.png' },
      { strategy: 'keep_cloud', snapshot: localSnapshot, profile, clientUpdatedAt: NOW },
      NOW,
    );
    assert.equal(plan.skipWrite, true);
    assert.equal(plan.row.points, 30000);
    assert.equal(plan.row.xp, 9999);
    assert.equal(plan.row.revision, cloud.revision, 'revision 也不推进');
  });
});
