/**
 * Settings Schema Map 构建与启动清理。
 */

import type { SettingNodeMeta } from './decorators.js'
import { settingNodeRegistry } from './decorators.js'

import type { MainPrismaClient } from '@/core/db.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'

// ── 类型定义 ──

export interface SettingNodeSchema {
  key: string
  type: 'boolean' | 'number' | 'string' | 'enum'
  default: unknown
  description: string
  enumOptions?: Record<string, number>
  scope: 'all' | 'group' | 'user'
  owner: string
  ownerDisplayName: string
  category: 'permission' | 'config'
}

// ── 内置系统配置项 ──

const BUILTIN_NODES: SettingNodeMeta[] = [
  {
    key: 'bot.enabled',
    type: 'boolean',
    default: true,
    description: 'Bot 总开关（群级）',
    scope: 'group',
    category: 'permission',
  },
]

// ── Schema Map 构建 ──

/**
 * 从 settingNodeRegistry + handlerRegistry 构建只读 Schema Map。
 * 同时注入内置系统配置项。
 */
export function buildSchemaMap(): ReadonlyMap<string, SettingNodeSchema> {
  const map = new Map<string, SettingNodeSchema>()

  // 内置节点（无 owner，标记为 __system__，显示名称为「系统」）
  for (const node of BUILTIN_NODES) {
    map.set(node.key, { ...node, owner: '__system__', ownerDisplayName: '系统' })
  }

  // 遍历 settingNodeRegistry，关联 Component 名称与显示名称
  for (const [target, nodes] of settingNodeRegistry) {
    const ownerName = findComponentName(target) ?? '__unknown__'
    const ownerEntry = handlerRegistry.get(ownerName)
    const ownerDisplayName = ownerEntry?.meta.displayName ?? ownerName
    for (const node of nodes) {
      map.set(node.key, { ...node, owner: ownerName, ownerDisplayName })
    }
  }

  return map
}

/**
 * 根据装饰器目标类查找对应的 Component 名称。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function findComponentName(target: Function): string | undefined {
  for (const entry of handlerRegistry.values()) {
    if (entry.meta.target === target) return entry.meta.name
  }
  return undefined
}

// ── 启动清理 ──

/**
 * 启动时清理 DB 中已无对应 Schema 的废弃配置行。
 */
export async function cleanOrphanKeys(
  db: MainPrismaClient,
  schemaMap: ReadonlyMap<string, SettingNodeSchema>,
  logger?: { info: (msg: string) => void },
): Promise<void> {
  const rows: { key: string }[] = await db.$queryRaw`
    SELECT DISTINCT key FROM settings
  `
  const dbKeys = rows.map((r) => r.key)
  const schemaKeys = new Set(schemaMap.keys())
  const orphans = dbKeys.filter((k) => !schemaKeys.has(k))
  if (orphans.length > 0) {
    await db.$executeRaw`DELETE FROM settings WHERE key = ANY(${orphans}::text[])`
    logger?.info(`[settings] 清理废弃配置项: ${orphans.join(', ')}`)
  }
}
