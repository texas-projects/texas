import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db/client.js'
import { SettingNode, settingNodeRegistry } from '@/core/settings/decorators.js'
import { buildSchemaMap } from '@/core/settings/schema.js'
import { SettingsService } from '@/core/settings/service.js'

// ── Mock 工厂 ──

function createMockRedis(values: Record<string, string | null> = {}) {
  const store = { ...values }
  const sets: Record<string, Set<string>> = {}

  return {
    get: vi.fn((key: string) => Promise.resolve(store[key] ?? null)),
    set: vi.fn((key: string, val: string) => {
      store[key] = val
      return Promise.resolve('OK')
    }),
    del: vi.fn((...keys: string[]) => {
      for (const k of keys) delete store[k]
      return Promise.resolve(keys.length)
    }),
    sismember: vi.fn((setKey: string, member: string) =>
      Promise.resolve(sets[setKey]?.has(member) ? 1 : 0),
    ),
    sadd: vi.fn((setKey: string, member: string) => {
      sets[setKey] ??= new Set()
      sets[setKey].add(member)
      return Promise.resolve(1)
    }),
    pipeline: vi.fn(() => ({
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    _store: store,
    _sets: sets,
  } as unknown as Redis & { _store: Record<string, string>; _sets: Record<string, Set<string>> }
}

function createMockDb(
  rows: Record<string, { key: string; value: string; value_type: string }[]> = {},
) {
  return {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      // 根据 SQL 内容简单路由
      const sql = strings.join('?')
      if (sql.includes("type = 'default'")) {
        const key = values[0] as string
        return Promise.resolve(rows[key] ?? rows.default ?? [])
      }
      if (sql.includes("type = 'group'")) {
        const key = values[0] as string
        return Promise.resolve(rows[`group:${key}`] ?? [])
      }
      return Promise.resolve([])
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as MainPrismaClient
}

// ── 测试 ──

class TestFeature {
  handle(): void {}
}

beforeEach(() => {
  settingNodeRegistry.clear()
})

function createService(
  dbRows: Parameters<typeof createMockDb>[0] = {},
  redisValues: Record<string, string | null> = {},
) {
  SettingNode('feature.enabled', { type: 'boolean', default: true })(TestFeature)
  SettingNode('feature.permission', {
    type: 'enum',
    default: 'ANYONE',
    enumOptions: { ANYONE: 0, ADMIN: 100 },
  })(TestFeature)
  SettingNode('feature.count', { type: 'number', default: 5 })(TestFeature)
  SettingNode('feature.label', { type: 'string', default: 'hello' })(TestFeature)

  const schemaMap = buildSchemaMap()
  const redis = createMockRedis(redisValues)
  const db = createMockDb(dbRows)

  return { service: new SettingsService(db, redis, schemaMap), redis, db }
}

describe('SettingsService.get', () => {
  it('Redis 命中时直接返回反序列化值', async () => {
    const { service } = createService({}, { 'settings:group:99:feature.enabled': 'false' })
    const result = await service.get<boolean>('feature.enabled', { group: 99n })
    expect(result).toBe(false)
  })

  it('Redis 为 __NULL__ 时回退到 Schema default', async () => {
    settingNodeRegistry.clear()
    SettingNode('feature.enabled', { type: 'boolean', default: true })(TestFeature)
    const schemaMap = buildSchemaMap()
    const redis = createMockRedis({
      'settings:group:99:feature.enabled': '__NULL__',
    })
    const db = createMockDb()
    const service = new SettingsService(db, redis, schemaMap)

    const result = await service.get<boolean>('feature.enabled', { group: 99n })
    expect(result).toBe(true) // Schema default
  })

  it('DB 无记录时回退到 Schema default', async () => {
    settingNodeRegistry.clear()
    SettingNode('feature.enabled', { type: 'boolean', default: true })(TestFeature)
    const schemaMap = buildSchemaMap()
    const redis = createMockRedis()
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    } as unknown as MainPrismaClient

    const service = new SettingsService(db, redis, schemaMap)
    const result = await service.get<boolean>('feature.enabled', { group: 99n })
    expect(result).toBe(true) // Schema default
  })

  it('number 类型正确反序列化', async () => {
    // 无 scope 时直接回退到 Schema default（default scope 已移除）
    const { service } = createService({}, { 'settings:group:99:feature.count': '42' })
    const result = await service.get<number>('feature.count', { group: 99n })
    expect(result).toBe(42)
  })

  it('enum 类型返回标签字符串', async () => {
    // 无 scope 时直接回退到 Schema default（default scope 已移除）
    const { service } = createService({}, { 'settings:group:99:feature.permission': 'ADMIN' })
    const result = await service.get<string>('feature.permission', { group: 99n })
    expect(result).toBe('ADMIN')
  })
})

describe('SettingsService.set', () => {
  it('写入有效 boolean 值并失效缓存', async () => {
    const { service, db, redis } = createService()
    await service.set('feature.enabled', false, { group: 100n })

    expect(db.$executeRaw).toHaveBeenCalled()
    expect(redis.del).toHaveBeenCalledWith('settings:group:100:feature.enabled')
  })

  it('写入无效 enum 标签应抛出异常', async () => {
    const { service } = createService()
    await expect(
      service.set('feature.permission', 'INVALID_LABEL', { group: 100n }),
    ).rejects.toThrow('无效枚举值')
  })

  it('写入未知 key 应抛出异常', async () => {
    const { service } = createService()
    await expect(service.set('unknown.key', true, { group: 100n })).rejects.toThrow('未知配置项')
  })

  it('写入超长字符串应抛出异常', async () => {
    const { service } = createService()
    await expect(service.set('feature.label', 'x'.repeat(513), { group: 100n })).rejects.toThrow()
  })
})

describe('SettingsService.resolveEnum', () => {
  it('正确将枚举标签映射为数值', () => {
    const { service } = createService()
    expect(service.resolveEnum('feature.permission', 'ANYONE')).toBe(0)
    expect(service.resolveEnum('feature.permission', 'ADMIN')).toBe(100)
  })

  it('无效标签应抛出异常', () => {
    const { service } = createService()
    expect(() => service.resolveEnum('feature.permission', 'UNKNOWN')).toThrow('无效枚举标签')
  })

  it('非 enum 类型 key 应抛出异常', () => {
    const { service } = createService()
    expect(() => service.resolveEnum('feature.enabled', 'true')).toThrow('不是 enum 类型')
  })
})

describe('SettingsService.getSchemas', () => {
  it('无前缀返回全部 schema', () => {
    const { service } = createService()
    const schemas = service.getSchemas()
    expect(schemas.length).toBeGreaterThan(0)
  })

  it('前缀过滤返回子集', () => {
    const { service } = createService()
    const schemas = service.getSchemas('feature.')
    expect(schemas.every((s) => s.key.startsWith('feature.'))).toBe(true)
  })
})
