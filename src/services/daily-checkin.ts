/**
 * 每日打卡服务 —— 在已启用群执行 NapCat 签到。
 *
 * 由 BullMQ 每天零点触发；WS 连接建立时亦可触发。
 * 均通过 Redis 日期键去重，防止重复打卡。
 */

import { logger, type Logger } from '@logger'

import type { CacheClient } from '@/core/cache/client.js'
import { checkinDailyKey } from '@/core/cache/key-registry.js'
import type { MainPrismaClient } from '@/core/db/client.js'
import { Startup } from '@/core/lifecycle/registry.js'
import type { FeaturePermissionService } from '@/core/permission/main.js'
import type { BotAPI } from '@/core/protocol/api.js'
import { SHANGHAI_TZ } from '@/core/utils/helpers.js'
import type { ConnectionManager } from '@/core/ws/connection.js'

// ── 常量 ──

/** 打卡 Redis 键 TTL：25 小时（覆盖时区漂移）。 */
const CHECKIN_TTL = 90_000
/** 群间发送延迟（毫秒），避免 QQ 限流。 */
const SEND_DELAY_MS = 1500
/** 此服务注册到权限系统的功能名。 */
const FEATURE_NAME = 'daily_checkin'

/** 触发来源。 */
export type CheckinSource = 'ws_connect' | 'scheduled'

// ── 返回值类型 ──

/** 每日打卡执行结果。 */
export interface DailyCheckinResult {
  total: number
  sent: number
  skipped: number
  failed: number
}

/**
 * 每日自动打卡协调器。
 *
 * 由 BullMQ 每天零点触发，WS 连接建立时亦可触发，
 * 均通过 Redis 日期键去重防止重复执行。
 * 打卡 API 使用 NapCat send_group_sign，不发送文本消息。
 */
export class DailyCheckinService {
  private _currentTask: Promise<void> | null = null
  private readonly _log: Logger = logger.child({ name: 'DailyCheckinService' })

  constructor(
    private readonly db: MainPrismaClient,
    private readonly cache: CacheClient,
    private readonly botApi: BotAPI,
    private readonly connMgr: ConnectionManager,
    private readonly permissionService: FeaturePermissionService,
  ) {}

  // ════════════════════════════════════════════
  //  公共接口
  // ════════════════════════════════════════════

  /** 是否有打卡任务正在执行。 */
  get isRunning(): boolean {
    return this._currentTask !== null
  }

  /**
   * 请求执行一轮打卡（防并发重入）。
   *
   * @param source - 触发来源
   * @returns true 表示任务已触发，false 表示有任务正在执行（跳过）
   */
  requestCheckin(source: CheckinSource = 'ws_connect'): boolean {
    if (this.isRunning) {
      this._log.debug({ source }, '打卡任务正在执行，跳过')
      return false
    }

    this._currentTask = this._runCheckin(source).finally(() => {
      this._currentTask = null
    })

    return true
  }

  // ════════════════════════════════════════════
  //  内部实现
  // ════════════════════════════════════════════

  private async _runCheckin(source: CheckinSource): Promise<void> {
    if (!this.connMgr.isConnected) {
      this._log.warn({ source }, 'WS 未连接，跳过本轮打卡')
      return
    }

    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: SHANGHAI_TZ }).format(new Date())
    const groupIds = await this._getEligibleGroupIds()

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const groupId of groupIds) {
      // Redis 去重：今日已打卡则跳过
      let alreadyDone: boolean
      try {
        alreadyDone = await this.cache.exists(checkinDailyKey(groupId, today))
      } catch (err) {
        this._log.warn({ groupId, err }, 'Redis 查询失败，跳过该群')
        skipped++
        continue
      }

      if (alreadyDone) {
        skipped++
        continue
      }

      // 权限检查：群级功能开关
      let enabled: boolean
      try {
        enabled = await this.permissionService.isGroupFeatureEnabled(
          groupId,
          FEATURE_NAME,
          FEATURE_NAME,
        )
      } catch (err) {
        this._log.warn({ groupId, err }, '权限查询失败，跳过该群')
        skipped++
        continue
      }

      if (!enabled) {
        skipped++
        continue
      }

      // 执行打卡
      try {
        const resp = await this.botApi.sendGroupSign(Number(groupId))
        if (resp.status !== 'ok') {
          this._log.warn(
            { groupId, retcode: resp.retcode, message: resp.message },
            '群打卡 API 返回失败',
          )
          failed++
        } else {
          await this.cache.set(checkinDailyKey(groupId, today), '1', CHECKIN_TTL)
          sent++
        }
      } catch (err) {
        this._log.warn({ groupId, err }, '群打卡异常')
        failed++
      }

      await new Promise<void>((resolve) => setTimeout(resolve, SEND_DELAY_MS))
    }

    this._log.info({ total: groupIds.length, sent, skipped, failed }, '本轮打卡完成')
  }

  private async _getEligibleGroupIds(): Promise<bigint[]> {
    const rows = await this.db.group.findMany({
      where: { isActive: true, botEnabled: true },
      select: { groupId: true },
    })
    return rows.map((r) => r.groupId)
  }
}

// ── 生命周期注册 ──

Startup({
  name: 'daily_checkin',
  provides: ['daily_checkin_service'],
  requires: ['db', 'cache', 'bot_api', 'conn_mgr', 'permission_service'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  const cache = deps.cache as CacheClient
  const botApi = deps.bot_api as BotAPI
  const connMgr = deps.conn_mgr as ConnectionManager
  const permissionService = deps.permission_service as FeaturePermissionService
  return {
    daily_checkin_service: new DailyCheckinService(db, cache, botApi, connMgr, permissionService),
  }
})
