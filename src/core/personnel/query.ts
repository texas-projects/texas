/**
 * 用户管理只读查询服务 —— 分页列表、详情查询，SRP 分离自 PersonnelService。
 */

import type { MainPrismaClient } from '@/core/db/client.js'

/** 分页结果。 */
export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pages: number
}

/** 用户视图。 */
export interface UserView {
  qq: bigint
  nickname: string
  relation: string
  groupCount: number
  lastSynced: string | null
}

/** 群聊视图。 */
export interface GroupView {
  groupId: bigint
  groupName: string
  memberCount: number
  maxMemberCount: number
  isActive: boolean
  lastSynced: string | null
}

/** 群成员视图。 */
export interface GroupMemberView {
  qq: bigint
  nickname: string
  card: string
  role: string
  relation: string
  joinTime: bigint
  lastActiveTime: bigint
  title: string
  level: string
}

/** 用户所属群视图。 */
export interface UserGroupView {
  groupId: bigint
  groupName: string
  memberCount: number
  maxMemberCount: number
  isActive: boolean
  lastSynced: string | null
  card: string
  role: string
  joinTime: bigint
}

/** 批量解析结果。 */
export interface ResolveResult {
  users: Record<string, { nickname: string; relation: string }>
  groups: Record<string, { groupName: string }>
}

/** 向上取整除法。 */
function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b)
}

/**
 * 用户管理只读查询服务。
 */
export class PersonnelQueryService {
  constructor(private readonly db: MainPrismaClient) {}

  // ── 用户查询 ──

  /** 获取单个用户详情（含活跃群聊数）。 */
  async getUser(qq: bigint): Promise<UserView | null> {
    const user = await this.db.user.findUnique({ where: { qq } })
    if (!user) return null

    const groupCount = await this.db.groupMembership.count({
      where: { userId: qq, isActive: true },
    })

    return {
      qq: user.qq,
      nickname: user.nickname,
      relation: user.relation,
      groupCount,
      lastSynced: user.lastSynced.toISOString(),
    }
  }

  /** 分页查询用户列表。 */
  async listUsers(opts?: {
    page?: number
    pageSize?: number
    relation?: string
    qq?: bigint
    nickname?: string
  }): Promise<PaginatedResult<UserView>> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? 20
    const where: Record<string, unknown> = {}

    if (opts?.relation) where.relation = opts.relation
    if (opts?.qq) where.qq = opts.qq
    if (opts?.nickname) where.nickname = { contains: opts.nickname, mode: 'insensitive' }

    const total = await this.db.user.count({ where })

    if (total === 0) {
      return { items: [], total: 0, page, pageSize, pages: 0 }
    }

    const offset = (page - 1) * pageSize
    const users = await this.db.user.findMany({
      where,
      orderBy: { qq: 'asc' },
      skip: offset,
      take: pageSize,
    })

