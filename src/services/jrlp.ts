/**
 * 今日老婆（jrlp）业务逻辑服务 —— 抽取、预设、查询、修改、删除。
 */

import type { WifeRecord, Prisma } from '#prisma/main'

import type { MainPrismaClient } from '@/core/db.js'
import { isPrismaKnownError } from '@/core/db.js'
import { Startup } from '@/core/lifecycle/index.js'

export type { WifeRecord }

// ── 返回值类型 ──

/** 抽取结果。 */
export interface DrawResult {
  record: WifeRecord
  /** true 表示本次为首次抽取（含预设触发）。 */
  isNew: boolean
  /** 老婆显示名称。 */
  wifeDisplayName: string
}

/** 列表查询参数。 */
export interface ListRecordsParams {
  groupId?: bigint | number
  userId?: bigint | number
  recordDate?: Date
  page?: number
  pageSize?: number
}

/**
 * 今日老婆服务 —— 封装抽取、预设、查询、修改、删除逻辑。
 *
 * 通过 Startup 生命周期注册，由 LifecycleOrchestrator 管理。
 */
export class JrlpService {
  constructor(private readonly db: MainPrismaClient) {}

  // ════════════════════════════════════════════
  //  核心抽取
  // ════════════════════════════════════════════

  /**
   * 查询或抽取今日老婆。
   *
   * @throws Error 群内无可抽取活跃成员时抛出
   */
  async getOrDraw(params: {
    groupId: bigint | number
    userId: bigint | number
    today: Date
  }): Promise<DrawResult> {
    const groupId = BigInt(params.groupId)
    const userId = BigInt(params.userId)
    const today = params.today
    // 1. 查是否已有记录
    const existing = await this._findRecord(groupId, userId, today)

    if (existing !== null) {
      if (existing.drawnAt !== null) {
        // 已抽取 → 直接返回
        const wifeUser = await this.db.user.findUnique({
          where: { qq: existing.wifeQq },
        })
        const name = wifeUser?.nickname ?? String(existing.wifeQq)
        return { record: existing, isNew: false, wifeDisplayName: name }
      }

      // 预设但未触发 → 标记 drawnAt
      const updated = await this.db.wifeRecord.update({
        where: { id: existing.id },
        data: { drawnAt: new Date() },
      })
      const wifeUser = await this.db.user.findUnique({
        where: { qq: existing.wifeQq },
      })
      const name = wifeUser?.nickname ?? String(existing.wifeQq)
      return { record: updated, isNew: true, wifeDisplayName: name }
    }

    // 2. 无记录 → 随机抽取活跃群成员
    const members = await this.db.groupMembership.findMany({
      where: { groupId, isActive: true },
      include: { user: true },
    })

    if (members.length === 0) {
      throw new Error('该群暂无可抽取的活跃成员')
    }

    const memberIdx = Math.floor(Math.random() * members.length)
    const member = members[memberIdx]
    if (member === undefined) {
      throw new Error('该群暂无可抽取的活跃成员')
    }
    const wifeDisplayName =
      (member.card.trim() !== '' ? member.card.trim() : null) ??
      (member.user.nickname.trim() !== '' ? member.user.nickname.trim() : null) ??
      String(member.userId)

    // 3. 写入记录（唯一约束冲突时重查）
    try {
      const record = await this.db.wifeRecord.create({
        data: {
          groupId,
          userId,
          wifeQq: member.userId,
          date: today,
          drawnAt: new Date(),
        },
      })
      return { record, isNew: true, wifeDisplayName }
    } catch (err) {
      if (isPrismaKnownError(err) && err.code === 'P2002') {
        // 并发冲突：重查
        const refound = await this._findRecord(groupId, userId, today)
        if (refound === null) {
          throw new Error('并发写入后仍未找到记录，请重试', { cause: err })
        }
        const wifeUser = await this.db.user.findUnique({
          where: { qq: refound.wifeQq },
        })
        const name = wifeUser?.nickname ?? String(refound.wifeQq)
        return { record: refound, isNew: false, wifeDisplayName: name }
      }
      throw err
    }
  }

  // ════════════════════════════════════════════
  //  管理接口
  // ════════════════════════════════════════════

  /**
   * 分页查询抽取/预设记录。返回 [items, total] 元组。
   */
  async listRecords(params: ListRecordsParams = {}): Promise<[WifeRecord[], number]> {
    const { groupId, userId, recordDate, page = 1, pageSize = 20 } = params

    const where: Prisma.WifeRecordWhereInput = {
      ...(groupId != null ? { groupId: BigInt(groupId) } : {}),
      ...(userId != null ? { userId: BigInt(userId) } : {}),
      ...(recordDate != null ? { date: recordDate } : {}),
    }

    const [items, total] = await Promise.all([
      this.db.wifeRecord.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.wifeRecord.count({ where }),
    ])

    return [items, total]
  }

  /**
   * 管理员预设今日老婆（drawnAt=null）。
   *
   * @throws Error 该用户今日已有记录时抛出
   */
  async createPreset(params: {
    groupId: bigint | number
    userId: bigint | number
    wifeQq: bigint | number
    recordDate: Date
  }): Promise<WifeRecord> {
    const groupId = BigInt(params.groupId)
    const userId = BigInt(params.userId)
    const wifeQq = BigInt(params.wifeQq)
    const recordDate = params.recordDate

    const existing = await this._findRecord(groupId, userId, recordDate)
    if (existing !== null) {
      throw new Error(
        `用户 ${String(userId)} 在群 ${String(groupId)} 于 ${recordDate.toISOString().slice(0, 10)} 已有记录`,
      )
    }

    return this.db.wifeRecord.create({
      data: {
        groupId,
        userId,
        wifeQq,
        date: recordDate,
        drawnAt: null,
      },
    })
  }

  /**
   * 修改记录的老婆（预设和已抽取均可修改）。
   */
  async updateRecord(
    recordId: number,
    opts: { wifeQq: bigint | number },
  ): Promise<WifeRecord | null> {
    const existing = await this.db.wifeRecord.findUnique({
      where: { id: recordId },
    })
    if (existing === null) return null

    return this.db.wifeRecord.update({
      where: { id: recordId },
      data: { wifeQq: BigInt(opts.wifeQq) },
    })
  }

  /**
   * 删除记录。
   *
   * @returns true 删除成功；false 记录不存在
   */
  async deleteRecord(recordId: number): Promise<boolean> {
    try {
      await this.db.wifeRecord.delete({ where: { id: recordId } })
      return true
    } catch (err) {
      if (isPrismaKnownError(err) && err.code === 'P2025') {
        return false
      }
      throw err
    }
  }

  // ════════════════════════════════════════════
  //  内部辅助
  // ════════════════════════════════════════════

  private async _findRecord(
    groupId: bigint,
    userId: bigint,
    recordDate: Date,
  ): Promise<WifeRecord | null> {
    return this.db.wifeRecord.findFirst({
      where: { groupId, userId, date: recordDate },
    })
  }
}

// ── 生命周期注册 ──

Startup({
  name: 'jrlp',
  provides: ['jrlp_service'],
  requires: ['db'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  return { jrlp_service: new JrlpService(db) }
})
