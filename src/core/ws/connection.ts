/**
 * WebSocket 连接管理器 —— 跟踪唯一的 NapCat 反向连接（一对一架构）。
 */

import type { IncomingMessage } from 'node:http'

import type { BotAPI } from '@/core/protocol/api.js'
import type { AnyOneBotEvent } from '@/core/protocol/models/events.js'

/** 原始 WebSocket 消息的最小结构，用于路由判断。 */
interface RawWsMessage {
  echo?: unknown
  post_type?: unknown
  [key: string]: unknown
}

/**
 * ConnectionManager 所需的 WebSocket 最小接口。
 *
 * 与 ws.WebSocket / @fastify/websocket 的实际类型兼容，
 * 通过结构化类型避免直接引用外部模块导出的 error 类型。
 */
export interface MinimalSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: string, listener: (...args: unknown[]) => void): this
}

/**
 * 管理唯一的 NapCat 反向 WebSocket 连接。
 *
 * - 含 `echo` 字段且不含 `post_type` 的消息路由至 BotAPI.handleResponse()
 * - 其他消息视为事件，路由至 onEvent 回调
 */
export class ConnectionManager {
  private socket: MinimalSocket | null = null
  private _connectedAt: Date | undefined = undefined
  private readonly botApi: BotAPI
  private readonly onEvent: (event: AnyOneBotEvent) => void

  constructor(botApi: BotAPI, onEvent: (event: AnyOneBotEvent) => void) {
    this.botApi = botApi
    this.onEvent = onEvent
  }

  /** 是否有活跃连接。 */
  get isConnected(): boolean {
    return this.socket !== null
  }

  /** 连接建立时间（无连接时为 undefined）。 */
  get connectedAt(): Date | undefined {
    return this._connectedAt
  }

  /**
   * 接受新的 WebSocket 连接，注册消息和关闭处理器。
   *
   * @param socket - 实现 MinimalSocket 接口的 WebSocket 套接字
   * @param _req - HTTP 升级请求（保留供后续使用）
   */
  handleConnect(socket: MinimalSocket, _req: IncomingMessage): void {
    this.socket = socket
    this._connectedAt = new Date()

    socket.on('message', (raw: unknown) => {
      const text =
        typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : String(raw)
      this.handleMessage(text)
    })

    socket.on('close', () => {
      this.handleDisconnect()
    })

    socket.on('error', () => {
      this.handleDisconnect()
    })
  }

  /** 清理连接状态（断线时调用）。 */
  handleDisconnect(): void {
    this.socket = null
    this._connectedAt = undefined
  }

  /**
   * 向当前连接发送文本数据。
   *
   * @throws {Error} 无活跃连接时抛出
   */
  send(data: string): void {
    if (!this.socket) {
      throw new Error('当前无活跃的 WebSocket 连接')
    }
    this.socket.send(data)
  }

  /** 处理收到的原始 WebSocket 消息。 */
  private handleMessage(text: string): void {
    let data: RawWsMessage
    try {
      data = JSON.parse(text) as RawWsMessage
    } catch {
      return
    }

    // 含 echo 且不含 post_type → API 响应
    if (data.echo !== undefined && data.post_type === undefined) {
      this.botApi.handleResponse(data as Parameters<BotAPI['handleResponse']>[0])
      return
    }

    // 其他消息视为事件
    this.onEvent(data as unknown as AnyOneBotEvent)
  }
}
