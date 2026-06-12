/**
 * Worker 心跳中间件 —— 将 Worker 存活状态写入 Redis 供监控 API 查询。
 */

import type { Redis } from 'ioredis'

/**
 * BullMQ Worker 心跳中间件。
 *
 * 在任务处理前后向 Redis 写入带 TTL 的心跳键，监控 API 可据此判断 Worker 存活。
 *
 * 用法：
 * ```ts
 * const middleware = new WorkerHeartbeatMiddleware(redis, 'worker-1', 'aemeath:worker:heartbeat', 30_000)
 * await middleware.recordHeartbeat('daily-checkin')
 * const alive = await middleware.isAlive('worker-1')
 * ```
 */
export class WorkerHeartbeatMiddleware {
  constructor(
    private readonly redis: Redis,
    private readonly workerId: string,
    private readonly keyPrefix: string,
    private readonly defaultTtlMs: number,
  ) {}

  /**
   * 向 Redis 写入心跳时间戳，TTL 为 heartbeatTtlMs（毫秒转秒）。
   *
   * @param queueName - 当前处理的队列名称（写入 value 便于调试）
   * @param heartbeatTtlMs - 心跳过期时间（毫秒），默认使用构造器注入的 defaultTtlMs
   */
  async recordHeartbeat(queueName: string, heartbeatTtlMs?: number): Promise<void> {
    const ttl = heartbeatTtlMs ?? this.defaultTtlMs
    const key = `${this.keyPrefix}:${this.workerId}`
    const value = JSON.stringify({
      workerId: this.workerId,
      queueName,
      timestamp: Date.now(),
    })
    const ttlSeconds = Math.ceil(ttl / 1000)
    await this.redis.set(key, value, 'EX', ttlSeconds)
  }

  /**
   * 判断指定 Worker 是否存活（心跳键是否存在）。
   *
   * @param workerId - 要检查的 Worker ID
   * @param _timeoutMs - 超时阈值（毫秒），当前实现通过 Redis TTL 机制自动过期，此参数保留接口兼容
   * @returns Worker 存活返回 true，否则返回 false
   */
  async isAlive(workerId: string, _timeoutMs?: number): Promise<boolean> {
    const key = `${this.keyPrefix}:${workerId}`
    const exists = await this.redis.exists(key)
    return exists === 1
  }
}
