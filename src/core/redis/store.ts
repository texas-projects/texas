/**
 * Redis 数据存储封装 —— 提供 JSON 序列化、TTL 管理、模式删除等常用操作。
 */

import type { Redis } from 'ioredis'

export class RedisStore {
  private readonly redis: Redis
  private readonly defaultTtl: number

  constructor(redis: Redis, defaultTtl = 300) {
    this.redis = redis
    this.defaultTtl = defaultTtl
  }

  /** 从缓存获取值，自动 JSON 反序列化；键不存在时返回 null。 */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as T
    }
  }

  /** 写入缓存，自动 JSON 序列化，使用 SETEX 设置过期时间。 */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const seconds = ttl ?? this.defaultTtl
    const serialized = JSON.stringify(value)
    if (seconds > 0) {
      await this.redis.setex(key, seconds, serialized)
    } else {
      await this.redis.set(key, serialized)
    }
  }

  /** 删除指定键。 */
  async del(key: string): Promise<void> {
    await this.redis.del(key)
  }

  /** 检查键是否存在。 */
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key)
    return result === 1
  }

  /** 自增键的值，返回自增后的结果。 */
  async incr(key: string): Promise<number> {
    return this.redis.incr(key)
  }

  /** 设置键的过期时间（秒）。 */
  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds)
  }

  /**
   * 从缓存获取值；若未命中，则调用 factory 生成值，写入缓存后返回。
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const result = await factory()
    await this.set(key, result, ttl)
    return result
  }

  /**
   * 按 glob 模式批量删除匹配的键（使用 SCAN 迭代，避免 KEYS 阻塞）。
   *
   * @returns 删除的键数量
   */
  async deleteByPattern(pattern: string): Promise<number> {
    let cursor = '0'
    let deleted = 0
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys)
      }
    } while (cursor !== '0')
    return deleted
  }
}
