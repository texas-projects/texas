/**
 * 用户群签到业务逻辑服务 —— 每日签到、连续天数、排行榜、统计。
 */

import './checkin-cache-keys.js'

import { logger, type Logger } from '@logger'

import { Prisma } from '#prisma/main'
import type { CheckinRecord } from '#prisma/main'

import type { MainPrismaClient } from '@/core/db.js'
import { isPrismaKnownError } from '@/core/db.js'
import { Service, Inject, Provide, Startup } from '@/core/lifecycle/decorators/index.js'
import type { RedisStore } from '@/core/redis/index.js'
import { cacheKeyRegistry } from '@/core/registries.js'
import { SHANGHAI_TZ } from '@/core/utils.js'

export type { CheckinRecord }

// ── 缓存 TTL ──

const CACHE_TTL = 2_592_000 // 30 天（秒）

// ── 返回值类型 ──

/** 签到操作结果。 */
export interface CheckinResult {
  isDuplicate: boolean
  /** 今日本群第几个（重复签到时为 0）。 */
  rank: number
  /** 当前连续签到天数。 */
  streak: number
  /** 累计签到天数。 */
  total: number
}

/** 排行榜条目。 */
export interface LeaderEntry {
  userId: bigint
  value: number
}

/** 每日签到人数数据点。 */
export interface DayCount {
  /** YYYY-MM-DD 格式日期。 */
  date: string
  count: number
}

/** 汇总卡片数据。 */
export interface SummaryData {
  totalCheckins: number
  todayCheckins: number
  activeUsers: number
}

/** 列表查询参数。 */
export interface ListRecordsParams {
  groupId?: bigint | number
  userId?: bigint | number
  recordDate?: Date
  page?: number
  pageSize?: number
}

/** 排行榜查询参数。 */
export interface GetLeaderboardParams {
  groupId?: bigint | number
  by?: 'total' | 'streak'
  limit?: number
}

/** 趋势查询参数。 */
export interface GetDailyTrendParams {
  groupId?: bigint | number
  days?: number
}

/** 汇总查询参数。 */
export interface GetSummaryParams {
  groupId?: bigint | number
}

/** 用户签到缓存结构。 */
interface CheckinCache {
  lastDate: string
  streak: number
  total: number
}

/**
 * 用户群签到核心服务。
 *
 * 通过 Startup 生命周期注册，由 LifecycleOrchestrator 管理。
 */
export class CheckinService {
  private readonly _log: Logger = logger.child({ name: 'CheckinService' })

  constructor(
    private readonly db: MainPrismaClient,
    private readonly cache: RedisStore,
  ) {}

  // ════════════════════════════════════════════
  //  核心签到
  // ════════════════════════════════════════════

  /**
   * 执行签到，返回 rank / streak / total / isDuplicate。
   */
  async checkin(params: {
    groupId: bigint | number
    userId: bigint | number
    today: Date
  }): Promise<CheckinResult> {
    const groupId = BigInt(params.groupId)
    const userId = BigInt(params.userId)
    const today = params.today
    const todayStr = this._dateToIso(today)
    const key = cacheKeyRegistry.buildKey('checkin', 'stats', String(groupId), String(userId))

    // 1. 读缓存
    const cached =
      (await this.cache.get<CheckinCache>(key)) ?? (await this._rebuildCache(groupId, userId))

    const lastDate = cached.lastDate
    const streak = cached.streak
    const total = cached.total

    // 2. 重复签到检测
    if (lastDate === todayStr) {
      return { isDuplicate: true, rank: 0, streak, total }
    }

    // 3. 计算新 streak / total
    const yesterdayStr = this._dateToIso(new Date(today.getTime() - 86400_000))
    const newStreak = lastDate === yesterdayStr ? streak + 1 : 1
    const newTotal = total + 1

    // 4. 写入 DB（利用 unique 约束检测并发冲突）
    let rank = 0
    try {
      await this.db.$transaction(async (tx) => {
        await tx.checkinRecord.create({
          data: {
            groupId,
            userId,
            checkinDate: today,
            checkinAt: new Date(),
          },
        })
        // 5. 查今日排名（含本次插入）
        rank = await tx.checkinRecord.count({
          where: { groupId, checkinDate: today },
        })
      })
    } catch (err) {
      if (isPrismaKnownError(err) && err.code === 'P2002') {
        // 并发冲突：视为重复签到
        this._log.warn({ groupId, userId }, '签到并发冲突，视为重复')
        return { isDuplicate: true, rank: 0, streak, total }
      }
      throw err
    }

    // 6. 更新缓存
    const newCache: CheckinCache = {
      lastDate: todayStr,
      streak: newStreak,
      total: newTotal,
    }
    await this.cache.set(key, newCache, CACHE_TTL)

    return {
      isDuplicate: false,
      rank,
      streak: newStreak,
      total: newTotal,
    }
  }

