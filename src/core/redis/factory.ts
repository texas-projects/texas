/** ioredis 实例工厂与 BullMQ 连接解析。 */

import { logger } from '@logger'
import type { ConnectionOptions } from 'bullmq'
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

/** 将 redis:// URL 解析为 BullMQ ConnectionOptions。 */
export function createBullMQConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl)
  const host = url.hostname
  const port = url.port ? parseInt(url.port, 10) : 6379
  const password = url.password ? decodeURIComponent(url.password) : undefined
  const dbStr = url.pathname.replace(/^\//, '')
  const db = dbStr !== '' ? parseInt(dbStr, 10) : 0
  const conn: ConnectionOptions = { host, port, db }
  if (password) conn.password = password
  if (url.protocol === 'rediss:') conn.tls = {}
  return conn
}
