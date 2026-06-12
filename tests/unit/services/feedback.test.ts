import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import type { BotAPI } from '@/core/protocol/api.js'
import { FeedbackService } from '@/services/feedback.js'

// ────────────────────────────────────────────
//  Mock 工厂
// ────────────────────────────────────────────

function createMockDb() {
  return {
    feedback: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  }
}

function createMockBotApi() {
  return {
    sendPrivateMsg: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
    sendGroupMsg: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
  }
}

type MockDb = ReturnType<typeof createMockDb>
type MockBotApi = ReturnType<typeof createMockBotApi>

// ────────────────────────────────────────────
//  Tests
// ────────────────────────────────────────────

describe('FeedbackService', () => {
  let mockDb: MockDb
  let mockBotApi: MockBotApi
  let service: FeedbackService

  beforeEach(() => {
    mockDb = createMockDb()
    mockBotApi = createMockBotApi()
    service = new FeedbackService(
      mockDb as unknown as MainPrismaClient,
      mockBotApi as unknown as BotAPI,
    )
    vi.clearAllMocks()
  })

  // ──────────────────────────────────────────────
  //  createFeedback()
  // ──────────────────────────────────────────────

  describe('createFeedback()', () => {
    const baseFeedback = {
      id: 'test-uuid-1',
      userId: 123456n,
      content: '这是一个 bug',
      source: 'group' as const,
      groupId: 987654n,
      feedbackType: 'bug' as const,
      status: 'pending' as const,
      adminReply: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
    }

    it('应当调用 db.feedback.create() 并返回创建的反馈', async () => {
      mockDb.feedback.create.mockResolvedValue(baseFeedback)
      // 通知管理员时查用户
      mockDb.user.findMany.mockResolvedValue([])

      const result = await service.createFeedback({
        userId: 123456n,
        content: '这是一个 bug',
        source: 'group',
        groupId: 987654n,
        feedbackType: 'bug',
      })

      expect(mockDb.feedback.create).toHaveBeenCalledOnce()
      expect(mockDb.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 123456n,
          content: '这是一个 bug',
          source: 'group',
          status: 'pending',
        }),
      })
      expect(result).toEqual(baseFeedback)
    })

    it('通知管理员失败时不应抛出错误', async () => {
      mockDb.feedback.create.mockResolvedValue(baseFeedback)
      // 通知管理员时抛出错误
      mockDb.user.findMany.mockRejectedValue(new Error('DB 连接失败'))

      // 不应抛出
      await expect(
        service.createFeedback({
          userId: 123456n,
          content: '测试',
          source: 'private',
        }),
      ).resolves.toEqual(baseFeedback)
    })

    it('feedbackType 为 null 时应当使用 null', async () => {
      mockDb.feedback.create.mockResolvedValue({
        ...baseFeedback,
        feedbackType: null,
      })
      mockDb.user.findMany.mockResolvedValue([])

      await service.createFeedback({
        userId: 123456n,
        content: '无类型反馈',
        source: 'private',
      })

      expect(mockDb.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ feedbackType: null }),
      })
    })
  })

  // ──────────────────────────────────────────────
  //  updateStatus()
  // ──────────────────────────────────────────────

  describe('updateStatus()', () => {
    const pendingFeedback = {
      id: 'test-uuid-2',
      userId: 111111n,
      content: '反馈内容',
      source: 'private' as const,
      groupId: null,
      feedbackType: null,
      status: 'pending' as const,
      adminReply: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
    }

    const doneFeedback = {
      ...pendingFeedback,
      status: 'done' as const,
      adminReply: '已处理',
      processedAt: new Date(),
    }

    it('应当调用 db.feedback.update() 更新状态字段', async () => {
      mockDb.feedback.findUnique.mockResolvedValue(pendingFeedback)
      mockDb.feedback.update.mockResolvedValue(doneFeedback)

      const result = await service.updateStatus('test-uuid-2', 'done', '已处理')

      expect(mockDb.feedback.update).toHaveBeenCalledOnce()
      expect(mockDb.feedback.update).toHaveBeenCalledWith({
        where: { id: 'test-uuid-2' },
        data: expect.objectContaining({
          status: 'done',
          adminReply: '已处理',
        }),
      })
      expect(result).toEqual(doneFeedback)
    })

    it('反馈不存在时应当返回 null', async () => {
      mockDb.feedback.findUnique.mockResolvedValue(null)

      const result = await service.updateStatus('non-existent', 'done')

      expect(result).toBeNull()
      expect(mockDb.feedback.update).not.toHaveBeenCalled()
    })

    it('状态变为 done 时应当设置 processedAt', async () => {
      mockDb.feedback.findUnique.mockResolvedValue(pendingFeedback)
      mockDb.feedback.update.mockResolvedValue(doneFeedback)

      await service.updateStatus('test-uuid-2', 'done')

      expect(mockDb.feedback.update).toHaveBeenCalledWith({
        where: { id: 'test-uuid-2' },
        data: expect.objectContaining({
          processedAt: expect.any(Date),
        }),
      })
    })

    it('已是 done 状态时不应重复设置 processedAt', async () => {
      const alreadyDone = { ...pendingFeedback, status: 'done' as const }
      mockDb.feedback.findUnique.mockResolvedValue(alreadyDone)
      mockDb.feedback.update.mockResolvedValue(alreadyDone)

      await service.updateStatus('test-uuid-2', 'done')

      expect(mockDb.feedback.update).toHaveBeenCalledWith({
        where: { id: 'test-uuid-2' },
        data: expect.not.objectContaining({
          processedAt: expect.anything(),
        }),
      })
    })

    it('状态变为 done 时应当发送用户通知（不阻塞）', async () => {
      mockDb.feedback.findUnique.mockResolvedValue(pendingFeedback)
      mockDb.feedback.update.mockResolvedValue(doneFeedback)

      await service.updateStatus('test-uuid-2', 'done', '已处理')

      // 等待通知的微任务执行
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockBotApi.sendPrivateMsg).toHaveBeenCalledOnce()
      expect(mockBotApi.sendPrivateMsg).toHaveBeenCalledWith(
        expect.any(Number),
        expect.stringContaining('反馈已处理完成'),
      )
    })
  })

  // ──────────────────────────────────────────────
  //  listFeedbacks()
  // ──────────────────────────────────────────────

  describe('listFeedbacks()', () => {
    it('应当调用 findMany 和 count 并返回 PageResult', async () => {
      const fakeFeedbacks = [
        {
          id: 'f1',
          userId: 100n,
          content: '测试',
          source: 'group' as const,
          status: 'pending' as const,
          feedbackType: null,
          groupId: null,
          adminReply: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          processedAt: null,
        },
      ]
      mockDb.feedback.findMany.mockResolvedValue(fakeFeedbacks)
      mockDb.feedback.count.mockResolvedValue(1)

      const [items, total] = await service.listFeedbacks({
        status: 'pending',
        page: 1,
        pageSize: 10,
      })

      expect(items).toEqual(fakeFeedbacks)
      expect(total).toBe(1)
      expect(mockDb.feedback.findMany).toHaveBeenCalledOnce()
    })
  })

  // ──────────────────────────────────────────────
  //  getUserFeedbacks()
  // ──────────────────────────────────────────────

  describe('getUserFeedbacks()', () => {
    it('应当按 userId 查询最近 N 条反馈', async () => {
      mockDb.feedback.findMany.mockResolvedValue([])

      await service.getUserFeedbacks(12345n, 5)

      expect(mockDb.feedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 12345n },
          take: 5,
          orderBy: { createdAt: 'desc' },
        }),
      )
    })
  })
})
