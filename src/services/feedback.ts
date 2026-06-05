/**
 * 用户反馈业务逻辑 —— 反馈创建、查询、状态更新、通知。
 */

import type {
  Prisma,
  Feedback,
  FeedbackStatus,
  FeedbackSource,
  FeedbackType,
} from '../../prisma/main/generated/index.js'
import type { MainPrismaClient } from '../core/db/client.js'
import { Startup } from '../core/lifecycle/registry.js'
import { logger, type Logger } from '../core/logging/setup.js'
import type { BotAPI } from '../core/protocol/api.js'

export type { Feedback, FeedbackStatus, FeedbackSource, FeedbackType }

// ── 数据传输类型 ──

/** 创建反馈的入参。 */
export interface CreateFeedbackData {
  userId: bigint
  content: string
  source: FeedbackSource
  groupId?: bigint | null
  feedbackType?: FeedbackType | null
}

/** 列表查询参数（宽松类型以兼容来自 HTTP query 的字符串值）。 */
export interface ListFeedbacksParams {
  page?: number
  pageSize?: number
  status?: string
  feedbackType?: string
  userId?: bigint | number
  source?: string
  search?: string
}

/**
 * 用户反馈核心服务 —— 封装反馈 CRUD 和通知。
 *
 * 通过 Startup 生命周期注册，由 LifecycleOrchestrator 管理。
 */
export class FeedbackService {
  private readonly _log: Logger = logger.child({ name: 'FeedbackService' })

  constructor(
    private readonly db: MainPrismaClient,
    private readonly botApi: BotAPI,
  ) {}

  // ════════════════════════════════════════════
  //  反馈 CRUD
  // ════════════════════════════════════════════

  /**
   * 创建反馈记录并通知所有管理员。
   */
  async createFeedback(data: CreateFeedbackData): Promise<Feedback> {
    const feedback = await this.db.feedback.create({
      data: {
        userId: data.userId,
        content: data.content,
        source: data.source,
        groupId: data.groupId ?? null,
        feedbackType: data.feedbackType ?? null,
        status: 'pending',
      },
    })

    // 通知管理员（不阻塞主流程）
    this._notifyAdmins(feedback).catch((err: unknown) => {
      this._log.error({ feedbackId: feedback.id, err }, '通知管理员失败')
    })

    return feedback
  }

  /**
   * 分页查询反馈列表，支持多条件筛选和搜索。返回 [items, total] 元组。
   */
  async listFeedbacks(params: ListFeedbacksParams = {}): Promise<[Feedback[], number]> {
    const { page = 1, pageSize = 20, status, feedbackType, userId, source, search } = params

    const where: Prisma.FeedbackWhereInput = {
      ...(status != null ? { status: status as FeedbackStatus } : {}),
      ...(feedbackType != null ? { feedbackType: feedbackType as FeedbackType } : {}),
      ...(userId != null ? { userId: BigInt(userId) } : {}),
      ...(source != null ? { source: source as FeedbackSource } : {}),
      ...(search != null && search !== ''
        ? {
            OR: [
              { content: { contains: search, mode: 'insensitive' } },
              { adminReply: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.db.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: true },
      }),
      this.db.feedback.count({ where }),
    ])

    return [items, total]
  }

  /**
   * 获取反馈详情（包含用户信息）。
   */
  async getFeedback(feedbackId: string): Promise<Feedback | null> {
    return this.db.feedback.findUnique({
      where: { id: feedbackId },
      include: { user: true },
    })
  }

  /**
   * 更新反馈状态；状态变为 done 时通知用户。
   */
  async updateStatus(
    feedbackId: string,
    status: string,
    adminReply?: string | null,
  ): Promise<Feedback | null> {
    const existing = await this.db.feedback.findUnique({
      where: { id: feedbackId },
    })
    if (existing === null) return null

    const oldStatus = existing.status
    const isDoneTransition = status === 'done' && oldStatus !== 'done'

    const updated = await this.db.feedback.update({
      where: { id: feedbackId },
      data: {
        status: status as FeedbackStatus,
        ...(adminReply != null ? { adminReply } : {}),
        ...(isDoneTransition ? { processedAt: new Date() } : {}),
      },
    })

    if (isDoneTransition) {
      this._notifyUser(updated).catch((err: unknown) => {
        this._log.error({ feedbackId: updated.id, err }, '通知用户失败')
      })
    }

    return updated
  }

  /**
   * 获取用户自己的反馈列表（最近 N 条）。
   */
  async getUserFeedbacks(userId: bigint, limit = 5): Promise<Feedback[]> {
    return this.db.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // ════════════════════════════════════════════
  //  内部辅助
  // ════════════════════════════════════════════

  private async _notifyAdmins(feedback: Feedback): Promise<void> {
    const admins = await this.db.user.findMany({
      where: { relation: 'admin' },
    })

    if (admins.length === 0) {
      this._log.warn('无管理员可通知')
      return
    }

    const sourceText = feedback.source === 'group' ? '群聊' : '私聊'
    const typeText = feedback.feedbackType ?? '未分类'
    const message =
      `【新反馈通知】\n` +
      `来源：${sourceText}\n` +
      `类型：${typeText}\n` +
      `用户：${String(feedback.userId)}\n` +
      `内容：${feedback.content}\n` +
      `ID：${feedback.id}`

    // 并发通知所有管理员
    const sendTasks = admins.map(async (admin) => {
      try {
        await this.botApi.sendPrivateMsg(Number(admin.qq), message)
      } catch (err: unknown) {
        this._log.warn({ adminQq: admin.qq, feedbackId: feedback.id, err }, '通知管理员失败')
      }
    })

    await Promise.allSettled(sendTasks)
  }

  private async _notifyUser(feedback: Feedback): Promise<void> {
    const preview =
      feedback.content.length > 50 ? `${feedback.content.slice(0, 50)}...` : feedback.content

    let message = `【反馈处理通知】\n您的反馈已处理完成。\n反馈内容：${preview}\n`
    if (feedback.adminReply) {
      message += `管理员回复：${feedback.adminReply}`
    }

    try {
      if (feedback.source === 'group' && feedback.groupId != null) {
        await this.botApi.sendGroupMsg(Number(feedback.groupId), message)
      } else {
        await this.botApi.sendPrivateMsg(Number(feedback.userId), message)
      }
    } catch (err) {
      this._log.warn({ userId: feedback.userId, feedbackId: feedback.id, err }, '通知用户失败')
    }
  }
}

// ── 生命周期注册 ──

Startup({
  name: 'feedback',
  provides: ['feedback_service'],
  requires: ['db', 'bot_api'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  const botApi = deps.bot_api as BotAPI
  return { feedback_service: new FeedbackService(db, botApi) }
})
