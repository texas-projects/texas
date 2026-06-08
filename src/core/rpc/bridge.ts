/**
 * Worker 端通用 RPC 桥接器 —— 通过 Redis Pub/Sub 桥接主进程的 RPCConsumer。
 *
 * Worker 运行在独立进程（BullMQ Processor），
 * 本模块使用同步风格的 ioredis 客户端，
 * 向 Worker 暴露简洁的跨进程调用接口，返回通用 RPCResponse。
 */

import { randomUUID } from 'node:crypto'

import type { Redis } from 'ioredis'

import { rpcRequestQueueKey, rpcResponseChannelKey } from './keys.js'
import type { RPCRequest, RPCResponse } from './models.js'

import { createRedis } from '@/core/utils/redis-factory.js'

/** RPC 超时裕量（毫秒）：覆盖网络延迟 + 主进程调度耗时。 */
const TIMEOUT_MARGIN_MS = 5_000

/** Pub/Sub 消息轮询间隔（毫秒）。 */
const POLL_INTERVAL_MS = 100

/**
 * Worker 端的通用跨进程 RPC 桥接器。
 *
 * 通过 Redis List（请求队列）+ Pub/Sub（响应通道）实现 RPC，
 * 返回通用 RPCResponse，不依赖任何协议特定模型。
 */
export class RPCBridge {
  private readonly _redis: Redis
  private readonly _sub: Redis

  constructor(redisUrl: string) {
    this._redis = createRedis(redisUrl, { lazyConnect: false })
    // 订阅专用连接（ioredis subscribe 模式下不能执行普通命令）
    this._sub = createRedis(redisUrl, { lazyConnect: false })
  }

  /**
   * 通过 Redis RPC 调用主进程注册的 handler。
   *
   * 先订阅响应通道再入队请求，避免响应先于订阅到达而丢失。
   *
   * @param action - 注册在 RPCConsumer 的 action 名称
   * @param params - 传递给 handler 的参数字典
   * @param timeoutMs - 等待响应的超时时间（毫秒），默认 30s
   */
  async call(
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<RPCResponse> {
    const requestId = randomUUID().replace(/-/g, '')
    const req: RPCRequest = {
      request_id: requestId,
      action,
      params,
      timeout: timeoutMs / 1000,
    }

    const respChannel = rpcResponseChannelKey(requestId)
    const deadline = Date.now() + timeoutMs + TIMEOUT_MARGIN_MS

    return new Promise<RPCResponse>((resolve) => {
      let resolved = false
      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout | undefined

      const cleanup = (): void => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        void this._sub.unsubscribe(respChannel)
        this._sub.removeAllListeners('message')
      }

      // 监听响应通道消息
      this._sub.on('message', (channel: string, data: string) => {
        if (channel !== respChannel) return
        cleanup()
        try {
          resolve(JSON.parse(data) as RPCResponse)
        } catch {
          resolve({
            request_id: requestId,
            success: false,
            error: 'rpc_parse_error',
          })
        }
      })

      // 先订阅再入队，防止竞态窗口
      this._sub
        .subscribe(respChannel)
        .then(() => {
          // 将请求序列化后推入 Redis List
          return this._redis.rpush(rpcRequestQueueKey(), JSON.stringify(req))
        })
        .catch(() => {
          cleanup()
          resolve({
            request_id: requestId,
            success: false,
            error: 'rpc_subscribe_error',
          })
        })

      // 超时定时器
      const remaining = deadline - Date.now()
      timer = setTimeout(
        () => {
          if (resolved) return
          cleanup()
          resolve({
            request_id: requestId,
            success: false,
            error: 'rpc_timeout',
          })
        },
        Math.max(remaining, POLL_INTERVAL_MS),
      )
    })
  }

  /** 关闭底层 Redis 连接。进程退出或测试隔离时调用。 */
  async close(): Promise<void> {
    this._redis.disconnect()
    this._sub.disconnect()
  }
}

// ── 模块级 lazy singleton（BullMQ Worker 进程内复用 Redis 连接）──

let _bridge: RPCBridge | undefined

/**
 * 获取全局 RPCBridge 单例。
 *
 * @param redisUrl - Redis URL（首次调用时必传）
 */
export function getRpcBridge(redisUrl: string): RPCBridge {
  _bridge ??= new RPCBridge(redisUrl)
  return _bridge
}

/**
 * 重置全局 RPCBridge 单例并关闭 Redis 连接。
 *
 * 主要供测试使用，确保用例间连接隔离。
 */
export async function resetRpcBridge(): Promise<void> {
  if (_bridge !== undefined) {
    await _bridge.close()
    _bridge = undefined
  }
}
