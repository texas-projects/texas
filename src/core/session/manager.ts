/**
 * SessionManager —— 全局会话管理器（TypeScript 移植自 manager.py）。
 *
 * 负责会话生命周期管理、消息路由、互斥检查和超时管理。
 */

import { InteractiveSession } from './base.js'
import type { SessionData } from './base.js'
import { CANCEL_COMMANDS } from './commands.js'
import { SessionContext } from './context.js'
import { TimeoutMode } from './enums.js'
import * as sessionKeys from './keys.js'
import { resolveTimeout } from './timeout.js'
import type { TimeoutConfig } from './timeout.js'

import type { Context } from '@/core/dispatch/context.js'
import { loadEchoConfig } from '@/core/echo/config.js'
import type { RedisStore } from '@/core/redis/store.js'

/**
 * 全局会话管理器 —— 管理所有交互式会话的生命周期。
 *
 * Notes:
 *   Redis 持久化仅用于设置 TTL 和跨实例互斥感知，**不支持进程重启后的会话恢复**。
 *   进程重启时内存中的活跃会话会丢失，Redis 残留记录会在下次同 key 启动时被清除。
 */
export class SessionManager {
  private readonly _cache: RedisStore
  private readonly _activeSessions = new Map<string, InteractiveSession<SessionData>>()
  // per-key 互斥锁（Promise 链模拟）：防止同一用户的并发消息绕过互斥检查
  private readonly _sessionLocks = new Map<string, Promise<void>>()
  private readonly _timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly _warningHandles = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(cache: RedisStore) {
    this._cache = cache
  }

  // ── 会话生命周期 ──

  /**
   * 启动交互式会话。
   *
   * @param sessionCls 会话类构造函数。
   * @param ctx 触发会话的事件上下文。
   * @param initialData 初始化数据（传递给会话 data 字段）。
   * @returns 是否成功启动。
   */
  async startSession<TData extends SessionData>(
    sessionCls: new () => InteractiveSession<TData>,
    ctx: Context,
    initialData?: Partial<TData>,
  ): Promise<boolean> {
    const sessionKey = SessionManager._buildSessionKey(ctx.userId, ctx.groupId)
    return this._withLock(sessionKey, () =>
      this._startSessionLocked(sessionCls, sessionKey, ctx, initialData),
    )
  }

  private async _startSessionLocked<TData extends SessionData>(
    sessionCls: new () => InteractiveSession<TData>,
    sessionKey: string,
    ctx: Context,
    initialData?: Partial<TData>,
  ): Promise<boolean> {
    // 互斥：内存检查
    const existing = this._activeSessions.get(sessionKey)
    if (existing !== undefined) {
      const cancelHint = CANCEL_COMMANDS.values().next().value ?? '/cancel'
      await ctx.reply(`您有一个进行中的操作，请先完成或发送 ${cancelHint}`)
      return false
    }

    // 互斥：Redis 残留清理
    if (await this._cache.exists(sessionKeys.sessionKey(sessionKey))) {
      await Promise.allSettled([
        this._cache.del(sessionKeys.sessionKey(sessionKey)),
        this._cache.del(sessionKeys.sessionDataKey(sessionKey)),
      ])
    }

    const session = new sessionCls()
    session.manager = this
    session._sessionKey = sessionKey
    session._creatorUserId = ctx.userId

    if (initialData !== undefined) {
      Object.assign(session.data as object, initialData)
    }

    let sessionCtx: SessionContext | null = null

    try {
      // 构建状态机
      const customStates = await session.buildStates()
      if (customStates !== null) {
        if (customStates.length === 0) {
          throw new Error(`${sessionCls.name}.buildStates() 返回了空列表，无法确定初始状态`)
        }
        const firstState = customStates[0]
        if (firstState === undefined) {
          throw new Error(`${sessionCls.name}.buildStates() 返回了空列表`)
        }
        session._initStateMachine(customStates, firstState.name)
      } else {
        const [stateList, initialState] = session._buildStatesFromDecorators()
        session._initStateMachine(stateList, initialState)
      }

      this._activeSessions.set(sessionKey, session)

      const sessionMeta = InteractiveSession.getSessionMeta(sessionCls)
      const echoConfig = await loadEchoConfig()
      const defaultTimeout = echoConfig.app?.sessionTimeout ?? 300
      await this._persistSession(sessionKey, session, sessionMeta, defaultTimeout)

      const timeoutConfig = resolveTimeout(sessionMeta?.timeout ?? defaultTimeout)
      this._setupTimeout(sessionKey, session, timeoutConfig, ctx)

      const initialStateName = session.stateMachine?.initialState ?? ''
      sessionCtx = new SessionContext(ctx, session, initialStateName, null)

      await session.onStart(sessionCtx)
      await session.stateMachine?.start(sessionCtx)
    } catch (exc) {
      await this._cleanupSession(sessionKey)
      if (sessionCtx !== null) {
        try {
          await session.onError(sessionCtx, exc instanceof Error ? exc : new Error(String(exc)))
        } catch {
          // 忽略 onError 本身的异常
        }
      }
      return false
    }

    return true
  }

