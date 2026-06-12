// tests/unit/core/registries/cache-key.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

import { CacheKeyRegistry } from '@/core/redis/registry.js'

describe('CacheKeyRegistry', () => {
  let registry: CacheKeyRegistry

  beforeEach(() => {
    registry = new CacheKeyRegistry()
  })

  it('注册并获取 key 定义', () => {
    registry.register({
      namespace: 'personnel',
      name: 'sync_status',
      build: () => 'aemeath:personnel:sync_status',
    })
    const def = registry.get('personnel', 'sync_status')
    expect(def).toBeDefined()
    expect(def!.build()).toBe('aemeath:personnel:sync_status')
  })

  it('buildKey 正确调用 build 函数', () => {
    registry.register({
      namespace: 'checkin',
      name: 'daily',
      build: (groupId, dateStr) => `aemeath:checkin:${groupId}:${dateStr}`,
    })
    expect(registry.buildKey('checkin', 'daily', '123', '2026-01-01')).toBe(
      'aemeath:checkin:123:2026-01-01',
    )
  })

  it('获取不存在的 key 返回 undefined', () => {
    expect(registry.get('unknown', 'key')).toBeUndefined()
  })

  it('重复注册相同 namespace+name 抛出错误', () => {
    const def = { namespace: 'ns', name: 'k', build: () => 'x' }
    registry.register(def)
    expect(() => {
      registry.register(def)
    }).toThrow()
  })

  it('getAll 返回所有已注册定义', () => {
    registry.register({ namespace: 'a', name: 'b', build: () => 'x' })
    registry.register({ namespace: 'c', name: 'd', build: () => 'y' })
    expect(registry.getAll()).toHaveLength(2)
  })
})
