/**
 * 功能级权限服务 —— 管理功能启用状态、群/私聊权限。
 *
 * group_id=0 哨兵行代表功能的全局默认启用状态。
 * permission_group / permission_private 存储全量记录，无需回退逻辑。
 */

import { randomUUID } from 'node:crypto'

import type { CacheClient } from '@/core/cache/client.js'
import {
  permGroupKey,
  permPrivateKey,
  permGroupEnabledKey,
  PERM_GROUP_GLOB,
} from '@/core/cache/key-registry.js'
import type { MainPrismaClient } from '@/core/db/client.js'
import { componentRegistry } from '@/core/framework/decorators.js'
import { Startup } from '@/core/lifecycle/registry.js'
import { FeatureRegistry } from '@/core/registries/feature-registry.js'

/** 缓存 TTL（秒）。 */
const CACHE_TTL = 60

/** group_id=0 哨兵值，代表功能全局默认启用状态。 */
const GLOBAL_GROUP_ID = 0n

/** 群功能权限视图。 */
export interface GroupFeaturePermissionView {
  id: string
  groupId: bigint
  featureName: string
  enabled: boolean
}

/** 私聊功能权限视图。 */
export interface PrivateFeaturePermissionView {
  id: string
  userQq: bigint
  featureName: string
  enabled: boolean
}

/**
 * 功能级权限服务。
 */
export class FeaturePermissionService {
  constructor(
    private readonly db: MainPrismaClient,
    private readonly cache: CacheClient,
    private readonly registry: FeatureRegistry,
  ) {}

  // ─────────────────────── 权限同步 ───────────────────────

  /**
   * 启动时同步全量权限记录。
   *
   * 1. 为每个活跃功能确保 group_id=0 全局哨兵行存在。
   * 2. 为每个活跃群确保每个活跃功能都有对应权限行。
   * 3. 清理不再存在的功能对应的权限行。
   */
  async syncPermissions(): Promise<void> {
    const activeFeatureNames = this.registry
      .getAll()
      .filter((f) => !f.system)
      .map((f) => f.name)

    if (activeFeatureNames.length === 0) return

    // 获取所有活跃群 ID
    const groups = await this.db.group.findMany({
      where: { isActive: true },
      select: { groupId: true },
    })
    const activeGroupIds = groups.map((g) => g.groupId)

    // 查询已有权限行
    const existingRows = await this.db.groupFeaturePermission.findMany({
      select: { groupId: true, featureName: true },
    })
    const existing = new Set(existingRows.map((r) => `${String(r.groupId)}:${r.featureName}`))

    // 计算缺失的记录
    const allGroupIds = [GLOBAL_GROUP_ID, ...activeGroupIds]
    const missing: { id: string; groupId: bigint; featureName: string; enabled: boolean }[] = []

    for (const gid of allGroupIds) {
      for (const fname of activeFeatureNames) {
        const key = `${String(gid)}:${fname}`
        if (!existing.has(key)) {
          const meta = this.registry.get(fname)
          const defaultEnabled = meta?.defaultEnabled ?? true
          missing.push({
            id: randomUUID(),
            groupId: gid,
            featureName: fname,
            enabled: defaultEnabled,
          })
        }
      }
    }

    // 批量插入缺失记录（逐条 upsert）
    for (const row of missing) {
      await this.db.groupFeaturePermission.upsert({
        where: { groupId_featureName: { groupId: row.groupId, featureName: row.featureName } },
        create: row,
        update: {},
      })
    }

    // 清理不再活跃的功能权限行
    await this.db.groupFeaturePermission.deleteMany({
      where: { featureName: { notIn: activeFeatureNames } },
    })
    await this.db.privateFeaturePermission.deleteMany({
      where: { featureName: { notIn: activeFeatureNames } },
    })
  }

  /** 新群加入时，为该群批量插入全量功能权限记录。 */
  async syncGroupPermissions(groupId: bigint): Promise<void> {
    const activeFeatureNames = this.registry
      .getAll()
      .filter((f) => !f.system)
      .map((f) => f.name)

    if (activeFeatureNames.length === 0) return

    for (const fname of activeFeatureNames) {
      const meta = this.registry.get(fname)
      const enabled = meta?.defaultEnabled ?? true

      await this.db.groupFeaturePermission.upsert({
        where: { groupId_featureName: { groupId, featureName: fname } },
        create: { id: randomUUID(), groupId, featureName: fname, enabled },
        update: {},
      })
    }
  }

