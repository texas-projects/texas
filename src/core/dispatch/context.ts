/**
 * 事件上下文 —— 封装事件、Bot API 及便捷方法（TypeScript 移植自 context.py）。
 */

import type { BotAPI } from '@/core/protocol/api.js'
import type { AnyOneBotEvent, GroupMessageEvent } from '@/core/protocol/models/events.js'
import type { MessageSegment } from '@/core/protocol/models/segments.js'
import { extractPlaintext } from '@/core/protocol/utils.js'

/** 由 ctx.finish() 抛出，用于中止后续处理器的执行。 */
export class FinishError extends Error {
  constructor() {
    super('FinishError: handler requested finish')
    this.name = 'FinishError'
  }
}

/** 文本消息段构造辅助。 */
function textSegment(text: string): MessageSegment {
  return { type: 'text', data: { text } }
}

/** 事件记录视图（用于动态字段访问）。 */
type EventRecord = Record<string, unknown>

/** 判断事件是否为群消息事件。 */
function isGroupEvent(event: AnyOneBotEvent): event is GroupMessageEvent {
  return (
    (event.post_type === 'message' || event.post_type === 'message_sent') &&
    (event as EventRecord).message_type === 'group'
  )
}

/** 判断事件是否为私聊消息事件。 */
function isPrivateEvent(event: AnyOneBotEvent): boolean {
  return (
    (event.post_type === 'message' || event.post_type === 'message_sent') &&
    (event as EventRecord).message_type === 'private'
  )
}

type Constructor<T> = new (...args: unknown[]) => T

/**
 * 事件处理上下文 —— 传递给拦截器和处理器。
 *
 * 包含：
 * - 当前事件（`event`）
 * - Bot API 客户端（`bot`）
 * - 服务注册表（`getService`）
 * - 正则匹配结果（`regexMatch`）
 * - 属性存储（供拦截器链传递数据）
 * - 消息辅助方法（`getPlaintext`、`getArgs`、`reply`、`finish` 等）
 */
export class Context {
  /** 触发本次事件的原始事件对象。 */
  readonly event: AnyOneBotEvent

  /** Bot API 客户端。 */
  readonly bot: BotAPI

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private readonly _services: Map<Function, unknown>
  private _regexMatch: RegExpMatchArray | null = null
  private readonly _attributes = new Map<string, unknown>()

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  constructor(event: AnyOneBotEvent, bot: BotAPI, services?: Map<Function, unknown>) {
    this.event = event
    this.bot = bot
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    this._services = services ?? new Map<Function, unknown>()
  }

  // ── 服务注册表 ──

  /**
   * 从上下文获取服务实例（类型安全）。
   *
   * 用法：
   * ```ts
   * const svc = ctx.getService(MyService)
   * ```
   */
  getService<T>(constructor: Constructor<T>): T {
    const service = this._services.get(constructor)
    if (service === undefined) {
      const available = [...this._services.keys()]
        .map((k) => (k as { name?: string }).name ?? String(k))
        .join(', ')
      throw new Error(
        `Service ${constructor.name} not registered in context. Available: ${available}`,
      )
    }
    return service as T
  }

  /** 检查服务是否已注册。 */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  hasService(constructor: Function): boolean {
    return this._services.has(constructor)
  }

  // ── 属性存储（拦截器 <-> 处理器数据传递） ──

  setAttribute(key: string, value: unknown): void {
    this._attributes.set(key, value)
  }

  getAttribute(key: string): unknown {
    return this._attributes.get(key)
  }

  // ── 正则匹配（由调度器在 OnRegex 时设置） ──

  setRegexMatch(match: RegExpMatchArray): void {
    this._regexMatch = match
  }

  getRegexMatch(): RegExpMatchArray | null {
    return this._regexMatch
  }

  // ── 消息辅助方法 ──

  /** 从消息中提取纯文本。 */
  getPlaintext(): string {
    return extractPlaintext(this.event)
  }

  /**
   * 提取命令参数（命令名之后的文本）。
   * 例如消息 "/echo hello world" → ["hello", "world"]
   */
  getArgs(): string[] {
    const text = this.getPlaintext()
    const parts = text.split(/\s+/u)
    // parts[0] 是命令名，之后的才是参数
    return parts.slice(1).filter((s) => s.length > 0)
  }

  /**
   * 以单个字符串形式获取命令名之后的所有内容。
   * 例如消息 "/echo hello world" → "hello world"
   */
  getArgStr(): string {
    const text = this.getPlaintext()
    const idx = text.search(/\s/u)
    return idx === -1 ? '' : text.slice(idx + 1).trimStart()
  }

  // ── 回复 / 发送快捷方法 ──

  /**
   * 向当前会话发送回复。
   * 群消息事件 → send_group_msg；私聊消息事件 → send_private_msg。
   */
  async reply(message: MessageSegment | MessageSegment[] | string): Promise<void> {
    const segments: MessageSegment[] = Array.isArray(message)
      ? message
      : typeof message === 'string'
        ? [textSegment(message)]
        : [message]

    if (isGroupEvent(this.event)) {
      await this.bot.sendGroupMsg(this.event.group_id, segments)
    } else if (isPrivateEvent(this.event)) {
      const userId = (this.event as EventRecord).user_id
      if (typeof userId === 'number') {
        await this.bot.sendPrivateMsg(userId, segments)
      }
    }
  }

  /** reply 的别名。 */
  async send(message: MessageSegment | MessageSegment[] | string): Promise<void> {
    await this.reply(message)
  }

  /**
   * 发送消息并中止后续处理器的执行。
   * 抛出 FinishError，调度器捕获后停止处理器链。
   */
  async finish(message?: MessageSegment | MessageSegment[] | string): Promise<never> {
    if (message !== undefined) {
      await this.reply(message)
    }
    throw new FinishError()
  }

  /** 撤回当前消息（仅消息事件有效）。 */
  async recall(): Promise<void> {
    const messageId = (this.event as EventRecord).message_id
    if (typeof messageId === 'number') {
      await this.bot.deleteMsg(messageId)
    }
  }

  // ── 便捷属性 ──

  /** 判断当前事件是否为群消息事件。 */
  isGroupEvent(): boolean {
    return isGroupEvent(this.event)
  }

  /** 判断当前事件是否为私聊消息事件。 */
  isPrivateEvent(): boolean {
    return isPrivateEvent(this.event)
  }

  /** 当前群 ID（仅群消息事件有值）。 */
  get groupId(): number | undefined {
    if (isGroupEvent(this.event)) {
      return this.event.group_id
    }
    return undefined
  }

  /** 触发事件的用户 ID。 */
  get userId(): number {
    const uid = (this.event as EventRecord).user_id
    return typeof uid === 'number' ? uid : 0
  }

  /** 当前消息 ID（仅消息事件有值）。 */
  get messageId(): number {
    const mid = (this.event as EventRecord).message_id
    return typeof mid === 'number' ? mid : 0
  }
}
