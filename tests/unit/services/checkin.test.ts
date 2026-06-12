import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import type { RedisStore } from '@/core/redis/store.js'
import { CheckinService } from '@/services/checkin.js'

// ────────────────────────────────────────────
//  Mock 工厂
// ────────────────────────────────────────────

function createMockDb() {
  return {
    checkinRecord: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  }
}

function createMockCache() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
  }
}

type MockDb = ReturnType<typeof createMockDb>
type MockCache = ReturnType<typeof createMockCache>

// ────────────────────────────────────────────
//  Helper: today date
// ────────────────────────────────────────────

const TODAY = new Date('2024-06-15T00:00:00.000Z')
const TODAY_STR = '2024-06-15'
const YESTERDAY_STR = '2024-06-14'

// ────────────────────────────────────────────
//  Tests
// ────────────────────────────────────────────

describe('CheckinService', () => {
  let mockDb: MockDb
  let mockCache: MockCache
  let service: CheckinService

  beforeEach(() => {
    mockDb = createMockDb()
    mockCache = createMockCache()
    service = new CheckinService(
      mockDb as unknown as MainPrismaClient,
      mockCache as unknown as RedisStore,
    )
    vi.clearAllMocks()
  })

  // ──────────────────────────────────────────────
  //  checkin() — 正常签到
  // ──────────────────────────────────────────────

  describe('checkin()', () => {
    it('首次签到应当写入 DB 并更新缓存，返回 isDuplicate=false', async () => {
      // 缓存未命中 → rebuild
      mockCache.get.mockResolvedValue(null)
      // rebuild 时 count = 0
      mockDb.checkinRecord.count.mockResolvedValue(0)
      // $transaction 模拟：调用回调并返回 rank
      mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        const fakeTx = {
          checkinRecord: {
            create: vi.fn().mockResolvedValue({}),
            count: vi.fn().mockResolvedValue(1),
          },
        }
        await fn(fakeTx)
        // rank is captured inside checkin(), we just need transaction to succeed
        return undefined
      })
      mockCache.set.mockResolvedValue(undefined)

      const result = await service.checkin({ groupId: 12345n, userId: 67890n, today: TODAY })

      expect(result.isDuplicate).toBe(false)
      expect(result.streak).toBe(1) // 首次签到 streak=1
      expect(result.total).toBe(1) // 首次签到 total=1
      expect(mockDb.$transaction).toHaveBeenCalledOnce()
      expect(mockCache.set).toHaveBeenCalled()
    })

    it('连续签到应当增加 streak', async () => {
      // 缓存命中，昨天已签到
      mockCache.get.mockResolvedValue({
        lastDate: YESTERDAY_STR,
        streak: 5,
        total: 10,
      })
      // $transaction 成功
      mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        const fakeTx = {
          checkinRecord: {
            create: vi.fn().mockResolvedValue({}),
            count: vi.fn().mockResolvedValue(3),
          },
        }
        await fn(fakeTx)
        return undefined
      })
      mockCache.set.mockResolvedValue(undefined)

      const result = await service.checkin({ groupId: 12345n, userId: 67890n, today: TODAY })

      expect(result.isDuplicate).toBe(false)
      expect(result.streak).toBe(6) // 5+1
      expect(result.total).toBe(11) // 10+1
    })

    it('断签应当重置 streak 为 1', async () => {
      // 缓存命中，前天已签到（不是昨天）
      mockCache.get.mockResolvedValue({
        lastDate: '2024-06-10', // 5 天前
        streak: 3,
        total: 8,
      })
      mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        const fakeTx = {
          checkinRecord: {
            create: vi.fn().mockResolvedValue({}),
            count: vi.fn().mockResolvedValue(1),
          },
        }
        await fn(fakeTx)
        return undefined
      })
      mockCache.set.mockResolvedValue(undefined)

      const result = await service.checkin({ groupId: 12345n, userId: 67890n, today: TODAY })

      expect(result.isDuplicate).toBe(false)
      expect(result.streak).toBe(1) // 断签 → 重置
      expect(result.total).toBe(9) // 8+1
    })

    // ──────────────────────────────────────────
    //  重复签到
    // ──────────────────────────────────────────

    it('今日已签到时应当返回 isDuplicate=true，不写入 DB', async () => {
      // 缓存命中，今天已签到
      mockCache.get.mockResolvedValue({
        lastDate: TODAY_STR,
        streak: 3,
        total: 15,
      })

      const result = await service.checkin({ groupId: 12345n, userId: 67890n, today: TODAY })

      expect(result.isDuplicate).toBe(true)
      expect(result.rank).toBe(0)
      expect(result.streak).toBe(3)
      expect(result.total).toBe(15)
      expect(mockDb.$transaction).not.toHaveBeenCalled()
    })

    it('缓存命中且今日已签到时不应查询 DB', async () => {
      mockCache.get.mockResolvedValue({
        lastDate: TODAY_STR,
        streak: 2,
        total: 7,
      })

      await service.checkin({ groupId: 12345n, userId: 67890n, today: TODAY })

      expect(mockDb.checkinRecord.create).not.toHaveBeenCalled()
      expect(mockDb.checkinRecord.count).not.toHaveBeenCalled()
    })
  })

  // ──────────────────────────────────────────────
  //  rebuildCache()
  // ──────────────────────────────────────────────

  describe('rebuildCache()', () => {
    it('无历史记录时应当返回空缓存并写入', async () => {
      mockDb.checkinRecord.count.mockResolvedValue(0)
      mockCache.set.mockResolvedValue(undefined)

      const result = await service.rebuildCache(12345n, 67890n)

      expect(result).toEqual({ lastDate: '', streak: 0, total: 0 })
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('stats'),
        { lastDate: '', streak: 0, total: 0 },
        expect.any(Number),
      )
    })

    it('有历史记录时应当正确计算连续天数', async () => {
      mockDb.checkinRecord.count.mockResolvedValue(3)
      mockDb.checkinRecord.findMany.mockResolvedValue([
        { checkinDate: new Date('2024-06-15') },
        { checkinDate: new Date('2024-06-14') },
        { checkinDate: new Date('2024-06-13') },
      ])
      mockCache.set.mockResolvedValue(undefined)

      const result = await service.rebuildCache(12345n, 67890n)

      expect(result.streak).toBe(3)
      expect(result.total).toBe(3)
      expect(result.lastDate).toBe('2024-06-15')
    })
  })

  // ──────────────────────────────────────────────
  //  listRecords()
  // ──────────────────────────────────────────────

  describe('listRecords()', () => {
    it('应当调用 findMany 和 count 并返回 PageResult', async () => {
      const fakeRecords = [
        {
          id: 1,
          groupId: 1000n,
          userId: 2000n,
          checkinDate: new Date('2024-06-15'),
          checkinAt: new Date(),
        },
      ]
      mockDb.checkinRecord.findMany.mockResolvedValue(fakeRecords)
      mockDb.checkinRecord.count.mockResolvedValue(1)

      const [items, total] = await service.listRecords({ groupId: 1000n, page: 1, pageSize: 20 })

      expect(items).toEqual(fakeRecords)
      expect(total).toBe(1)
      expect(mockDb.checkinRecord.findMany).toHaveBeenCalledOnce()
      expect(mockDb.checkinRecord.count).toHaveBeenCalledOnce()
    })
  })
})
