/**
 * 聊天记录业务逻辑 —— 消息持久化、查询、上下文获取。
 */

import { logger, type Logger } from '@logger'

import type { ChatMessage } from '#prisma/chat'

import type { ChatPrismaClient } from '@/core/db/client.js'
import { Shutdown, Startup } from '@/core/lifecycle/registry.js'

export type { ChatMessage }

/** 群消息查询参数。 */
export interface GroupHistoryOptions {
  /** 游标：仅返回此时间之前的消息。 */
  before?: Date
  /** 返回条数上限，默认 50。 */
  limit?: number
  /** 关键词过滤。 */
  keyword?: string
  /** 按 user_id 过滤。 */
  userId?: bigint
  /** 起始时间（含）。 */
  startDate?: Date
  /** 结束时间（含）。 */
  endDate?: Date
}

/** 私聊消息查询参数。 */
export interface PrivateHistoryOptions {
  before?: Date
  limit?: number
}

/** 消息搜索参数。 */
export interface SearchOptions {
  groupId?: bigint
  userId?: bigint
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
}

/** 搜索结果。 */
export interface SearchResult {
  items: ChatMessage[]
  total: number
}

/** 消息上下文结果。 */
export interface MessageContext {
  before: ChatMessage[]
  current: ChatMessage[]
  after: ChatMessage[]
}

/**
 * 聊天记录核心服务 —— 封装消息写入、查询、统计。
 *
 * 通过 Startup / Shutdown 生命周期注册，由 LifecycleOrchestrator 管理。
 */
export class ChatHistoryService {
  private readonly _log: Logger = logger.child({ name: 'ChatHistoryService' })

  constructor(private readonly chatDb: ChatPrismaClient) {}

  // ════════════════════════════════════════════
  //  写入
  // ════════════════════════════════════════════

  /**
   * 将消息事件持久化到聊天记录库。
   *
   * @param data - 已解构的消息字段（避免硬依赖协议层类型）。
   */
  async saveMessage(data: {
    messageId: bigint
    messageType: number
    groupId?: bigint | null
    userId: bigint
    rawMessage: string
    segments: unknown
    senderNickname: string
    senderCard?: string | null
    senderRole?: string | null
    createdAt: Date
  }): Promise<void> {
    try {
      await this.chatDb.chatMessage.create({
        data: {
          messageId: data.messageId,
          messageType: data.messageType,
          groupId: data.groupId ?? null,
          userId: data.userId,
          rawMessage: data.rawMessage,
          segments: data.segments ?? {},
          senderNickname: data.senderNickname,
          senderCard: data.senderCard ?? null,
          senderRole: data.senderRole ?? null,
          createdAt: data.createdAt,
        },
      })
    } catch (err) {
      // 持久化失败不应中断消息处理流程，仅记录错误
      this._log.error({ messageId: data.messageId, err }, '消息持久化失败')
    }
  }

  // ════════════════════════════════════════════
  //  查询
  // ════════════════════════════════════════════

  /**
   * 查询群聊消息（游标分页，支持筛选）。
   */
  async getGroupHistory(groupId: bigint, opts: GroupHistoryOptions = {}): Promise<ChatMessage[]> {
    const { before, limit = 50, keyword, userId, startDate, endDate } = opts

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    return this.chatDb.chatMessage.findMany({
      where: {
        groupId,
        ...(before
          ? { createdAt: { lt: before } }
          : !startDate
            ? { createdAt: { gt: thirtyDaysAgo } }
            : {}),
        ...(keyword ? { rawMessage: { contains: keyword, mode: 'insensitive' as const } } : {}),
        ...(userId != null ? { userId } : {}),
        ...(startDate != null ? { createdAt: { gte: startDate } } : {}),
        ...(endDate != null ? { createdAt: { lte: endDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * 查询私聊消息（游标分页）。
   *
   * messageType=1 对应 PRIVATE。
   */
  async getPrivateHistory(
    userId: bigint,
    opts: PrivateHistoryOptions = {},
  ): Promise<ChatMessage[]> {
    const { before, limit = 50 } = opts
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    return this.chatDb.chatMessage.findMany({
      where: {
        userId,
        messageType: 1,
        createdAt: before != null ? { lt: before } : { gt: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * 获取消息上下文（前后 N 条）。
   */
  async getMessageContext(
    messageId: bigint,
    createdAt: Date,
    contextSize = 5,
  ): Promise<MessageContext> {
    const oneSecond = 1000

    // 找到目标消息
    const targets = await this.chatDb.chatMessage.findMany({
      where: {
        messageId,
        createdAt: {
          gte: new Date(createdAt.getTime() - oneSecond),
          lte: new Date(createdAt.getTime() + oneSecond),
        },
      },
      take: 1,
    })

    const target = targets[0]
    if (!target) {
      return { before: [], current: [], after: [] }
    }

    const sessionFilter =
      target.groupId != null
        ? { groupId: target.groupId }
        : { userId: target.userId, messageType: 1 }

    const [beforeMsgs, afterMsgs] = await Promise.all([
      this.chatDb.chatMessage.findMany({
        where: { ...sessionFilter, createdAt: { lt: target.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: contextSize,
      }),
      this.chatDb.chatMessage.findMany({
        where: { ...sessionFilter, createdAt: { gt: target.createdAt } },
        orderBy: { createdAt: 'asc' },
        take: contextSize,
      }),
    ])

    return {
      before: beforeMsgs.reverse(),
      current: [target],
      after: afterMsgs,
    }
  }

  /**
   * 搜索消息（关键词 + 筛选条件）。
   */
  async searchMessages(keyword: string, opts: SearchOptions = {}): Promise<SearchResult> {
    const { groupId, userId, startDate, endDate, limit = 50, offset = 0 } = opts
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

    const baseWhere = {
      rawMessage: { contains: keyword, mode: 'insensitive' as const },
      ...(groupId != null ? { groupId } : {}),
      ...(userId != null ? { userId } : {}),
      ...(startDate != null ? { createdAt: { gte: startDate } } : {}),
      ...(endDate != null ? { createdAt: { lte: endDate } } : {}),
      ...(!startDate && !endDate ? { createdAt: { gt: ninetyDaysAgo } } : {}),
    }

    const [items, total] = await Promise.all([
      this.chatDb.chatMessage.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.chatDb.chatMessage.count({ where: baseWhere }),
    ])

    return { items, total }
  }

  /** 关闭数据库连接。 */
  async close(): Promise<void> {
    await this.chatDb.$disconnect()
  }
}

// ── 生命周期注册 ──

Startup({ name: 'chat', provides: ['chat_service'], requires: ['chat_db'] })(async function (
  deps: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const chatDb = deps.chat_db as ChatPrismaClient
  const service = new ChatHistoryService(chatDb)
  return { chat_service: service }
})

Shutdown({ name: 'chat' })(async function (services: Record<string, unknown>): Promise<void> {
  const svc = services.chat_service as ChatHistoryService | undefined
  await svc?.close()
})
