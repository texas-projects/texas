/**
 * 用户管理写操作服务 —— upsert、同步持久化、管理员管理。
 *
 * 只读查询已迁移至 PersonnelQueryService（query.ts）。
 * 增量事件处理已迁移至 PersonnelEventService（events.ts）。
 */

import type { CacheClient } from '@/core/cache/client.js'
import { adminSetKey, userRelationKey, USER_RELATION_GLOB } from '@/core/cache/key-registry.js'
import type { MainPrismaClient } from '@/core/db/client.js'

/** 用户关系等级。 */
export type UserRelation = 'stranger' | 'group_member' | 'friend' | 'admin'

/** 群成员角色。 */
export type GroupRole = 'owner' | 'admin' | 'member'

/** 同步状态数据结构。 */
export interface SyncStatus {
  lastSyncTime: string | null
  durationSeconds: number | null
  status: string
  usersSynced: number
  groupsSynced: number
  membershipsSynced: number
}

/** 同步结果。 */
export interface SyncResult {
  usersSynced: number
  groupsSynced: number
  membershipsSynced: number
}

/**
 * 根据同步数据计算用户关系等级。
 *
 * 当前 relation 为 admin 时直接返回，不做变更。
 */
export function computeRelation(
  current: UserRelation,
  isInFriendList: boolean,
  hasActiveMembership: boolean,
): UserRelation {
  if (current === 'admin') return 'admin'
  if (isInFriendList) return 'friend'
  if (hasActiveMembership) return 'group_member'
  return 'stranger'
}

/** 批量同步的好友数据条目。 */
export interface FriendData {
  user_id?: number
  qq?: number
  nickname?: string
  nick?: string
}

/** 批量同步的群数据条目。 */
export interface GroupData {
  group_id?: number
  group_name?: string
  member_count?: number
  max_member_count?: number
}

/** 批量同步的群成员数据条目。 */
export interface MemberData {
  user_id?: number
  nickname?: string
  card?: string
  role?: string
  join_time?: number
  last_sent_time?: number
  title?: string
  title_expire_time?: number
  level?: string
}

/** 同步状态持久化键。 */
const SYNC_STATUS_KEY = 'aemeath:personnel:sync_status'

/**
 * 用户管理核心服务 —— 封装 upsert、同步编排、缓存管理。
 */
export class PersonnelService {
  constructor(
    private readonly db: MainPrismaClient,
    private readonly cache: CacheClient,
  ) {}

  // ── 批量 upsert 操作 ──

  /**
   * 批量 upsert 用户。
   *
   * 若用户当前 relation 为 admin，则跳过 relation 更新。
   */
  async upsertUsers(usersData: FriendData[], relation: UserRelation = 'stranger'): Promise<number> {
    if (usersData.length === 0) return 0
    const now = new Date()
    let total = 0

    for (const u of usersData) {
      const qq = BigInt(u.user_id ?? u.qq ?? 0)
      if (!qq) continue
      const nickname = u.nickname ?? u.nick ?? ''

      await this.db.user.upsert({
        where: { qq },
        create: { qq, nickname, relation, lastSynced: now },
        update: {
          nickname,
          lastSynced: now,
          relation: {
            // 若当前 relation 为 admin 则不更新
          } as never,
        },
      })

      // 手动实现 admin 保护逻辑：先查再写
      const existing = await this.db.user.findUnique({ where: { qq }, select: { relation: true } })
      if (existing && existing.relation !== 'admin') {
        await this.db.user.update({ where: { qq }, data: { relation, nickname, lastSynced: now } })
      } else if (!existing) {
        await this.db.user.create({ data: { qq, nickname, relation, lastSynced: now } })
      } else {
        // admin 用户仅更新 nickname
        await this.db.user.update({ where: { qq }, data: { nickname, lastSynced: now } })
      }
      total++
    }

    return total
  }

  /** 批量 upsert 群聊。 */
  async upsertGroups(groupsData: GroupData[]): Promise<number> {
    if (groupsData.length === 0) return 0
    const now = new Date()
    let total = 0

    for (const g of groupsData) {
      const groupId = BigInt(g.group_id ?? 0)
      if (!groupId) continue

      await this.db.group.upsert({
        where: { groupId },
        create: {
          groupId,
          groupName: g.group_name ?? '',
          memberCount: g.member_count ?? 0,
          maxMemberCount: g.max_member_count ?? 0,
          isActive: true,
          lastSynced: now,
        },
        update: {
          groupName: g.group_name ?? '',
          memberCount: g.member_count ?? 0,
          maxMemberCount: g.max_member_count ?? 0,
          isActive: true,
          lastSynced: now,
        },
      })
      total++
    }

    return total
  }