  /**
   * 将用户消息路由到活跃会话。
   *
   * @param sessionKey 会话键。
   * @param ctx 事件上下文。
   * @returns 是否成功处理。
   */
  async dispatchInput(sessionKey: string, ctx: Context): Promise<boolean> {
    if (!this._sessionLocks.has(sessionKey)) {
      return false
    }
    return this._withLock(sessionKey, () => this._dispatchInputLocked(sessionKey, ctx))
  }

  private async _dispatchInputLocked(sessionKey: string, ctx: Context): Promise<boolean> {
    const session = this._activeSessions.get(sessionKey)
    if (session === undefined) return false

    const userInput = ctx.getPlaintext().trim()
    if (session.stateMachine === null) {
      throw new Error(`会话 ${sessionKey} 的状态机未初始化（请通过 startSession() 启动）`)
    }
    const currentState = session.stateMachine.currentState ?? ''
    const sessionCtx = new SessionContext(ctx, session, currentState, userInput)

    try {
      await session.stateMachine.processInput(sessionCtx)

      // 刷新超时
      const sessionMeta = InteractiveSession.getSessionMeta(session.constructor)
      const echoConfig = await loadEchoConfig()
      const defaultTimeout = echoConfig.app?.sessionTimeout ?? 300
      const timeoutConfig = resolveTimeout(sessionMeta?.timeout ?? defaultTimeout)
      if (timeoutConfig.mode !== TimeoutMode.NEVER) {
        this._refreshTimeout(sessionKey, session, timeoutConfig, ctx)
      }

      // 检查是否到达终止状态
      if (session.stateMachine.isFinished) {
        await session.onFinish(sessionCtx)
        await this._cleanupSession(sessionKey)
        return true
      }

      // 会话仍在进行中，持久化最新状态
      await this._persistSession(sessionKey, session, sessionMeta, defaultTimeout)
    } catch (exc) {
      await this._cleanupSession(sessionKey)
      try {
        await session.onError(sessionCtx, exc instanceof Error ? exc : new Error(String(exc)))
      } catch {
        // 忽略 onError 本身的异常
      }
      try {
        await ctx.reply('操作过程中发生错误，会话已结束。')
      } catch {
        // 忽略发送失败
      }
    }

    return true
  }

  /**
   * 取消指定会话。
   *
   * @param sessionKey 会话键。
   * @param ctx 可选的事件上下文。
   * @returns 是否成功取消。
   */
  async cancelSession(sessionKey: string, ctx?: Context): Promise<boolean> {
    const session = this._activeSessions.get(sessionKey)
    if (session === undefined) return false

    if (ctx !== undefined) {
      if (session.stateMachine === null) {
        throw new Error(`会话 ${sessionKey} 的状态机未初始化（请通过 startSession() 启动）`)
      }
      const currentState = session.stateMachine.currentState ?? ''
      const sessionCtx = new SessionContext(ctx, session, currentState, null)
      try {
        await session.onCancel(sessionCtx)
      } catch {
        // 忽略 onCancel 的异常
      }
    }

    await this._cleanupSession(sessionKey)
    return true
  }

  // ── 查询方法 ──

  /** 返回当前内存中活跃会话的数量。 */
  getActiveSessionCount(): number {
    return this._activeSessions.size
  }

  /** 取消所有活跃会话（维护模式 / 优雅关闭前使用）。 */
  async cancelAllSessions(): Promise<number> {
    const keys = [...this._activeSessions.keys()]
    await Promise.allSettled(keys.map((k) => this.cancelSession(k)))
    return keys.length
  }

  /**
   * 查询用户在当前来源是否有活跃会话。
   *
   * @returns 活跃会话的 key，无则返回 null。
   */
  getActiveSessionKey(userId: number, groupId?: number): string | null {
    const key = SessionManager._buildSessionKey(userId, groupId)
    return this._activeSessions.has(key) ? key : null
  }

  /** 检查文本是否为全局取消命令。 */
  static isCancelCommand(text: string): boolean {
    return CANCEL_COMMANDS.has(text.trim())
  }

  // ── 内部方法 ──

  /**
   * 构建会话键。
   *
   * 采用 user+source 粒度：同一用户在不同来源（群/私聊）的会话互不干扰。
   */
  static _buildSessionKey(userId: number, groupId?: number): string {
    const sourceId = groupId !== undefined ? String(groupId) : 'private'
    return `user:${String(userId)}:source:${sourceId}`
  }