    // 批量查询 groupCount，避免 N+1
    const userIds = users.map((u) => u.qq)
    const gcRows = await this.db.groupMembership.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, isActive: true },
      _count: { userId: true },
    })
    const groupCounts = new Map(gcRows.map((r) => [r.userId, r._count.userId]))

    const items: UserView[] = users.map((u) => ({
      qq: u.qq,
      nickname: u.nickname,
      relation: u.relation,
      groupCount: groupCounts.get(u.qq) ?? 0,
      lastSynced: u.lastSynced.toISOString(),
    }))

    return { items, total, page, pageSize, pages: ceilDiv(total, pageSize) }
  }

  /** 获取用户所属的所有群聊。 */
  async getUserGroups(qq: bigint): Promise<UserGroupView[]> {
    const rows = await this.db.groupMembership.findMany({
      where: { userId: qq, isActive: true },
      include: { group: true },
      orderBy: { groupId: 'asc' },
    })

    return rows.map((r) => ({
      groupId: r.group.groupId,
      groupName: r.group.groupName,
      memberCount: r.group.memberCount,
      maxMemberCount: r.group.maxMemberCount,
      isActive: r.group.isActive,
      lastSynced: r.group.lastSynced.toISOString(),
      card: r.card,
      role: r.role,
      joinTime: r.joinTime,
    }))
  }

  /** 搜索用户（按昵称模糊匹配）。 */
  async searchUsers(query: string, limit = 20): Promise<UserView[]> {
    const users = await this.db.user.findMany({
      where: { nickname: { contains: query, mode: 'insensitive' } },
      take: limit,
      orderBy: { qq: 'asc' },
    })
    return users.map((u) => ({
      qq: u.qq,
      nickname: u.nickname,
      relation: u.relation,
      groupCount: 0,
      lastSynced: u.lastSynced.toISOString(),
    }))
  }

  // ── 群查询 ──

  /** 分页查询群列表。 */
  async listGroups(opts?: {
    page?: number
    pageSize?: number
    groupName?: string
    isActive?: boolean
  }): Promise<PaginatedResult<GroupView>> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? 20
    const where: Record<string, unknown> = {}

    if (opts?.groupName) where.groupName = { contains: opts.groupName, mode: 'insensitive' }
    if (opts?.isActive !== undefined) where.isActive = opts.isActive

    const total = await this.db.group.count({ where })

    if (total === 0) {
      return { items: [], total: 0, page, pageSize, pages: 0 }
    }

    const offset = (page - 1) * pageSize
    const groups = await this.db.group.findMany({
      where,
      orderBy: { groupId: 'asc' },
      skip: offset,
      take: pageSize,
    })

    const items: GroupView[] = groups.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      memberCount: g.memberCount,
      maxMemberCount: g.maxMemberCount,
      isActive: g.isActive,
      lastSynced: g.lastSynced.toISOString(),
    }))

    return { items, total, page, pageSize, pages: ceilDiv(total, pageSize) }
  }

  /** 获取单个群聊详情。 */
  async getGroup(groupId: bigint): Promise<GroupView | null> {
    const group = await this.db.group.findUnique({ where: { groupId } })
    if (!group) return null

    return {
      groupId: group.groupId,
      groupName: group.groupName,
      memberCount: group.memberCount,
      maxMemberCount: group.maxMemberCount,
      isActive: group.isActive,
      lastSynced: group.lastSynced.toISOString(),
    }
  }

  /** 获取所有群列表（可过滤仅活跃群）。 */
  async getGroups(opts?: { activeOnly?: boolean }): Promise<GroupView[]> {
    const where: Record<string, unknown> = {}
    if (opts?.activeOnly) where.isActive = true

    const groups = await this.db.group.findMany({ where, orderBy: { groupId: 'asc' } })
    return groups.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      memberCount: g.memberCount,
      maxMemberCount: g.maxMemberCount,
      isActive: g.isActive,
      lastSynced: g.lastSynced.toISOString(),
    }))
  }

  /** 分页获取群成员列表。 */
  async listGroupMembers(
    groupId: bigint,
    opts?: {
      page?: number
      pageSize?: number
      role?: string
      nickname?: string
      qq?: bigint
    },
  ): Promise<PaginatedResult<GroupMemberView>> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? 20
    const memberWhere: Record<string, unknown> = { groupId, isActive: true }

    if (opts?.role) memberWhere.role = opts.role
    if (opts?.qq) memberWhere.userId = opts.qq

    const userWhere: Record<string, unknown> = {}
    if (opts?.nickname) userWhere.nickname = { contains: opts.nickname, mode: 'insensitive' }

    const where = {
      ...memberWhere,
      ...(Object.keys(userWhere).length > 0 ? { user: userWhere } : {}),
    }

    const total = await this.db.groupMembership.count({ where })

    if (total === 0) {
      return { items: [], total: 0, page, pageSize, pages: 0 }
    }

    const offset = (page - 1) * pageSize
    const rows = await this.db.groupMembership.findMany({
      where,
      include: { user: true },
      orderBy: { userId: 'asc' },
      skip: offset,
      take: pageSize,
    })

    const items: GroupMemberView[] = rows.map((r) => ({
      qq: r.user.qq,
      nickname: r.user.nickname,
      card: r.card,
      role: r.role,
      relation: r.user.relation,
      joinTime: r.joinTime,
      lastActiveTime: r.lastActiveTime,
      title: r.title,
      level: r.level,
    }))

    return { items, total, page, pageSize, pages: ceilDiv(total, pageSize) }
  }

  /** 获取群成员列表（全量，无分页）。 */
  async getGroupMembers(groupId: bigint): Promise<UserView[]> {
    const rows = await this.db.groupMembership.findMany({
      where: { groupId, isActive: true },
      include: { user: true },
    })

    return rows.map((r) => ({
      qq: r.user.qq,
      nickname: r.user.nickname,
      relation: r.user.relation,
      groupCount: 0,
      lastSynced: r.user.lastSynced.toISOString(),
    }))
  }

  /** 查询用户是否为超级管理员。 */
  async isAdmin(userId: bigint): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { qq: userId },
      select: { relation: true },
    })
    return user?.relation === 'admin'
  }

  /** 搜索群（按群名模糊匹配）。 */
  async searchGroups(query: string, limit = 20): Promise<GroupView[]> {
    const groups = await this.db.group.findMany({
      where: { groupName: { contains: query, mode: 'insensitive' } },
      take: limit,
      orderBy: { groupId: 'asc' },
    })
    return groups.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      memberCount: g.memberCount,
      maxMemberCount: g.maxMemberCount,
      isActive: g.isActive,
      lastSynced: g.lastSynced.toISOString(),
    }))
  }

  /** 批量解析用户和群 ID 到基本展示信息。 */
  async resolveBatch(userIds: bigint[], groupIds: bigint[]): Promise<ResolveResult> {
    const [users, groups] = await Promise.all([
      userIds.length > 0
        ? this.db.user.findMany({
            where: { qq: { in: userIds } },
            select: { qq: true, nickname: true, relation: true },
          })
        : Promise.resolve([]),
      groupIds.length > 0
        ? this.db.group.findMany({
            where: { groupId: { in: groupIds } },
            select: { groupId: true, groupName: true },
          })
        : Promise.resolve([]),
    ])

    return {
      users: Object.fromEntries(
        users.map((u) => [String(u.qq), { nickname: u.nickname, relation: u.relation }]),
      ),
      groups: Object.fromEntries(
        groups.map((g) => [String(g.groupId), { groupName: g.groupName }]),
      ),
    }
  }
}
