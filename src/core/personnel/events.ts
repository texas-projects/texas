/**
 * 用户事件处理服务 —— 处理好友/群成员的增量变更事件。
 *
 * 处理来自 Bot 的实时事件（好友添加、群成员进出、群管理员变动等），
 * 将增量变更持久化到数据库并维护 Redis 缓存。
 */

import { computeRelation } from './index.js'

import type { MainPrismaClient } from '@/core/db.js'
import type { RedisStore } from '@/core/redis/store.js'
import { cacheKeyRegistry } from '@/core/registries.js'

/**
 * 处理 Bot 实时增量事件，维护用户与群成员关系的即时状态。
 */
export class PersonnelEventService {
  constructor(
    private readonly db: MainPrismaClient,
    private readonly cache: RedisStore,
  ) {}

  /** 好友添加：若非 admin 则升级为 friend。 */
  async onFriendAdd(userId: bigint): Promise<void> {
    const existing = await this.db.user.findUnique({
      where: { qq: userId },
      select: { relation: true },
    })

    if (!existing) {
      await this.db.user.create({
        data: { qq: userId, nickname: '', relation: 'friend', lastSynced: new Date() },
      })
    } else if (existing.relation !== 'admin') {
      await this.db.user.update({
        where: { qq: userId },
        data: { relation: 'friend', lastSynced: new Date() },
      })
    }

    await this.cache.del(cacheKeyRegistry.buildKey('personnel', 'relation', String(userId)))
  }

  /** 群成员增加：创建成员关系记录，若为 stranger 则升级为 group_member。 */
  async onGroupIncrease(groupId: bigint, userId: bigint): Promise<void> {
    const now = new Date()

    const existing = await this.db.user.findUnique({
      where: { qq: userId },
      select: { relation: true },
    })

    if (!existing) {
      await this.db.user.create({
        data: { qq: userId, nickname: '', relation: 'group_member', lastSynced: now },
      })
    } else if (existing.relation !== 'admin' && existing.relation !== 'friend') {
      await this.db.user.update({
        where: { qq: userId },
        data: { relation: 'group_member', lastSynced: now },
      })
    }

    // upsert 成员关系
    await this.db.groupMembership.upsert({
      where: { userId_groupId: { userId, groupId } },
      create: {
        userId,
        groupId,
        card: '',
        role: 'member',
        joinTime: 0,
        lastActiveTime: 0,
        title: '',
        titleExpireTime: 0,
        level: '',
        isActive: true,
      },
      update: { isActive: true },
    })

    await this.cache.del(cacheKeyRegistry.buildKey('personnel', 'relation', String(userId)))
  }

  /** 群成员减少：标记成员关系为非活跃，重算 relation。 */
  async onGroupDecrease(groupId: bigint, userId: bigint, subType: string): Promise<void> {
    // 标记成员关系 is_active=false
    await this.db.groupMembership.updateMany({
      where: { userId, groupId },
      data: { isActive: false },
    })

    // 若 kick_me，标记群为非活跃
    if (subType === 'kick_me') {
      await this.db.group.updateMany({
        where: { groupId },
        data: { isActive: false },
      })
    }

    // 重算用户 relation
    const user = await this.db.user.findUnique({
      where: { qq: userId },
      select: { relation: true },
    })

    if (user && user.relation !== 'admin') {
      const hasMembership = await this.db.groupMembership.findFirst({
        where: { userId, isActive: true },
        select: { id: true },
      })
      const isFriend = user.relation === 'friend'
      const newRelation = computeRelation(user.relation, isFriend, hasMembership !== null)

      if (user.relation !== newRelation) {
        await this.db.user.update({ where: { qq: userId }, data: { relation: newRelation } })
      }
    }

    await this.cache.del(cacheKeyRegistry.buildKey('personnel', 'relation', String(userId)))
  }

  /** 群管理员变动：更新成员关系的 role 字段。 */
  async onGroupAdminChange(groupId: bigint, userId: bigint, subType: string): Promise<void> {
    const newRole = subType === 'set' ? 'admin' : 'member'
    await this.db.groupMembership.updateMany({
      where: { userId, groupId },
      data: { role: newRole },
    })
  }

  /** 群名片变更：更新成员关系的 card 字段。 */
  async onGroupCardChange(groupId: bigint, userId: bigint, cardNew: string): Promise<void> {
    await this.db.groupMembership.updateMany({
      where: { userId, groupId },
      data: { card: cardNew },
    })
  }

  /** 群成员信息更新（昵称等）。 */
  async onGroupMemberUpdate(
    groupId: bigint,
    userId: bigint,
    data: { nickname?: string },
  ): Promise<void> {
    if (data.nickname !== undefined) {
      await this.db.user.updateMany({
        where: { qq: userId },
        data: { nickname: data.nickname },
      })
    }
    // groupId is unused here but kept for interface compatibility
    void groupId
  }
}
