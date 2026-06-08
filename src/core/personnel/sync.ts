/**
 * 用户数据全量同步编排 —— 主进程采集 + 写入 + 定时调度。
 *
 * 通过 SyncCoordinator 集中管理同步任务的生命周期，
 * 所有触发入口（WS 连接、API 手动触发、内置定时调度）统一调用 requestSync()。
 */

import type { PersonnelService } from './main.js'

import type { BotAPI } from '@/core/protocol/api.js'

/** 同步触发来源。 */
export type SyncSource = 'ws_connect' | 'manual' | 'scheduled'

/** 同步协调器配置。 */
export interface SyncCoordinatorOptions {
  /** 同步间隔（毫秒），默认 300000（5 分钟）。 */
  intervalMs?: number
  /** 初始延迟（毫秒），默认 3000（3 秒）。 */
  initialDelayMs?: number
  /** API 调用间隔（毫秒），默认 500。 */
  apiDelayMs?: number
}

/** 连接状态检查接口。 */
export interface ConnectionStatus {
  readonly connected: boolean
}

/**
 * 用户数据同步协调器 —— 确保同一时刻最多只有一个同步任务运行。
 *
 * 所有同步触发入口（WS 首连、手动 API、内置定时调度）均通过 requestSync()
 * 统一调度，从结构上杜绝重复触发。
 *
 * 防重机制（两层）：
 * 1. 任务去重：_running 为 true 时，新请求直接跳过。
 * 2. 冷却窗口：定时触发（source="scheduled"）在最近一次同步启动后
 *    的 minSyncGap 毫秒内会被静默忽略。
 */
export class SyncCoordinator {
  private _running = false
  private _lastSyncStart = 0
  private readonly _minSyncGap: number
  private _timer?: NodeJS.Timeout
  private readonly _intervalMs: number
  private readonly _initialDelayMs: number
  private readonly _apiDelayMs: number

  constructor(
    private readonly botApi: BotAPI,
    private readonly personnelService: PersonnelService,
    private readonly connStatus: ConnectionStatus,
    opts?: SyncCoordinatorOptions,
  ) {
    this._intervalMs = opts?.intervalMs ?? 300_000
    this._initialDelayMs = opts?.initialDelayMs ?? 3_000
    this._apiDelayMs = opts?.apiDelayMs ?? 500
    this._minSyncGap = Math.max(this._intervalMs / 2, 30_000)
  }

  /** 是否有同步任务正在执行。 */
  get isRunning(): boolean {
    return this._running
  }

  /**
   * 请求一次全量同步。
   *
   * @param source 触发来源
   * @returns 如果成功发起同步则返回 Promise，否则返回 null
   */
  requestSync(source: SyncSource = 'manual'): Promise<void> | null {
    // 层 1：任务去重
    if (this._running) {
      return null
    }

    // 层 2：冷却窗口（仅约束定时触发）
    if (source === 'scheduled') {
      const elapsed = Date.now() - this._lastSyncStart
      if (elapsed < this._minSyncGap) {
        return null
      }
    }

    this._lastSyncStart = Date.now()
    this._running = true
    const task = this._runSync().finally(() => {
      this._running = false
    })
    return task
  }

  /** 启动内置定时调度。 */
  start(intervalMs?: number): void {
    if (this._timer !== undefined) return

    const interval = intervalMs ?? this._intervalMs
    this._timer = setInterval(() => {
      void this.requestSync('scheduled')
    }, interval)
  }

  /** 停止内置定时调度。 */
  stop(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer)
      this._timer = undefined
    }
  }

  /** 执行一次全量同步（采集 + 写入）。 */
  async syncAll(): Promise<void> {
    await this._runSync()
  }

  // ── 内部实现 ──

  private async _runSync(): Promise<void> {
    // 初始延迟
    if (this._initialDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this._initialDelayMs))
    }

    if (!this.connStatus.connected) {
      return
    }

    try {
      // 1. 获取好友列表
      const friendsResp = await this.botApi.getFriendList()
      const friendsData = friendsResp.status === 'ok' ? (friendsResp.data as unknown[]) : null

      // 2. 获取群列表
      const groupsResp = await this.botApi.getGroupList()
      const groupsData = groupsResp.status === 'ok' ? (groupsResp.data as unknown[]) : null

      // 3. 逐群获取成员列表
      const membersData: Record<number, unknown[]> = {}

      if (Array.isArray(groupsData)) {
        for (const group of groupsData) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!this.connStatus.connected) break

          const groupRecord = group as Record<string, unknown>
          const groupId = groupRecord.group_id
          if (typeof groupId !== 'number' && typeof groupId !== 'bigint') continue

          try {
            const memberResp = await this.botApi.getGroupMemberList(Number(groupId))
            if (memberResp.status === 'ok' && Array.isArray(memberResp.data)) {
              membersData[Number(groupId)] = memberResp.data
            }
          } catch {
            // 获取某群成员失败，跳过该群
          }

          if (this._apiDelayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, this._apiDelayMs))
          }
        }
      }

      // 4. 持久化到数据库
      await this.personnelService.persistSyncData(
        Array.isArray(friendsData)
          ? (friendsData as Parameters<PersonnelService['persistSyncData']>[0])
          : null,
        Array.isArray(groupsData)
          ? (groupsData as Parameters<PersonnelService['persistSyncData']>[1])
          : null,
        Object.keys(membersData).length > 0
          ? (membersData as Parameters<PersonnelService['persistSyncData']>[2])
          : null,
      )
    } catch {
      // 同步失败，由调用方负责日志记录
    }
  }
}
