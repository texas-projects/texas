/** Settings 纯函数查询 —— Worker 与主进程共用，无 Redis 缓存层。 */

import type { MainPrismaClient } from '@/core/db.js'

// ── 类型定义 ──

export interface MinimalSettingSchema {
  key: string
  type: 'boolean' | 'number' | 'string' | 'enum'
  default: unknown
}

export interface SettingsQueryContext {
  db: MainPrismaClient
  schemaMap: ReadonlyMap<string, MinimalSettingSchema>
  group?: bigint | number
  user?: bigint | number
}

// ── 内部类型 ──

interface SettingsDbRow {
  key: string
  value: string
  value_type: string
}

// ── 公共函数 ──

/**
 * 从 DB 查询单项配置，未命中时回退 schema default。
 * 不使用 Redis 缓存，适合低频 Worker 调用。
 */
export async function getSettingValue<T = unknown>(
  key: string,
  ctx: SettingsQueryContext,
): Promise<T> {
  const schema = ctx.schemaMap.get(key)

  if (ctx.group !== undefined) {
    const scopeId = BigInt(ctx.group)
    const rows: SettingsDbRow[] = await ctx.db.$queryRaw`
      SELECT key, value, value_type FROM settings
      WHERE key = ${key} AND type = 'group'::settings_entry_type AND scope = ${scopeId}
      LIMIT 1
    `
    if (rows[0] !== undefined) {
      return _deserialize(rows[0].value, schema) as T
    }
  } else if (ctx.user !== undefined) {
    const scopeId = BigInt(ctx.user)
    const rows: SettingsDbRow[] = await ctx.db.$queryRaw`
      SELECT key, value, value_type FROM settings
      WHERE key = ${key} AND type = 'user'::settings_entry_type AND scope = ${scopeId}
      LIMIT 1
    `
    if (rows[0] !== undefined) {
      return _deserialize(rows[0].value, schema) as T
    }
  }

  if (schema !== undefined) return schema.default as T
  return undefined as T
}

// ── 私有函数 ──

/** 根据 Schema 类型反序列化字符串值。 */
function _deserialize(raw: string, schema?: MinimalSettingSchema): unknown {
  if (!schema) return raw
  switch (schema.type) {
    case 'boolean':
      return raw === 'true'
    case 'number':
      return Number(raw)
    default:
      return raw
  }
}