  /**
   * 从 DB 重建用户在某群的签到缓存。
   */
  async rebuildCache(groupId: bigint | number, userId: bigint | number): Promise<CheckinCache> {
    return this._rebuildCache(BigInt(groupId), BigInt(userId))
  }

  // ════════════════════════════════════════════
  //  管理 / 统计接口
  // ════════════════════════════════════════════

  /**
   * 分页查询签到记录。返回 [items, total] 元组。
   */
  async listRecords(params: ListRecordsParams = {}): Promise<[CheckinRecord[], number]> {
    const { groupId, userId, recordDate, page = 1, pageSize = 20 } = params

    const where: Prisma.CheckinRecordWhereInput = {
      ...(groupId != null ? { groupId: BigInt(groupId) } : {}),
      ...(userId != null ? { userId: BigInt(userId) } : {}),
      ...(recordDate != null ? { checkinDate: recordDate } : {}),
    }

    const [items, total] = await Promise.all([
      this.db.checkinRecord.findMany({
        where,
        orderBy: { checkinAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.checkinRecord.count({ where }),
    ])

    return [items, total]
  }

  /**
   * 查询排行榜。
   */
  async getLeaderboard(params: GetLeaderboardParams): Promise<LeaderEntry[]> {
    const { groupId, by = 'total', limit = 20 } = params
    const effectiveLimit = Math.min(limit, 50)
    const gid = groupId != null ? BigInt(groupId) : undefined

    if (by === 'total') {
      const where: Prisma.CheckinRecordWhereInput = gid != null ? { groupId: gid } : {}
      const rows = await this.db.checkinRecord.groupBy({
        by: ['userId'],
        where,
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
        take: effectiveLimit,
      })
      return rows.map((r) => ({ userId: r.userId, value: r._count.userId }))
    }

    // by === 'streak'：使用原生 SQL 计算当前连续天数
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
    const sql =
      gid != null
        ? Prisma.sql`
            WITH distinct_dates AS (
              SELECT DISTINCT user_id, checkin_date
              FROM checkin WHERE group_id = ${gid}
            ),
            gaps AS (
              SELECT user_id, checkin_date,
                     CASE WHEN LAG(checkin_date)
                                   OVER (PARTITION BY user_id ORDER BY checkin_date)
                               = checkin_date - INTERVAL '1 day'
                          THEN 0 ELSE 1 END AS new_streak
              FROM distinct_dates
            ),
            streak_groups AS (
              SELECT user_id, checkin_date,
                     SUM(new_streak)
                         OVER (PARTITION BY user_id ORDER BY checkin_date) AS grp
              FROM gaps
            ),
            streak_lengths AS (
              SELECT user_id, grp, COUNT(*) AS len, MAX(checkin_date) AS last_day
              FROM streak_groups GROUP BY user_id, grp
            ),
            current_streaks AS (
              SELECT DISTINCT ON (user_id) user_id, len AS streak
              FROM streak_lengths ORDER BY user_id, last_day DESC
            )
            SELECT user_id, streak FROM current_streaks ORDER BY streak DESC LIMIT ${effectiveLimit}
          `
        : Prisma.sql`
            WITH distinct_dates AS (
              SELECT DISTINCT user_id, checkin_date FROM checkin
            ),
            gaps AS (
              SELECT user_id, checkin_date,
                     CASE WHEN LAG(checkin_date)
                                   OVER (PARTITION BY user_id ORDER BY checkin_date)
                               = checkin_date - INTERVAL '1 day'
                          THEN 0 ELSE 1 END AS new_streak
              FROM distinct_dates
            ),
            streak_groups AS (
              SELECT user_id, checkin_date,
                     SUM(new_streak)
                         OVER (PARTITION BY user_id ORDER BY checkin_date) AS grp
              FROM gaps
            ),
            streak_lengths AS (
              SELECT user_id, grp, COUNT(*) AS len, MAX(checkin_date) AS last_day
              FROM streak_groups GROUP BY user_id, grp
            ),
            current_streaks AS (
              SELECT DISTINCT ON (user_id) user_id, len AS streak
              FROM streak_lengths ORDER BY user_id, last_day DESC
            )
            SELECT user_id, streak FROM current_streaks ORDER BY streak DESC LIMIT ${effectiveLimit}
          `
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */

    interface RawRow {
      user_id: bigint
      streak: bigint
    }
    const rows = await this.db.$queryRaw<RawRow[]>(sql)
    return rows.map((r) => ({ userId: r.user_id, value: Number(r.streak) }))
  }

  /**
   * 查询最近 N 天每日签到人数。
   */
  async getDailyTrend(params: GetDailyTrendParams): Promise<DayCount[]> {
    const { groupId, days = 30 } = params
    const effectiveDays = Math.min(days, 90)
    const gid = groupId != null ? BigInt(groupId) : undefined

    const cutoff = new Date(
      new Intl.DateTimeFormat('sv-SE', { timeZone: SHANGHAI_TZ }).format(
        new Date(Date.now() - effectiveDays * 86400_000),
      ),
    )

    const where: Prisma.CheckinRecordWhereInput = {
      checkinDate: { gte: cutoff },
      ...(gid != null ? { groupId: gid } : {}),
    }

    const rows = await this.db.checkinRecord.groupBy({
      by: ['checkinDate'],
      where,
      _count: { id: true },
      orderBy: { checkinDate: 'asc' },
    })

    return rows.map((r) => ({
      date: this._dateToIso(r.checkinDate),
      count: r._count.id,
    }))
  }

  /**
   * 查询汇总卡片数据。
   */
  async getSummary(params: GetSummaryParams): Promise<SummaryData> {
    const { groupId } = params
    const gid = groupId != null ? BigInt(groupId) : undefined

    const now = new Date()
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: SHANGHAI_TZ }).format(now)
    const today = new Date(todayStr)
    const cutoff = new Date(today.getTime() - 30 * 86400_000)

    const where: Prisma.CheckinRecordWhereInput = gid != null ? { groupId: gid } : {}

    const [totalCheckins, todayCheckins, activeUsers] = await Promise.all([
      this.db.checkinRecord.count({ where }),
      this.db.checkinRecord.count({
        where: { ...where, checkinDate: today },
      }),
      this.db.checkinRecord
        .groupBy({
          by: ['userId'],
          where: { ...where, checkinDate: { gte: cutoff } },
        })
        .then((rows) => rows.length),
    ])

    return { totalCheckins, todayCheckins, activeUsers }
  }

  // ════════════════════════════════════════════
  //  内部辅助
  // ════════════════════════════════════════════

  private async _rebuildCache(groupId: bigint, userId: bigint): Promise<CheckinCache> {
    const total = await this.db.checkinRecord.count({
      where: { groupId, userId },
    })

    if (total === 0) {
      const empty: CheckinCache = { lastDate: '', streak: 0, total: 0 }
      await this.cache.set(
        cacheKeyRegistry.buildKey('checkin', 'stats', String(groupId), String(userId)),
        empty,
        CACHE_TTL,
      )
      return empty
    }

    // 查询降序日期列表，early-exit 计算连续天数
    const records = await this.db.checkinRecord.findMany({
      where: { groupId, userId },
      orderBy: { checkinDate: 'desc' },
      select: { checkinDate: true },
    })

    // mostRecentDate: 最近签到日期（用于缓存）
    // prevDate: 迭代中的上一个日期（用于连续判断）
    let mostRecentDate: Date | undefined
    let prevDate: Date | undefined
    let streak = 0

    for (const r of records) {
      const d = r.checkinDate
      if (prevDate === undefined) {
        mostRecentDate = d
        prevDate = d
        streak = 1
      } else {
        const diffDays = Math.round((prevDate.getTime() - d.getTime()) / 86400_000)
        if (diffDays === 1) {
          streak += 1
          prevDate = d
        } else {
          break
        }
      }
    }

    const cacheData: CheckinCache = {
      lastDate: mostRecentDate !== undefined ? this._dateToIso(mostRecentDate) : '',
      streak,
      total,
    }

    await this.cache.set(
      cacheKeyRegistry.buildKey('checkin', 'stats', String(groupId), String(userId)),
      cacheData,
      CACHE_TTL,
    )
    return cacheData
  }

  private _dateToIso(d: Date): string {
    return d.toISOString().slice(0, 10)
  }
}

// ── 生命周期注册 ──

@Service({ name: 'checkin_service_bootstrap' })
export class CheckinServiceBootstrap {
  /** 注入主数据库 */
  @Inject('db')
  db!: MainPrismaClient

  /** 注入缓存存储 */
  @Inject('cache')
  cache!: RedisStore

  /** 对外暴露签到服务实例 */
  @Provide('user_checkin_service')
  checkinService!: CheckinService

  @Startup
  start(): void {
    this.checkinService = new CheckinService(this.db, this.cache)
  }
}
