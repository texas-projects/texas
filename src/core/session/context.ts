/**
 * 会话上下文 —— 封装会话内的交互信息（TypeScript 移植自 context.py）。
 */

import type { InteractiveSession, SessionData } from './base.js'
import { CONFIRM_STATE_PREFIX } from './commands.js'

import type { Context } from '@/core/dispatch/context.js'
import type { MessageSegment } from '@/core/protocol/models/segments.js'

/** 确认状态配置。 */
export interface ConfirmConfig {
  prompt: string
  onConfirm: string
  stateName: string
}

/**
 * 会话上下文 —— 代理原始 Context 并提供会话专属方法。
 *
 * 每次会话内消息到达时创建一个新的 SessionContext，
 * 包含原始事件上下文和当前会话的状态信息。
 */
export class SessionContext {
  private readonly _ctx: Context
  readonly session: InteractiveSession<SessionData>
  /** 当前状态名称（由状态机写入）。 */
  currentState: string
  /** 用户输入文本（null 表示无输入，如超时触发）。 */
  readonly input: string | null

  constructor(
    ctx: Context,
    session: InteractiveSession<SessionData>,
    currentState: string,
    userInput: string | null,
  ) {
    this._ctx = ctx
    this.session = session
    this.currentState = currentState
    this.input = userInput
  }

  // ── 会话数据快捷访问 ──

  /** 会话数据访问。 */
  get data(): SessionData {
    return this.session.data
  }

  // ── 代理 Context 属性 ──

  get userId(): number {
    return this._ctx.userId
  }

  get groupId(): number | undefined {
    return this._ctx.groupId
  }

  get isGroup(): boolean {
    return this._ctx.isGroupEvent()
  }

  get messageId(): number {
    return this._ctx.messageId
  }

  get event(): unknown {
    return this._ctx.event
  }

  get bot(): unknown {
    return this._ctx.bot
  }

  /** 获取原始事件上下文（需要访问完整 Context API 时使用）。 */
  get originalContext(): Context {
    return this._ctx
  }

  // ── 代理 Context 方法 ──

  /**
   * 向当前会话发送回复。
   *
   * 群聊时自动在消息头部插入 @创建者（session._creatorUserId），
   * 以区分同一群内多个用户的并发会话。
   */
  async reply(message: string | MessageSegment[]): Promise<void> {
    if (typeof message === 'string') {
      const segments: MessageSegment[] = []
      if (this.isGroup) {
        segments.push({ type: 'at', data: { qq: String(this.session._creatorUserId) } })
        segments.push({ type: 'text', data: { text: ' ' } })
      }
      segments.push({ type: 'text', data: { text: message } })
      await this._ctx.reply(segments)
    } else {
      if (this.isGroup) {
        const withAt: MessageSegment[] = [
          { type: 'at', data: { qq: String(this.session._creatorUserId) } },
          { type: 'text', data: { text: ' ' } },
          ...message,
        ]
        await this._ctx.reply(withAt)
      } else {
        await this._ctx.reply(message)
      }
    }
  }

  /** reply 的别名（含 @创建者 行为一致）。 */
  async send(message: string | MessageSegment[]): Promise<void> {
    await this.reply(message)
  }

  /** 从上下文获取服务实例（类型安全）。 */
  getService<T>(constructor: new (...args: unknown[]) => T): T {
    return this._ctx.getService(constructor)
  }

  /** 检查服务是否已注册。 */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  hasService(constructor: Function): boolean {
    return this._ctx.hasService(constructor)
  }

  /** 获取消息纯文本。 */
  getPlaintext(): string {
    return this._ctx.getPlaintext()
  }

  /**
   * 取出并清空待注入的确认状态配置（供框架内部使用）。
   *
   * @returns 确认配置，若未设置则返回 null。
   */
  popConfirmConfig(): ConfirmConfig | null {
    const config = this.session._confirmConfig
    this.session._confirmConfig = null
    return config
  }

  /**
   * 请求用户二次确认后再转换到目标状态。
   *
   * 在 onInput 处理方法中调用并直接返回其结果，框架会自动注入
   * 确认等待状态，向用户展示提示并等待 /确认 或 /取消 输入。
   *
   * @param prompt 展示给用户的确认提示文本。
   * @param onConfirm 用户发送 /确认 后转换到的目标状态名。
   * @returns 内部确认状态名，可直接作为 onInput 方法的返回值使用。
   */
  confirmTransition(prompt: string, onConfirm: string): string {
    const confirmStateName = `${CONFIRM_STATE_PREFIX}_${onConfirm}`
    this.session._confirmConfig = {
      prompt,
      onConfirm,
      stateName: confirmStateName,
    }
    return confirmStateName
  }
}
