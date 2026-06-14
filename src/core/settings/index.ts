/**
 * Settings 模块入口 —— 统一导出 + Startup 生命周期注册。
 */

export { SettingNode, settingNodeRegistry } from './decorators.js'
export type { SettingNodeMeta, SettingNodeOptions, SettingValueType } from './decorators.js'
export { buildSchemaMap, cleanOrphanKeys } from './schema.js'
export type { SettingNodeSchema } from './schema.js'
export { SettingsService } from './service.js'
export type { SettingsScope } from './service.js'
export { SettingsPermissionChecker } from './permission.js'
export type { MinimalSettingSchema, SettingsQueryContext } from './query.js'
export { getSettingValue } from './query.js'

import type { Redis } from 'ioredis'

import { SettingsPermissionChecker } from './permission.js'
import { buildSchemaMap, cleanOrphanKeys } from './schema.js'
import { SettingsService } from './service.js'

import type { MainPrismaClient } from '@/core/db.js'
import { Service, Inject, Provide, Startup } from '@/core/lifecycle/decorators/index.js'
import type { PersonnelService } from '@/core/personnel/index.js'

@Service({ name: 'settings_bootstrap' })
export class SettingsBootstrap {
  /** 注入主数据库 */
  @Inject('db')
  db!: MainPrismaClient

  /** 注入缓存 Redis 实例 */
  @Inject('cache_redis')
  redis!: Redis

  /** 注入人员服务 */
  @Inject('personnelService')
  personnelService!: PersonnelService

  /** 对外暴露 settings 服务实例 */
  @Provide('settings')
  settings!: SettingsService

  /** 对外暴露 settings_checker 服务实例 */
  @Provide('settings_checker')
  settingsChecker!: SettingsPermissionChecker

  @Startup
  async start(): Promise<void> {
    const schemaMap = buildSchemaMap()
    await cleanOrphanKeys(this.db, schemaMap)

    this.settings = new SettingsService(this.db, this.redis, schemaMap)
    this.settingsChecker = new SettingsPermissionChecker(
      this.settings,
      this.personnelService,
      schemaMap,
    )
  }
}