  /**
   * 批量 upsert 群成员关系，并确保用户存在。
   */
  async upsertMemberships(groupId: bigint, membersData: MemberData[]): Promise<number> {
    if (membersData.length === 0) return 0
    const now = new Date()
    let total = 0

    for (const m of membersData) {
      const qq = BigInt(m.user_id ?? 0)
      if (!qq) continue

      // 确保用户存在（admin/friend 关系不降级）
      const existing = await this.db.user.findUnique({ where: { qq }, select: { relation: true } })
      if (!existing) {
        await this.db.user.create({
          data: { qq, nickname: m.nickname ?? '', relation: 'group_member', lastSynced: now },
        })
      } else if (existing.relation !== 'admin' && existing.relation !== 'friend') {
        await this.db.user.update({
          where: { qq },
          data: { nickname: m.nickname ?? '', relation: 'group_member', lastSynced: now },
        })
      } else {
        await this.db.user.update({
          where: { qq },
          data: { nickname: m.nickname ?? '', lastSynced: now },
        })
      }

      // upsert 成员关系
      await this.db.groupMembership.upsert({
        where: { userId_groupId: { userId: qq, groupId } },
        create: {
          userId: qq,
          groupId,
          card: m.card ?? '',
          role: (m.role ?? 'member') as GroupRole,
          joinTime: m.join_time ?? 0,
          lastActiveTime: m.last_sent_time ?? 0,
          title: m.title ?? '',
          titleExpireTime: m.title_expire_time ?? 0,
          level: m.level ?? '',
          isActive: true,
        },
        update: {
          card: m.card ?? '',
          role: (m.role ?? 'member') as GroupRole,
          joinTime: m.join_time ?? 0,
          lastActiveTime: m.last_sent_time ?? 0,
          title: m.title ?? '',
          titleExpireTime: m.title_expire_time ?? 0,
          level: m.level ?? '',
          isActive: true,
        },
      })
      total++
    }

    return total
  }

  // ── 失效数据清理 ──

  /** 将不在最新群列表中的群标记为 is_active=False。 */
  async deactivateStaleGroups(activeGroupIds: Set<bigint>): Promise<void> {
    if (activeGroupIds.size === 0) {
      await this.db.group.updateMany({ data: { isActive: false } })
      return
    }

    await this.db.group.updateMany({
      where: { groupId: { notIn: [...activeGroupIds] }, isActive: true },
      data: { isActive: false },
    })
  }

  /** 将不在最新成员列表中的成员关系标记为 is_active=False。 */
  async deactivateStateMemberships(groupId: bigint, activeUserIds: Set<bigint>): Promise<void> {
    if (activeUserIds.size === 0) {
      await this.db.groupMembership.updateMany({
        where: { groupId, isActive: true },
        data: { isActive: false },
      })
      return
    }

    await this.db.groupMembership.updateMany({
      where: { groupId, userId: { notIn: [...activeUserIds] }, isActive: true },
      data: { isActive: false },
    })
  }

  // ── 全量同步持久化 ──

  /**
   * 将采集到的用户数据批量持久化到数据库。
   */
  async persistSyncData(
    friends: FriendData[] | null,
    groups: GroupData[] | null,
    members: Record<number, MemberData[]> | null,
  ): Promise<SyncResult> {
    const startTime = Date.now()
    let usersSynced = 0
    let groupsSynced = 0
    let membershipsSynced = 0

    const friendQqSet = new Set<bigint>()

    // 1. 同步好友
    if (friends && friends.length > 0) {
      usersSynced = await this._upsertUsersSimple(friends, 'friend')
      for (const f of friends) {
        const qq = BigInt(f.user_id ?? f.qq ?? 0)
        if (qq) friendQqSet.add(qq)
      }
    }

    // 2. 同步群聊
    const activeGroupIds = new Set<bigint>()
    if (groups && groups.length > 0) {
      groupsSynced = await this.upsertGroups(groups)
      for (const g of groups) {
        const gid = BigInt(g.group_id ?? 0)
        if (gid) activeGroupIds.add(gid)
      }
    }

    // 3. 同步群成员
    if (members) {
      for (const [gidStr, memberList] of Object.entries(members)) {
        const gid = BigInt(gidStr)
        membershipsSynced += await this.upsertMemberships(gid, memberList)
        const activeUserIds = new Set<bigint>(
          memberList.map((m) => BigInt(m.user_id ?? 0)).filter((q) => q > 0n),
        )
        await this.deactivateStateMemberships(gid, activeUserIds)
      }
    }

    // 4. 清理失效群
    if (groups !== null) {
      await this.deactivateStaleGroups(activeGroupIds)
    }

    // 5. 重算关系等级
    await this._recalculateRelations(friendQqSet)

    const durationSeconds = (Date.now() - startTime) / 1000

    // 写入 Redis 同步状态
    const statusData: SyncStatus = {
      lastSyncTime: new Date().toISOString(),
      durationSeconds: Math.round(durationSeconds * 1000) / 1000,
      status: 'success',
      usersSynced,
      groupsSynced,
      membershipsSynced,
    }
    await this.cache.set(SYNC_STATUS_KEY, statusData, 0)

    // 清除用户关系缓存
    await this._invalidateAllRelationCache()

    return { usersSynced, groupsSynced, membershipsSynced }
  }

  // ── 超级管理员管理 ──

