/** ioredis 实例工厂。 */

import { logger } from '@logger'
import { Redis, type RedisOptions } from 'ioredis'

/** 创建一个新的 ioredis Redis 实例，并将 error 事件路由到 Pino。 */
export function createRedis(url: string, opts?: RedisOptions): Redis {
  const redis = new Redis(url, { enableOfflineQueue: false, ...opts })
  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Redis 连接错误')
  })
  return redis
}

/**
 * 预检 Redis 连接是否可用，不可用时立即抛出。
 *
 * 使用 lazyConnect + retryStrategy:null 确保第一次连接失败时 Promise 立即 reject，
 * 而不是进入 ioredis 的默认无限重试循环。
 */
export async function checkRedisReachable(url: string, name: string): Promise<void> {
  const redis = new Redis(url, { lazyConnect: true, retryStrategy: () => null })
  try {
    await redis.connect()
  } catch (err) {
    throw new Error(`${name} 连接失败: ${String(err)}`, { cause: err })
  } finally {
    redis.disconnect()
  }
}