  private async _persistSession(
    sessionKey: string,
    session: InteractiveSession<SessionData>,
    sessionMeta: ReturnType<(typeof InteractiveSession)['getSessionMeta']>,
    defaultTimeout: number,
  ): Promise<void> {
    const timeoutConfig = resolveTimeout(sessionMeta?.timeout ?? defaultTimeout)
    const redisTtl: number =
      timeoutConfig.mode === TimeoutMode.NEVER
        ? 0 // 永不过期
        : timeoutConfig.duration + 60 // 比超时时间多 60s 的安全余量

    const metaData = {
      sessionType: session.constructor.name,
      currentState: session.stateMachine?.currentState ?? null,
    }
    const dataJson = session.data

    await Promise.allSettled([
      this._cache.set(sessionKeys.sessionKey(sessionKey), metaData, redisTtl),
      this._cache.set(sessionKeys.sessionDataKey(sessionKey), dataJson, redisTtl),
    ])
  }

  private async _cleanupSession(sessionKey: string): Promise<void> {
    /** 清理会话（内存 + Redis + 定时任务）。 */
    this._activeSessions.delete(sessionKey)
    this._sessionLocks.delete(sessionKey)

    const timeoutHandle = this._timeoutHandles.get(sessionKey)
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
      this._timeoutHandles.delete(sessionKey)
    }

    const warningHandle = this._warningHandles.get(sessionKey)
    if (warningHandle !== undefined) {
      clearTimeout(warningHandle)
      this._warningHandles.delete(sessionKey)
    }

    await Promise.allSettled([
      this._cache.del(sessionKeys.sessionKey(sessionKey)),
      this._cache.del(sessionKeys.sessionDataKey(sessionKey)),
    ])
  }

  private _setupTimeout(
    sessionKey: string,
    session: InteractiveSession<SessionData>,
    config: TimeoutConfig,
    ctx: Context,
  ): void {
    if (config.mode === TimeoutMode.NEVER) return

    const timeoutHandle = setTimeout(() => {
      void (async () => {
        const activeSession = this._activeSessions.get(sessionKey)
        if (activeSession === undefined) return

        if (config.mode === TimeoutMode.NOTIFY) {
          try {
            await ctx.reply(config.timeoutMessage)
          } catch {
            // 忽略发送失败
          }
        }
        try {
          await activeSession.onTimeout(null)
        } catch {
          // 忽略超时钩子异常
        }
        await this._cleanupSession(sessionKey)
      })()
    }, config.duration * 1000)

    this._timeoutHandles.set(sessionKey, timeoutHandle)

    if (config.mode === TimeoutMode.NOTIFY && config.warningBefore > 0) {
      const warningTime = config.duration - config.warningBefore
      if (warningTime > 0) {
        const warningHandle = setTimeout(() => {
          void (async () => {
            if (!this._activeSessions.has(sessionKey)) return
            const msgText = config.warningMessage.replace(
              '{remaining}',
              String(config.warningBefore),
            )
            try {
              await ctx.reply(msgText)
            } catch {
              // 忽略发送失败
            }
            this._warningHandles.delete(sessionKey)
          })()
        }, warningTime * 1000)
        this._warningHandles.set(sessionKey, warningHandle)
      }
    }

    void session // 消除未使用警告（session 通过 _activeSessions 引用）
  }

  private _refreshTimeout(
    sessionKey: string,
    session: InteractiveSession<SessionData>,
    config: TimeoutConfig,
    ctx: Context,
  ): void {
    /** 刷新超时（用户交互后重置倒计时）。 */
    const oldTimeout = this._timeoutHandles.get(sessionKey)
    if (oldTimeout !== undefined) {
      clearTimeout(oldTimeout)
      this._timeoutHandles.delete(sessionKey)
    }

    const oldWarning = this._warningHandles.get(sessionKey)
    if (oldWarning !== undefined) {
      clearTimeout(oldWarning)
      this._warningHandles.delete(sessionKey)
    }

    this._setupTimeout(sessionKey, session, config, ctx)
  }

  /** 关闭管理器，清理所有活跃会话。 */
  async close(): Promise<void> {
    for (const sessionKey of [...this._activeSessions.keys()]) {
      await this._cleanupSession(sessionKey)
    }
  }

  /**
   * 内部辅助：使用 Promise 链模拟 per-key 互斥锁。
   *
   * 同一 sessionKey 的并发调用会被串行化，但不同 sessionKey 互不干扰。
   */
  private async _withLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const prevLock = this._sessionLocks.get(sessionKey) ?? Promise.resolve()

    let resolveNew!: () => void
    const newLock = new Promise<void>((res) => {
      resolveNew = res
    })
    this._sessionLocks.set(sessionKey, newLock)

    try {
      await prevLock
    } catch {
      // 忽略前一个锁的异常
    }

    try {
      return await fn()
    } finally {
      resolveNew()
    }
  }
}
