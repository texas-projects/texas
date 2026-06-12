import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import { PersonnelQueryService } from '@/core/personnel/query.js'

/** 创建 mock MainPrismaClient（仅包含 personnel 查询需要的方法）。 */
function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    group: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    groupMembership: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
    },
  }
}

type MockDb = ReturnType<typeof createMockDb>

describe('PersonnelQueryService', () => {
  let mockDb: MockDb
  let svc: PersonnelQueryService

  beforeEach(() => {
    mockDb = createMockDb()
    svc = new PersonnelQueryService(mockDb as unknown as MainPrismaClient)
  })

  describe('getUser', () => {
    it('用户不存在时应当返回 null', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const result = await svc.getUser(123456789n)

      expect(result).toBeNull()
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({ where: { qq: 123456789n } })
    })

    it('用户存在时应当返回用户视图（含 groupCount）', async () => {
      const mockUser = {
        qq: 123456789n,
        nickname: '测试用户',
        relation: 'friend',
        lastSynced: new Date('2024-01-01T00:00:00.000Z'),
      }
      mockDb.user.findUnique.mockResolvedValue(mockUser)
      mockDb.groupMembership.count.mockResolvedValue(3)

      const result = await svc.getUser(123456789n)

      expect(result).not.toBeNull()
      expect(result?.qq).toBe(123456789n)
      expect(result?.nickname).toBe('测试用户')
      expect(result?.relation).toBe('friend')
      expect(result?.groupCount).toBe(3)
      expect(result?.lastSynced).toBe('2024-01-01T00:00:00.000Z')
    })

    it('用户存在时应当返回格式化的 lastSynced', async () => {
      const syncDate = new Date('2024-03-15T10:00:00.000Z')
      const mockUser = {
        qq: 123456789n,
        nickname: '测试用户',
        relation: 'stranger',
        lastSynced: syncDate,
      }
      mockDb.user.findUnique.mockResolvedValue(mockUser)
      mockDb.groupMembership.count.mockResolvedValue(0)

      const result = await svc.getUser(123456789n)

      expect(result?.lastSynced).toBe(syncDate.toISOString())
    })
  })

  describe('isAdmin', () => {
    it('用户 relation 为 admin 时应当返回 true', async () => {
      mockDb.user.findUnique.mockResolvedValue({ relation: 'admin' })

      const result = await svc.isAdmin(987654321n)

      expect(result).toBe(true)
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { qq: 987654321n },
        select: { relation: true },
      })
    })

    it('用户 relation 为 friend 时应当返回 false', async () => {
      mockDb.user.findUnique.mockResolvedValue({ relation: 'friend' })

      const result = await svc.isAdmin(987654321n)

      expect(result).toBe(false)
    })

    it('用户不存在时应当返回 false', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const result = await svc.isAdmin(999999999n)

      expect(result).toBe(false)
    })

    it('用户 relation 为 stranger 时应当返回 false', async () => {
      mockDb.user.findUnique.mockResolvedValue({ relation: 'stranger' })

      const result = await svc.isAdmin(111111111n)

      expect(result).toBe(false)
    })

    it('用户 relation 为 group_member 时应当返回 false', async () => {
      mockDb.user.findUnique.mockResolvedValue({ relation: 'group_member' })

      const result = await svc.isAdmin(222222222n)

      expect(result).toBe(false)
    })
  })

  describe('listUsers', () => {
    it('无结果时应当返回空列表和 total=0', async () => {
      mockDb.user.count.mockResolvedValue(0)

      const result = await svc.listUsers({ page: 1, pageSize: 20 })

      expect(result.total).toBe(0)
      expect(result.items).toHaveLength(0)
      expect(result.pages).toBe(0)
      expect(mockDb.user.findMany).not.toHaveBeenCalled()
    })

    it('有结果时应当正确分页返回', async () => {
      const now = new Date()
      const mockUsers = [
        { qq: 100n, nickname: 'user1', relation: 'friend', lastSynced: now },
        { qq: 200n, nickname: 'user2', relation: 'stranger', lastSynced: now },
      ]
      mockDb.user.count.mockResolvedValue(2)
      mockDb.user.findMany.mockResolvedValue(mockUsers)
      mockDb.groupMembership.groupBy.mockResolvedValue([{ userId: 100n, _count: { userId: 2 } }])

      const result = await svc.listUsers({ page: 1, pageSize: 20 })

      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ qq: 100n, groupCount: 2 })
      expect(result.items[1]).toMatchObject({ qq: 200n, groupCount: 0 })
    })
  })

  describe('getGroup', () => {
    it('群不存在时应当返回 null', async () => {
      mockDb.group.findUnique.mockResolvedValue(null)

      const result = await svc.getGroup(999999n)

      expect(result).toBeNull()
    })

    it('群存在时应当返回群视图', async () => {
      const mockGroup = {
        groupId: 123456n,
        groupName: '测试群',
        memberCount: 100,
        maxMemberCount: 500,
        isActive: true,
        lastSynced: new Date('2024-01-01T00:00:00.000Z'),
      }
      mockDb.group.findUnique.mockResolvedValue(mockGroup)

      const result = await svc.getGroup(123456n)

      expect(result).not.toBeNull()
      expect(result?.groupId).toBe(123456n)
      expect(result?.groupName).toBe('测试群')
      expect(result?.memberCount).toBe(100)
    })
  })
})
