/**
 * 漂流瓶业务逻辑服务 —— 扔/捞漂流瓶、漂流瓶池管理。
 */

import type { DriftBottleItem, DriftBottlePool, DriftBottleGroupPool } from '#prisma/main'
import { Prisma } from '#prisma/main'

import type { MainPrismaClient } from '@/core/db.js'
import { isPrismaKnownError } from '@/core/db.js'
import { Service, Inject, Provide, Startup } from '@/core/lifecycle/decorators/index.js'

export type { DriftBottleItem, DriftBottlePool, DriftBottleGroupPool }

// ── 常量 ──

/** 默认漂流瓶池 ID（pool_id=0 为系统默认池）。 */
const DRIFT_BOTTLE_DEFAULT_POOL_ID = 0

// ── 返回值类型 ──

/** 捞到的漂流瓶数据。 */
export interface BottleItem {
  id: number
  senderId: bigint
  senderGroupId: bigint
  content: unknown
}

/** 漂流瓶池信息（含统计）。 */
export interface PoolInfo {
  id: number
  name: string
  availableCount: number
}

/** 分页结果。 */
export interface PageResult<T> {
  items: T[]
  total: number
}

/** 分页参数。 */
export interface PaginationParams {
  page?: number
  pageSize?: number
}

/**
 * 漂流瓶核心服务 —— 封装扔/捞/池管理逻辑。
 *
 * 通过 Startup 生命周期注册，由 LifecycleOrchestrator 管理。
 */
export class DriftBottleService {
  constructor(private readonly db: MainPrismaClient) {}

  // ════════════════════════════════════════════
  //  工具方法
  // ════════════════════════════════════════════

  /**
   * 查询群所属池 id，无记录返回默认池 id。
   */
  async getPoolId(groupId: bigint | number): Promise<number> {
    const gid = BigInt(groupId)
    const row = await this.db.driftBottleGroupPool.findUnique({
      where: { groupId: gid },
    })
    return row?.poolId ?? DRIFT_BOTTLE_DEFAULT_POOL_ID
  }

  // ════════════════════════════════════════════
  //  Bot 核心功能
  // ════════════════════════════════════════════

  /**
   * 投入一个漂流瓶。
   */
  async throwBottle(params: {
    poolId: number
    senderId: bigint | number
    senderGroupId: bigint | number
    content: unknown
  }): Promise<DriftBottleItem> {
    const { poolId, content } = params
    const senderId = BigInt(params.senderId)
    const senderGroupId = BigInt(params.senderGroupId)
    return this.db.driftBottleItem.create({
      data: {
        poolId,
        senderId,
        senderGroupId,
        content: content as Prisma.InputJsonValue,
      },
    })
  }