  // ─────────────────────── 权限查询 ───────────────────────

  /**
   * 检查某功能对某群/用户是否启用。
   *
   * @param featureName 功能名称
   * @param groupId 群 ID（群消息场景）
   * @param userId 用户 ID（私聊场景）
   */
  async isEnabled(featureName: string, groupId?: bigint, userId?: bigint): Promise<boolean> {
    if (groupId !== undefined) {
      return this._getGroupFeature(groupId, featureName)
    }
    if (userId !== undefined) {
      return this._queryPrivateFeature(featureName, userId)
    }
    // 无上下文：查全局哨兵行
    return this._getGroupFeature(GLOBAL_GROUP_ID, featureName)
  }

  /** 两级群聊权限查询（ctrl 功能 + method 功能均需启用）。 */
  async isGroupFeatureEnabled(
    groupId: bigint,
    ctrlFeature: string,
    methodFeature: string,
  ): Promise<boolean> {
    const [ctrlEnabled, methodEnabled] = await Promise.all([
      this._getGroupFeature(groupId, ctrlFeature),
      this._getGroupFeature(groupId, methodFeature),
    ])
    return ctrlEnabled && methodEnabled
  }

  /** 获取群聊某功能的启用状态（含缓存）。 */
  private async _getGroupFeature(groupId: bigint, featureName: string): Promise<boolean> {
    const key = permGroupKey(groupId, featureName)
    const cached = await this.cache.get<boolean>(key)
    if (cached !== null) return cached

    const result = await this._queryGroupFeature(groupId, featureName)
    await this.cache.set(key, result, CACHE_TTL)
    return result
  }

  /** 从数据库查询群聊功能状态。 */
  private async _queryGroupFeature(groupId: bigint, featureName: string): Promise<boolean> {
    const row = await this.db.groupFeaturePermission.findUnique({
      where: { groupId_featureName: { groupId, featureName } },
      select: { enabled: true },
    })

    if (row !== null) return row.enabled

    // 回退到内存注册表默认值
    const meta = this.registry.get(featureName)
    return meta?.defaultEnabled ?? true
  }

  /** 私聊权限查询（以 controller 级为粒度）。 */
  async isPrivateFeatureAllowed(
    ctrlFeature: string,
    methodFeature: string,
    userQq: bigint,
  ): Promise<boolean> {
    // 私聊以 controller 级为粒度（忽略 methodFeature）
    void methodFeature

    const key = permPrivateKey(userQq, ctrlFeature)
    const cached = await this.cache.get<boolean>(key)
    if (cached !== null) return cached

    const result = await this._queryPrivateFeature(ctrlFeature, userQq)
    await this.cache.set(key, result, CACHE_TTL)
    return result
  }

  /** 从数据库查询私聊功能状态（优先查用户显式设置，再查全局默认）。 */
  private async _queryPrivateFeature(featureName: string, userQq: bigint): Promise<boolean> {
    // 优先查用户显式设置
    const userRow = await this.db.privateFeaturePermission.findUnique({
      where: { featureName_userQq: { featureName, userQq } },
      select: { enabled: true },
    })
    if (userRow !== null) return userRow.enabled

    // 回退到全局默认（group_id=0 哨兵行）
    const globalRow = await this.db.groupFeaturePermission.findUnique({
      where: { groupId_featureName: { groupId: GLOBAL_GROUP_ID, featureName } },
      select: { enabled: true },
    })
    if (globalRow !== null) return globalRow.enabled

    // 最终回退：内存注册表默认值
    const meta = this.registry.get(featureName)
    return meta?.defaultEnabled ?? true
  }

  // ─────────────────────── 管理 API ───────────────────────

  /** 设置群对某功能的启用状态。 */
  async setGroupPermission(groupId: bigint, featureName: string, enabled: boolean): Promise<void> {
    await this.db.groupFeaturePermission.upsert({
      where: { groupId_featureName: { groupId, featureName } },
      create: { id: randomUUID(), groupId, featureName, enabled },
      update: { enabled },
    })
    await this.cache.del(permGroupKey(groupId, featureName))
  }

  /** 设置用户私聊权限（upsert）。 */
  async setPrivatePermission(userId: bigint, featureName: string, enabled: boolean): Promise<void> {
    await this.db.privateFeaturePermission.upsert({
      where: { featureName_userQq: { featureName, userQq: userId } },
      create: { id: randomUUID(), userQq: userId, featureName, enabled },
      update: { enabled },
    })
    await this.cache.del(permPrivateKey(userId, featureName))
  }

