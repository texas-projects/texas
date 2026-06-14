/**
 * 聊天记录业务逻辑 —— 消息持久化、查询、上下文获取。
 */

import { logger, type Logger } from '@logger'
import type { Client } from 'minio'

import type { ChatMessage } from '#prisma/chat'

import { ArchiveService } from './archive.js'
import type { MediaStorageService } from './media.js'
import { ArchiveS3 } from './s3.js'

import { loadConfig } from '@/core/config.js'
import type { ChatPrismaClient, MainPrismaClient } from '@/core/db.js'
import { Service, Inject, Provide, Startup, Shutdown } from '@/core/lifecycle/decorators/index.js'
import type { OssBundle, OssBuckets } from '@/core/oss/client.js'

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

  constructor(
    private readonly chatDb: ChatPrismaClient,
    private readonly mediaStorage?: MediaStorageService,
  ) {}

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
      // 媒体持久化：对 segments 中 type=image 的项上传到 S3
      let processedSegments = data.segments
      if (this.mediaStorage && Array.isArray(data.segments)) {
        processedSegments = await this._persistMediaSegments(data.segments)
      }

      await this.chatDb.chatMessage.create({
        data: {
          messageId: data.messageId,
          messageType: data.messageType,
          groupId: data.groupId ?? null,
          userId: data.userId,
          rawMessage: data.rawMessage,
          segments: processedSegments ?? {},
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

  /** 提取 segments 中的图片 URL，持久化到 S3，并在 segment 中新增 s3Key 字段。 */
  private async _persistMediaSegments(segments: unknown[]): Promise<unknown[]> {
    const imageUrls: string[] = []
    for (const seg of segments) {
      if (typeof seg === 'object' && seg !== null && 'type' in seg) {
        const s = seg as Record<string, unknown>
        if (s.type === 'image' && typeof s.url === 'string') {
          imageUrls.push(s.url)
        }
      }
    }

    if (imageUrls.length === 0) return segments

    if (!this.mediaStorage) return segments
    const mapping = await this.mediaStorage.persistMany(imageUrls)

    return segments.map((seg) => {
      if (typeof seg === 'object' && seg !== null && 'type' in seg) {
        const s = seg as Record<string, unknown>
        if (s.type === 'image' && typeof s.url === 'string') {
          const s3Key = mapping.get(s.url)
          if (s3Key) return { ...s, s3Key }
        }
      }
      return seg
    })
  }

  /** 关闭数据库连接。 */
  async close(): Promise<void> {
    await this.chatDb.$disconnect()
  }
}

// ── 生命周期注册 ──

@Service({ name: 'chat_bootstrap' })
export class ChatBootstrap {
  /** 注入聊天数据库 */
  @Inject('chat_db')
  chatDb!: ChatPrismaClient

  /** 注入主数据库 */
  @Inject('db')
  mainDb!: MainPrismaClient

  /** 注入 OSS 客户端与 bucket 配置 */
  @Inject('oss')
  oss!: OssBundle

  /** 注入媒体存储服务 */
  @Inject('media_storage')
  mediaStorage!: MediaStorageService

  /** 对外暴露聊天历史服务 */
  @Provide('chat_service')
  chatService!: ChatHistoryService

  /** 对外暴露归档服务 */
  @Provide('archive_service')
  archiveService!: ArchiveService

  @Startup
  start(): void {
    const config = loadConfig()
    const { client, buckets } = this.oss as { client: Client; buckets: OssBuckets }

    this.chatService = new ChatHistoryService(this.chatDb, this.mediaStorage)

    const exporterSettings = {
      retentionMonths: 12,
      batchSize: 5000,
      compression: 'zstd' as const,
    }
    const archiveS3 = new ArchiveS3(client, buckets.archive, config.S3_ARCHIVE_PREFIX)
    this.archiveService = new ArchiveService(this.chatDb, this.mainDb, exporterSettings, archiveS3)
  }

  @Shutdown
  async stop(): Promise<void> {
    await this.chatService.close()
  }
}