  /**
   * 原子性捞取一个漂流瓶；池内无可用瓶返回 null。
   *
   * 使用 $queryRaw 的 UPDATE ... RETURNING 实现原子捞取，防止并发重捞。
   */
  async pickBottle(params: {
    poolId: number
    userId: bigint | number
  }): Promise<BottleItem | null> {
    const poolId = params.poolId
    const userId = BigInt(params.userId)
    interface RawRow {
      id: number
      sender_id: bigint
      sender_group_id: bigint
      content: unknown
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const rows = await this.db.$queryRaw<RawRow[]>(Prisma.sql`
      UPDATE drift_bottle_items
      SET is_picked = TRUE,
          picked_by = ${userId},
          picked_at = NOW()
      WHERE id = (
        SELECT id FROM drift_bottle_items
        WHERE pool_id = ${poolId}
          AND is_picked = FALSE
          AND sender_id != ${userId}
        ORDER BY RANDOM()
        LIMIT 1
      )
      AND is_picked = FALSE
      RETURNING id, sender_id, sender_group_id, content
    `)

    const row = rows[0]
    if (row === undefined) return null

    return {
      id: row.id,
      senderId: row.sender_id,
      senderGroupId: row.sender_group_id,
      content: row.content,
    }
  }

  // ════════════════════════════════════════════
  //  后台池管理
  // ════════════════════════════════════════════

  /**
   * 列出所有池，含各池未捞取瓶数统计。
   */
  async listPools(): Promise<PoolInfo[]> {
    interface RawRow {
      id: number
      name: string
      available_count: bigint
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const rows = await this.db.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT
        p.id,
        p.name,
        COUNT(i.id) AS available_count
      FROM drift_bottle_pools p
      LEFT JOIN drift_bottle_items i
        ON i.pool_id = p.id AND i.is_picked = FALSE
      GROUP BY p.id, p.name
      ORDER BY p.id
    `)

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      availableCount: Number(r.available_count),
    }))
  }

  /**
   * 创建新漂流瓶池。
   *
   * @throws Error 名称重复时抛出
   */
  async createPool(name: string): Promise<DriftBottlePool> {
    // 计算下一个可用 id（max+1，至少为 1，0 是默认池预留）
    const maxRow = await this.db.driftBottlePool.aggregate({ _max: { id: true } })
    const nextId = Math.max((maxRow._max.id ?? 0) + 1, 1)

    try {
      return await this.db.driftBottlePool.create({ data: { id: nextId, name } })
    } catch (err) {
      if (isPrismaKnownError(err) && err.code === 'P2002') {
        throw new Error(`漂流瓶池名称已存在：${name}`, { cause: err })
      }
      throw err
    }
  }

  /**
   * 删除漂流瓶池。
   *
   * @throws Error 尝试删除默认池或池不存在时抛出
   * @throws Error 池下仍有群归属时抛出
   */
  async deletePool(poolId: number): Promise<void> {
    if (poolId === DRIFT_BOTTLE_DEFAULT_POOL_ID) {
      throw new Error('默认漂流瓶池不可删除')
    }

    const pool = await this.db.driftBottlePool.findUnique({
      where: { id: poolId },
    })
    if (pool === null) {
      throw new Error(`漂流瓶池不存在：${String(poolId)}`)
    }

    try {
      await this.db.driftBottlePool.delete({ where: { id: poolId } })
    } catch (err) {
      if (isPrismaKnownError(err) && err.code === 'P2003') {
        throw new Error('该池下仍有群归属，无法删除', { cause: err })
      }
      throw err
    }
  }

  /**
   * 列出某池下所有群号。
   */
  async listPoolGroups(poolId: number): Promise<bigint[]> {
    const rows = await this.db.driftBottleGroupPool.findMany({
      where: { poolId },
      select: { groupId: true },
    })
    return rows.map((r) => r.groupId)
  }

  /**
   * 将群分配到指定池（poolId=0 表示移回默认池，即删除映射记录）。
   *
   * @throws Error pool_id 不存在（非 0）时抛出
   */
  async assignGroupPool(params: { groupId: bigint | number; poolId: number }): Promise<void> {
    const { poolId } = params
    const groupId = BigInt(params.groupId)
    if (poolId !== DRIFT_BOTTLE_DEFAULT_POOL_ID) {
      const pool = await this.db.driftBottlePool.findUnique({
        where: { id: poolId },
      })
      if (pool === null) {
        throw new Error(`漂流瓶池不存在：${String(poolId)}`)
      }
    }

    const existing = await this.db.driftBottleGroupPool.findUnique({
      where: { groupId },
    })

    if (poolId === DRIFT_BOTTLE_DEFAULT_POOL_ID) {
      // 移回默认池 = 删除映射记录
      if (existing !== null) {
        await this.db.driftBottleGroupPool.delete({ where: { groupId } })
      }
    } else {
      if (existing === null) {
        await this.db.driftBottleGroupPool.create({
          data: { groupId, poolId },
        })
      } else {
        await this.db.driftBottleGroupPool.update({
          where: { groupId },
          data: { poolId },
        })
      }
    }
  }

  /**
   * 分页查询漂流瓶列表。
   */
  async listBottles(
    params: PaginationParams & { poolId?: number; isPicked?: boolean } = {},
  ): Promise<PageResult<DriftBottleItem>> {
    const { page = 1, pageSize = 20, poolId, isPicked } = params

    const where: Prisma.DriftBottleItemWhereInput = {
      ...(poolId != null ? { poolId } : {}),
      ...(isPicked != null ? { isPicked } : {}),
    }

    const [items, total] = await Promise.all([
      this.db.driftBottleItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.driftBottleItem.count({ where }),
    ])

    return { items, total }
  }
}

// ── 生命周期注册 ──

@Service({ name: 'drift_bottle_bootstrap' })
export class DriftBottleBootstrap {
  /** 注入主数据库 */
  @Inject('db')
  db!: MainPrismaClient

  /** 对外暴露漂流瓶服务实例 */
  @Provide('drift_bottle_service')
  driftBottleService!: DriftBottleService

  @Startup
  start(): void {
    this.driftBottleService = new DriftBottleService(this.db)
  }
}
