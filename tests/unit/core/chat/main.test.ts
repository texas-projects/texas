import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatHistoryService } from '@/core/chat/index.js'
import type { ChatPrismaClient } from '@/core/db.js'

/** 创建 chatDb mock。 */
function createMockChatDb() {
  return {
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $disconnect: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
  }
}

type MockChatDb = ReturnType<typeof createMockChatDb>

describe('ChatHistoryService', () => {
  let mockChatDb: MockChatDb
  let service: ChatHistoryService

  beforeEach(() => {
    mockChatDb = createMockChatDb()
    service = new ChatHistoryService(mockChatDb as unknown as ChatPrismaClient)
  })

  // ──────────────────────────────────────────────
  //  saveMessage
  // ──────────────────────────────────────────────

  describe('saveMessage', () => {
    it('应当调用 chatDb.chatMessage.create() 持久化消息', async () => {
      mockChatDb.chatMessage.create.mockResolvedValue({})

      await service.saveMessage({
        messageId: 1001n,
        messageType: 2,
        groupId: 123456n,
        userId: 987654n,
        rawMessage: '你好',
        segments: [{ type: 'text', data: { text: '你好' } }],
        senderNickname: '测试用户',
        senderCard: null,
        senderRole: 'member',
        createdAt: new Date('2024-01-01T12:00:00Z'),
      })

      expect(mockChatDb.chatMessage.create).toHaveBeenCalledOnce()
      expect(mockChatDb.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          messageId: 1001n,
          messageType: 2,
          groupId: 123456n,
          userId: 987654n,
          rawMessage: '你好',
          senderNickname: '测试用户',
        }),
      })
    })

    it('持久化失败时应当吞掉错误不抛出', async () => {
      mockChatDb.chatMessage.create.mockRejectedValue(new Error('DB 连接失败'))

      await expect(
        service.saveMessage({
          messageId: 1002n,
          messageType: 1,
          userId: 111n,
          rawMessage: '测试',
          segments: [],
          senderNickname: '用户',
          createdAt: new Date(),
        }),
      ).resolves.toBeUndefined()
    })

    it('groupId 为 undefined 时应当写入 null', async () => {
      mockChatDb.chatMessage.create.mockResolvedValue({})

      await service.saveMessage({
        messageId: 2001n,
        messageType: 1,
        groupId: undefined,
        userId: 555n,
        rawMessage: '私聊消息',
        segments: [],
        senderNickname: '私聊用户',
        createdAt: new Date(),
      })

      expect(mockChatDb.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ groupId: null }),
      })
    })
  })

  // ──────────────────────────────────────────────
  //  getGroupHistory
  // ──────────────────────────────────────────────

  describe('getGroupHistory', () => {
    const fakeMessages = [
      {
        id: 1n,
        createdAt: new Date('2024-06-01'),
        messageId: 100n,
        messageType: 2,
        groupId: 888n,
        userId: 999n,
        rawMessage: '群消息',
        segments: [],
        senderNickname: '群友',
        senderCard: null,
        senderRole: 'member',
        storedAt: new Date(),
      },
    ]

    it('应当按 groupId 查询并按 createdAt desc 排序', async () => {
      mockChatDb.chatMessage.findMany.mockResolvedValue(fakeMessages)

      const result = await service.getGroupHistory(888n)

      expect(mockChatDb.chatMessage.findMany).toHaveBeenCalledOnce()

      interface FindManyArg {
        where: { groupId: bigint }
        orderBy: { createdAt: string }
        take: number
      }
      const callArg = mockChatDb.chatMessage.findMany.mock.calls[0]?.[0] as FindManyArg
      expect(callArg.where.groupId).toBe(888n)
      expect(callArg.orderBy.createdAt).toBe('desc')
      expect(callArg.take).toBe(50) // 默认 limit

      expect(result).toEqual(fakeMessages)
    })

    it('传入 limit 时应当使用指定值', async () => {
      mockChatDb.chatMessage.findMany.mockResolvedValue([])

      await service.getGroupHistory(888n, { limit: 20 })

      interface FindManyArg {
        take: number
      }
      const callArg = mockChatDb.chatMessage.findMany.mock.calls[0]?.[0] as FindManyArg
      expect(callArg.take).toBe(20)
    })

    it('传入 before 时应当添加 lt 时间过滤', async () => {
      mockChatDb.chatMessage.findMany.mockResolvedValue([])
      const before = new Date('2024-05-01')

      await service.getGroupHistory(888n, { before })

      interface FindManyArg {
        where: { createdAt?: { lt?: Date } }
      }
      const callArg = mockChatDb.chatMessage.findMany.mock.calls[0]?.[0] as FindManyArg
      expect(callArg.where.createdAt).toEqual({ lt: before })
    })
  })

  // ──────────────────────────────────────────────
  //  getPrivateHistory
  // ──────────────────────────────────────────────

  describe('getPrivateHistory', () => {
    it('应当按 userId 和 messageType=1 查询', async () => {
      mockChatDb.chatMessage.findMany.mockResolvedValue([])

      await service.getPrivateHistory(12345n)

      interface FindManyArg {
        where: { userId: bigint; messageType: number }
      }
      const callArg = mockChatDb.chatMessage.findMany.mock.calls[0]?.[0] as FindManyArg
      expect(callArg.where.userId).toBe(12345n)
      expect(callArg.where.messageType).toBe(1)
    })
  })
})
