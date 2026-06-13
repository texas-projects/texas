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
import { Startup, Shutdown } from '@/core/lifecycle/registry.js'
import type { PersonnelService } from '@/core/personnel/index.js'

Startup({
  name: 'settings',
  provides: ['settings', 'settings_checker'],
  requires: ['db', 'cache_redis', 'personnelService'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const db = deps.db as MainPrismaClient
  const redis = deps.cache_redis as Redis
  const personnelService = deps.personnelService as PersonnelService

  const schemaMap = buildSchemaMap()
  await cleanOrphanKeys(db, schemaMap)

  const settings = new SettingsService(db, redis, schemaMap)
  const settingsChecker = new SettingsPermissionChecker(settings, personnelService, schemaMap)

  return { settings, settings_checker: settingsChecker }
})

Shutdown({ name: 'settings' })(async (): Promise<void> => {
  // 无需清理资源，Redis/DB 连接由基础设施层管理
})