  /** 设置超级管理员。返回是否成功。 */
  async setAdmin(qq: bigint): Promise<boolean> {
    const user = await this.db.user.findUnique({ where: { qq } })
    if (!user) return false

    await this.db.user.update({ where: { qq }, data: { relation: 'admin' } })
    await this.cache.del(userRelationKey(qq))
    await this.cache.del(adminSetKey())
    return true
  }

  /** 移除超级管理员，根据当前状态自动降级。返回是否成功。 */
  async removeAdmin(qq: bigint): Promise<boolean> {
    const user = await this.db.user.findUnique({ where: { qq } })
    if (user?.relation !== 'admin') return false

    const hasMembership = await this.db.groupMembership.findFirst({
      where: { userId: qq, isActive: true },
      select: { id: true },
    })

    const newRelation: UserRelation = hasMembership ? 'group_member' : 'stranger'
    await this.db.user.update({ where: { qq }, data: { relation: newRelation } })
    await this.cache.del(userRelationKey(qq))
    await this.cache.del(adminSetKey())
    return true
  }

  /** 获取所有超级管理员列表。 */
  async getAdmins(): Promise<
    { qq: bigint; nickname: string; relation: string; lastSynced: string | null }[]
  > {
    const admins = await this.db.user.findMany({ where: { relation: 'admin' } })
    return admins.map((r) => ({
      qq: r.qq,
      nickname: r.nickname,
      relation: r.relation,
      lastSynced: r.lastSynced.toISOString(),
    }))
  }

  /** 获取所有超级管理员的 QQ 号集合（带 Redis 缓存）。 */
  async getAdminQqSet(): Promise<Set<bigint>> {
    const key = adminSetKey()
    const cached = await this.cache.get<number[]>(key)
    if (cached !== null && Array.isArray(cached)) {
      return new Set(cached.map((q) => BigInt(q)))
    }

    const rows = await this.db.user.findMany({
      where: { relation: 'admin' },
      select: { qq: true },
    })
    const qqList = rows.map((r) => Number(r.qq))
    await this.cache.set(key, qqList, 300)
    return new Set(rows.map((r) => r.qq))
  }

  /** 获取最近一次同步状态。 */
  async getSyncStatus(): Promise<SyncStatus> {
    const data = await this.cache.get<SyncStatus>(SYNC_STATUS_KEY)
    if (data !== null && typeof data === 'object') {
      return data
    }
    return {
      lastSyncTime: null,
      durationSeconds: null,
      status: 'never',
      usersSynced: 0,
      groupsSynced: 0,
      membershipsSynced: 0,
    }
  }

  /** 获取用户关系等级（带缓存）。 */
  async getUserRelation(qq: bigint): Promise<string> {
    const key = userRelationKey(qq)
    const cached = await this.cache.get<string>(key)
    if (cached !== null) return cached

    const user = await this.db.user.findUnique({ where: { qq }, select: { relation: true } })
    const relation = user?.relation ?? 'stranger'
    await this.cache.set(key, relation, 300)
    return relation
  }

  // ── 内部辅助 ──

  /** 简化版 upsertUsers（不进行 admin 保护判断，直接批量写入）。 */
  private async _upsertUsersSimple(
    usersData: FriendData[],
    relation: UserRelation,
  ): Promise<number> {
    if (usersData.length === 0) return 0
    const now = new Date()
    let total = 0

    for (const u of usersData) {
      const qq = BigInt(u.user_id ?? u.qq ?? 0)
      if (!qq) continue
      const nickname = u.nickname ?? u.nick ?? ''

      const existing = await this.db.user.findUnique({ where: { qq }, select: { relation: true } })
      if (!existing) {
        await this.db.user.create({ data: { qq, nickname, relation, lastSynced: now } })
      } else if (existing.relation === 'admin') {
        await this.db.user.update({ where: { qq }, data: { nickname, lastSynced: now } })
      } else {
        await this.db.user.update({ where: { qq }, data: { nickname, relation, lastSynced: now } })
      }
      total++
    }

    return total
  }

  /** 重算所有非 admin 用户的 relation 字段。 */
  private async _recalculateRelations(friendQqSet: Set<bigint>): Promise<void> {
    const users = await this.db.user.findMany({
      where: { relation: { not: 'admin' } },
      select: { qq: true, relation: true },
    })

    if (users.length === 0) return

    const userIds = users.map((u) => u.qq)
    const activeMemberRows = await this.db.groupMembership.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { userId: true },
      distinct: ['userId'],
    })
    const activeMemberIds = new Set(activeMemberRows.map((r) => r.userId))

    for (const user of users) {
      const hasActiveMembership = activeMemberIds.has(user.qq)
      const isFriend = friendQqSet.has(user.qq)
      const newRelation = computeRelation(user.relation, isFriend, hasActiveMembership)
      if (user.relation !== newRelation) {
        await this.db.user.update({ where: { qq: user.qq }, data: { relation: newRelation } })
      }
    }
  }

  /** 清除所有用户关系缓存。 */
  private async _invalidateAllRelationCache(): Promise<void> {
    try {
      await this.cache.deleteByPattern(USER_RELATION_GLOB)
      await this.cache.del(adminSetKey())
    } catch {
      // 缓存清除失败不影响主流程
    }
  }
}
