/**
 * 主进程端 RPC 消费者 —— 从 Redis 队列取请求，委托已注册 handler 执行，响应写回 Redis。
 */

import type { Redis } from 'ioredis'

import { logger, type Logger } from '../logging/setup.js'
import { rpcHandlerExecSeconds, rpcInflight, rpcRegisteredHandlers } from '../monitoring/metrics.js'
import { createRedis } from '../utils/redis-factory.js'

import { rpcRequestQueueKey, rpcResponseChannelKey } from './keys.js'
import type { RPCRequest, RPCResponse } from './models.js'

/** 自定义 action handler 类型：接收 params dict，返回任意可序列化结果。 */
export type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>

/** 并发 handler 数量上限（背压保护）。 */
const DEFAULT_MAX_CONCURRENCY = 64

/**
 * 在主进程事件循环中运行的通用 RPC 请求消费者。
 *
 * 使用 BLPOP 阻塞式从 Redis List 取请求，
 * 调用已注册的 handler 执行，
 * 结果通过 PUBLISH 返回给 Worker 端的 Pub/Sub 订阅者。
 *
 * 特性：
 * - start() 幂等，多次调用安全
 * - 停机时等待所有 in-flight handler 完成
 * - 每个请求受 RPCRequest.timeout 约束
 * - 并发 handler 数量受 maxConcurrency 限制（背压）
 */
export class RPCConsumer {
  private readonly _redis: Redis
  private readonly _pub: Redis
  private readonly _handlers = new Map<string, ActionHandler>()
  private _running = false
  private _stopSignal = false
  private _inflight = 0
  private readonly _maxConcurrency: number
  private readonly _log: Logger = logger.child({ name: 'RPCConsumer' })
  /** 用于等待所有 inflight 请求完成。 */
  private _drainResolve: (() => void) | undefined

  constructor(redisUrl: string, maxConcurrency: number = DEFAULT_MAX_CONCURRENCY) {
    this._redis = createRedis(redisUrl, { lazyConnect: false })
    this._pub = createRedis(redisUrl, { lazyConnect: false })
    this._maxConcurrency = maxConcurrency
  }

  /**
   * 注册 action handler。
   *
   * 若 action 已有 handler，覆盖原有注册并打印警告。
   */
  registerHandler(action: string, handler: ActionHandler): void {
    if (this._handlers.has(action)) {
      this._log.warn(`RPC handler 重复注册，将覆盖原有 handler: ${action}`)
    }
    this._handlers.set(action, handler)
    rpcRegisteredHandlers.set(this._handlers.size)
    this._log.debug(`RPC handler 已注册: ${action}`)
  }

  /**
   * 启动消费循环（后台异步循环）。幂等，重复调用无副作用。
   */
  async start(): Promise<void> {
    if (this._running) {
      this._log.debug('RPC 消费者已在运行，跳过重复启动')
      return
    }
    this._running = true
    this._stopSignal = false
    this._log.info('RPC 消费者已启动')
    // 以后台形式运行，不等待
    void this._consumeLoop()
  }

  /**
   * 停止消费循环，等待所有 in-flight 请求完成后关闭 Redis 连接。
   */
  async stop(): Promise<void> {
    this._stopSignal = true

    // 等待所有 inflight 请求完成
    if (this._inflight > 0) {
      this._log.info(`等待 in-flight RPC 请求完成 (count=${String(this._inflight)})`)
      await new Promise<void>((resolve) => {
        this._drainResolve = resolve
      })
    }

    this._redis.disconnect()
    this._pub.disconnect()
    this._running = false
    this._log.info('RPC 消费者已停止')
  }

  /** 主消费循环：BLPOP → 并发处理 → PUBLISH 响应。 */
  private async _consumeLoop(): Promise<void> {
    const queueKey = rpcRequestQueueKey()
    while (!this._stopSignal) {
      try {
        // BLPOP timeout=1 便于响应 stop 信号
        const result = await this._redis.blpop(queueKey, 1)
        if (result === null) continue

        const [, raw] = result
        // 背压保护：超过最大并发时丢弃并记录警告
        if (this._inflight >= this._maxConcurrency) {
          this._log.warn(`背压限制已达 ${String(this._maxConcurrency)}，丢弃请求`)
          continue
        }

        // 异步处理，不阻塞消费循环
        this._inflight++
        rpcInflight.set(this._inflight)

        void this._handleRequest(raw).finally(() => {
          this._inflight--
          rpcInflight.set(this._inflight)
          // 如果正在 drain 且已清空，通知等待方
          if (this._stopSignal && this._inflight === 0 && this._drainResolve) {
            this._drainResolve()
            this._drainResolve = undefined
          }
        })
      } catch (err) {
        // _stopSignal 可能在异步过程中被 stop() 改变
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this._stopSignal) break
        this._log.error({ err }, 'RPC 消费循环异常')
        // 防止异常风暴
        await new Promise<void>((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  /** 解析并处理单个 RPC 请求，将结果 PUBLISH 到响应通道。 */
  private async _handleRequest(raw: string): Promise<void> {
    let req: RPCRequest
    try {
      req = JSON.parse(raw) as RPCRequest
    } catch {
      this._log.warn(`RPC 请求解析失败: ${raw.slice(0, 200)}`)
      return
    }

    const rpcResp = await this._execute(req)
    const respChannel = rpcResponseChannelKey(req.request_id)
    try {
      await this._pub.publish(respChannel, JSON.stringify(rpcResp))
    } catch (err) {
      this._log.error({ err }, `RPC 响应发布失败 (action=${req.action})`)
    }
  }

  /**
   * 执行 RPC 请求：查找已注册 handler，未注册则返回错误。受 req.timeout 约束。
   */
  private async _execute(req: RPCRequest): Promise<RPCResponse> {
    const handler = this._handlers.get(req.action)
    if (handler === undefined) {
      this._log.warn(`RPC 未注册的 action: ${req.action}`)
      return {
        request_id: req.request_id,
        success: false,
        error: `未注册的 action: ${req.action}`,
      }
    }

    const t0 = Date.now()
    try {
      const result = await Promise.race([
        handler(req.params),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(new Error(`handler 执行超时（>${String(req.timeout)}s）`))
          }, req.timeout * 1000),
        ),
      ])
      const elapsed = (Date.now() - t0) / 1000
      rpcHandlerExecSeconds.labels({ action: req.action }).observe(elapsed)

      const data: Record<string, unknown> =
        typeof result === 'object' && result !== null && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result }

      return { request_id: req.request_id, success: true, data }
    } catch (err) {
      const elapsed = (Date.now() - t0) / 1000
      rpcHandlerExecSeconds.labels({ action: req.action }).observe(elapsed)
      const message = err instanceof Error ? err.message : String(err)
      this._log.warn(`RPC 请求执行失败 (action=${req.action}): ${message}`)
      return {
        request_id: req.request_id,
        success: false,
        error: message,
      }
    }
  }
}