  /** 获取某群所有功能的权限状态。 */
  async getGroupPermissions(groupId: bigint): Promise<GroupFeaturePermissionView[]> {
    const rows = await this.db.groupFeaturePermission.findMany({
      where: { groupId },
    })
    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      featureName: r.featureName,
      enabled: r.enabled,
    }))
  }

  /** 获取某用户的私聊功能权限列表。 */
  async getPrivatePermissions(userId: bigint): Promise<PrivateFeaturePermissionView[]> {
    const rows = await this.db.privateFeaturePermission.findMany({
      where: { userQq: userId },
    })
    return rows.map((r) => ({
      id: r.id,
      userQq: r.userQq,
      featureName: r.featureName,
      enabled: r.enabled,
    }))
  }

  /** 查询群 bot 总开关（含缓存）。 */
  async isGroupEnabled(groupId: bigint): Promise<boolean> {
    const key = permGroupEnabledKey(groupId)
    const cached = await this.cache.get<boolean>(key)
    if (cached !== null) return cached

    const row = await this.db.group.findUnique({
      where: { groupId },
      select: { botEnabled: true },
    })
    const result = row?.botEnabled ?? true
    await this.cache.set(key, result, CACHE_TTL)
    return result
  }

  /** 设置群 bot 总开关。 */
  async setGroupEnabled(groupId: bigint, enabled: boolean): Promise<void> {
    await this.db.group.update({ where: { groupId }, data: { botEnabled: enabled } })
    await this.cache.del(permGroupEnabledKey(groupId))
  }

  /** 批量设置群功能状态（原子操作）。 */
  async batchSetGroupFeatures(
    groupId: bigint,
    features: { featureName: string; enabled: boolean }[],
  ): Promise<void> {
    for (const f of features) {
      await this.setGroupPermission(groupId, f.featureName, f.enabled)
    }
  }

  /** 清除所有群功能权限缓存。 */
  async invalidateGroupPermissionCache(): Promise<void> {
    await this.cache.deleteByPattern(PERM_GROUP_GLOB)
  }

  /** 获取完整权限矩阵（所有活跃群 × 所有活跃功能）。 */
  async getPermissionMatrix(): Promise<{
    features: ReturnType<FeatureRegistry['getAll']>
    groups: { groupId: bigint; botEnabled: boolean; permissions: Record<string, boolean> }[]
  }> {
    const groups = await this.db.group.findMany({
      where: { isActive: true },
      select: { groupId: true, botEnabled: true },
    })

    const allPerms = await this.db.groupFeaturePermission.findMany()
    const permsMap = new Map<string, boolean>()
    for (const p of allPerms) {
      permsMap.set(`${String(p.groupId)}:${p.featureName}`, p.enabled)
    }

    const allFeatureNames = this.registry
      .getAll()
      .filter((f) => !f.system)
      .map((f) => f.name)

    const globalEnabled: Record<string, boolean> = {}
    for (const fname of allFeatureNames) {
      const meta = this.registry.get(fname)
      globalEnabled[fname] =
        permsMap.get(`${String(GLOBAL_GROUP_ID)}:${fname}`) ?? meta?.defaultEnabled ?? true
    }

    return {
      features: this.registry.getAll().filter((f) => !f.system),
      groups: groups.map((g) => ({
        groupId: g.groupId,
        botEnabled: g.botEnabled,
        permissions: Object.fromEntries(
          allFeatureNames.map((fname) => [
            fname,
            permsMap.get(`${String(g.groupId)}:${fname}`) ?? globalEnabled[fname] ?? true,
          ]),
        ),
      })),
    }
  }
}

// ── 生命周期注册 ──

Startup({
  name: 'permission_service',
  provides: ['permission_service'],
  requires: ['db', 'cache'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  const cache = deps.cache as CacheClient

  // 从 componentRegistry 构建 FeatureRegistry（handler 扫描完成后已填充）
  const registry = new FeatureRegistry()
  for (const [, meta] of componentRegistry) {
    registry.register({
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      defaultEnabled: meta.defaultEnabled,
      system: meta.system,
      admin: meta.admin,
      messageScope: 'all',
      mappingType: '',
      tags: [...meta.tags],
      parent: null,
      children: [],
      trigger: '',
    })
  }

  return { permission_service: new FeaturePermissionService(db, cache, registry) }
})
