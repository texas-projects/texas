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

import type { Redis } from 'ioredis'

import { SettingsPermissionChecker } from './permission.js'
import { buildSchemaMap, cleanOrphanKeys } from './schema.js'
import { SettingsService } from './service.js'

import type { CacheClient } from '@/core/cache/client.js'
import type { MainPrismaClient } from '@/core/db/client.js'
import { Startup, Shutdown } from '@/core/lifecycle/registry.js'
import { PersonnelService } from '@/core/personnel/index.js'

Startup({
  name: 'settings',
  provides: ['settings', 'settings_checker', 'personnelService'],
  requires: ['db', 'cache_redis', 'cache'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  const redis = deps.cache_redis as Redis
  const cache = deps.cache as CacheClient

  // PersonnelService 未通过 Startup 注册，此处直接实例化
  const personnelService = new PersonnelService(db, cache)

  const schemaMap = buildSchemaMap()
  await cleanOrphanKeys(db, schemaMap)

  const settings = new SettingsService(db, redis, schemaMap)
  const settingsChecker = new SettingsPermissionChecker(settings, personnelService, schemaMap)

  return { settings, settings_checker: settingsChecker, personnelService }
})

Shutdown({ name: 'settings' })(async (): Promise<void> => {
  // 无需清理资源，Redis/DB 连接由基础设施层管理
})
