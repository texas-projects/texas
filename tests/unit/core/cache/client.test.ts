import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RedisStore } from '@/core/redis/store.js'

/** 创建一个 mock Redis 实例，包含 RedisStore 使用的所有方法。 */
function createMockRedis() {
  return {
    get: vi.fn(),
    setex: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    scan: vi.fn(),
  }
}

type MockRedis = ReturnType<typeof createMockRedis>

describe('RedisStore', () => {
  let mockRedis: MockRedis
  let cache: RedisStore

  beforeEach(() => {
    mockRedis = createMockRedis()
    // RedisStore 接受 Redis 实例，使用 mock 代替
    cache = new RedisStore(mockRedis as unknown as Redis, 300)
  })

  describe('get', () => {
    it('键存在时应当返回反序列化后的 JSON 对象', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ id: 1, name: '测试' }))

      const result = await cache.get<{ id: number; name: string }>('test:key')

      expect(result).toEqual({ id: 1, name: '测试' })
      expect(mockRedis.get).toHaveBeenCalledWith('test:key')
    })

    it('键不存在时应当返回 null', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await cache.get('missing:key')

      expect(result).toBeNull()
    })

    it('值无法 JSON 解析时应当返回原始字符串', async () => {
      mockRedis.get.mockResolvedValue('plain-string')

      const result = await cache.get<string>('raw:key')

      expect(result).toBe('plain-string')
    })
  })

  describe('set', () => {
    it('应当使用 SETEX 写入 JSON 序列化后的值', async () => {
      mockRedis.setex.mockResolvedValue('OK')

      await cache.set('test:key', { score: 42 })

      expect(mockRedis.setex).toHaveBeenCalledWith('test:key', 300, JSON.stringify({ score: 42 }))
    })

    it('应当使用自定义 TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK')

      await cache.set('test:key', 'value', 600)

      expect(mockRedis.setex).toHaveBeenCalledWith('test:key', 600, JSON.stringify('value'))
    })

    it('TTL 为 0 时应当使用 SET（无过期）', async () => {
      mockRedis.set.mockResolvedValue('OK')

      await cache.set('persist:key', 'forever', 0)

      expect(mockRedis.set).toHaveBeenCalledWith('persist:key', JSON.stringify('forever'))
      expect(mockRedis.setex).not.toHaveBeenCalled()
    })
  })

  describe('del', () => {
    it('应当调用 Redis DEL', async () => {
      mockRedis.del.mockResolvedValue(1)

      await cache.del('remove:key')

      expect(mockRedis.del).toHaveBeenCalledWith('remove:key')
    })
  })

  describe('exists', () => {
    it('键存在时应当返回 true', async () => {
      mockRedis.exists.mockResolvedValue(1)

      const result = await cache.exists('exist:key')

      expect(result).toBe(true)
    })

    it('键不存在时应当返回 false', async () => {
      mockRedis.exists.mockResolvedValue(0)

      const result = await cache.exists('missing:key')

      expect(result).toBe(false)
    })
  })

  describe('incr', () => {
    it('应当返回自增后的值', async () => {
      mockRedis.incr.mockResolvedValue(5)

      const result = await cache.incr('counter:key')

      expect(result).toBe(5)
      expect(mockRedis.incr).toHaveBeenCalledWith('counter:key')
    })
  })

  describe('expire', () => {
    it('应当调用 Redis EXPIRE', async () => {
      mockRedis.expire.mockResolvedValue(1)

      await cache.expire('ttl:key', 60)

      expect(mockRedis.expire).toHaveBeenCalledWith('ttl:key', 60)
    })
  })

  describe('getOrSet', () => {
    it('缓存命中时应当直接返回缓存值，不调用 factory', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ cached: true }))
      const factory = vi.fn()

      const result = await cache.getOrSet('hit:key', factory)

      expect(result).toEqual({ cached: true })
      expect(factory).not.toHaveBeenCalled()
    })

    it('缓存未命中时应当调用 factory 并写入缓存', async () => {
      mockRedis.get.mockResolvedValue(null)
      mockRedis.setex.mockResolvedValue('OK')
      const factory = vi.fn().mockResolvedValue({ fresh: true })

      const result = await cache.getOrSet('miss:key', factory, 120)

      expect(result).toEqual({ fresh: true })
      expect(factory).toHaveBeenCalledOnce()
      expect(mockRedis.setex).toHaveBeenCalledWith('miss:key', 120, JSON.stringify({ fresh: true }))
    })
  })

  describe('deleteByPattern', () => {
    it('应当使用 SCAN 循环删除匹配的键', async () => {
      // 第一次 SCAN 返回部分键和非零 cursor
      mockRedis.scan.mockResolvedValueOnce(['42', ['aemeath:perm:1', 'aemeath:perm:2']])
      // 第二次 SCAN 返回剩余键和 cursor=0（结束）
      mockRedis.scan.mockResolvedValueOnce(['0', ['aemeath:perm:3']])
      mockRedis.del.mockResolvedValue(2).mockResolvedValueOnce(2)
      mockRedis.del.mockResolvedValueOnce(1)

      const deleted = await cache.deleteByPattern('aemeath:perm:*')

      expect(deleted).toBe(3)
      expect(mockRedis.scan).toHaveBeenCalledTimes(2)
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'aemeath:perm:*', 'COUNT', 100)
      expect(mockRedis.del).toHaveBeenCalledWith('aemeath:perm:1', 'aemeath:perm:2')
      expect(mockRedis.del).toHaveBeenCalledWith('aemeath:perm:3')
    })

    it('无匹配键时应当返回 0', async () => {
      mockRedis.scan.mockResolvedValueOnce(['0', []])

      const deleted = await cache.deleteByPattern('nonexistent:*')

      expect(deleted).toBe(0)
      expect(mockRedis.del).not.toHaveBeenCalled()
    })
  })
})
