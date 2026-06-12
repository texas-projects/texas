/**
 * InteractiveSession 基类 —— 会话实例的核心抽象（TypeScript 移植自 base.py）。
 */

import type { SessionContext } from './context.js'
import { EXIT_META, INPUT_META, SESSION_META, STATE_META } from './decorators.js'
import type { ExitMeta, InputMeta, SessionMeta, StateMeta } from './decorators.js'
import type { SessionManager } from './manager.js'
import { StateMachine } from './state-machine.js'
import { makeState } from './state.js'
import type { State } from './state.js'

/** 会话数据泛型约束 —— 须为普通对象，可 JSON 序列化。 */
export type SessionData = Record<string, unknown>

/** 带元数据键的函数对象接口。 */
interface FunctionWithSessionMeta {
  [SESSION_META]?: SessionMeta
  [STATE_META]?: StateMeta
  [INPUT_META]?: InputMeta
  [EXIT_META]?: ExitMeta
}

/**
 * 交互式会话基类。
 *
 * 子类通过泛型参数指定会话数据类型：
 * ```ts
 * class FeedbackSession extends InteractiveSession<FeedbackSessionData> {
 *   ...
 * }
 * ```
 *
 * 状态定义支持两种方式：
 * 1. 装饰器 DSL：使用 @state / @onInput / @onExit 装饰方法
 * 2. 配置式：重写 buildStates() 方法返回 State 列表
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export abstract class InteractiveSession<TData extends SessionData> {
  /** 会话数据，由 SessionManager 初始化。 */
  data: TData = {} as TData

  /**
   * 状态机实例，由 SessionManager.startSession() 初始化。
   * 在 startSession() 外直接构造并使用属于误用。
   */
  stateMachine: StateMachine | null = null

  /**
   * 所属 SessionManager，由 startSession() 赋值。
   */
  manager: SessionManager | null = null

  /** Redis 会话键，由 SessionManager 赋值。 */
  _sessionKey = ''

  /** 会话创建者用户 ID，由 SessionManager.startSession() 赋值。 */
  _creatorUserId = 0

  /** 待注入的确认状态配置，由 SessionContext.confirmTransition() 写入。 */
  _confirmConfig: { prompt: string; onConfirm: string; stateName: string } | null = null

  // ── 生命周期钩子 ──

  /** 会话启动时调用，可用于初始化数据。 */
  async onStart(_ctx: SessionContext): Promise<void> {
    // 子类可重写
  }

  /** 会话正常结束时调用（到达 final 状态）。 */
  async onFinish(_ctx: SessionContext): Promise<void> {
    // 子类可重写
  }

  /** 用户取消会话时调用。 */
  async onCancel(_ctx: SessionContext): Promise<void> {
    // 子类可重写
  }

  /** 会话超时时调用，ctx 可能为 null（静默超时无法获取上下文）。 */
  async onTimeout(_ctx: SessionContext | null): Promise<void> {
    // 子类可重写
  }

  /** 会话处理异常时调用。 */
  async onError(_ctx: SessionContext, _exc: Error): Promise<void> {
    // 子类可重写
  }

  // ── 动态状态机构建 ──

  /**
   * 子类可重写此方法动态构建状态。
   *
   * 返回 null 则使用装饰器定义的状态。
   */
  async buildStates(): Promise<State[] | null> {
    return null
  }

  // ── 内部工具方法 ──

  /**
   * 从装饰器元数据构建状态列表。
   *
   * 扫描实例上的方法，收集 @state / @onInput / @onExit 元数据，
   * 组装成 State 列表并返回初始状态名。
   */
  _buildStatesFromDecorators(): [State[], string | null] {
    const stateDefs = new Map<
      string,
      {
        onEnter: ((ctx: SessionContext) => Promise<void>) | undefined
        isFinal: boolean
        parent: string | undefined
      }
    >()
    const inputHandlers = new Map<string, (ctx: SessionContext) => Promise<string | null>>()
    const exitHandlers = new Map<string, (ctx: SessionContext) => Promise<void>>()
    let initialState: string | null = null

    // 扫描原型链上的方法
    let proto = Object.getPrototypeOf(this) as object | null
    const seenNames = new Set<string>()
    const orderedAttrs: [string, FunctionWithSessionMeta][] = []

    while (proto !== null && proto !== Object.prototype) {
      for (const attrName of Object.getOwnPropertyNames(proto)) {
        if (!seenNames.has(attrName)) {
          seenNames.add(attrName)
          const val = (this as Record<string, unknown>)[attrName]
          if (typeof val === 'function') {
            orderedAttrs.push([attrName, val as FunctionWithSessionMeta])
          }
        }
      }
      proto = Object.getPrototypeOf(proto) as object | null
    }

    for (const [, attr] of orderedAttrs) {
      // @state 装饰器
      const smeta = attr[STATE_META]
      if (smeta !== undefined) {
        const name = smeta.name
        stateDefs.set(name, {
          onEnter: attr as unknown as (ctx: SessionContext) => Promise<void>,
          isFinal: smeta.final,
          parent: smeta.parent,
        })
        if (smeta.initial) {
          if (initialState !== null) {
            throw new Error(
              `会话 ${this.constructor.name} 定义了多个初始状态: '${initialState}' 和 '${name}'`,
            )
          }
          initialState = name
        }
      }

      // @onInput 装饰器
      const imeta = attr[INPUT_META]
      if (imeta !== undefined) {
        inputHandlers.set(
          imeta.stateName,
          attr as unknown as (ctx: SessionContext) => Promise<string | null>,
        )
      }

      // @onExit 装饰器
      const emeta = attr[EXIT_META]
      if (emeta !== undefined) {
        exitHandlers.set(emeta.stateName, attr as unknown as (ctx: SessionContext) => Promise<void>)
      }
    }

    if (stateDefs.size === 0) {
      throw new Error(`会话 ${this.constructor.name} 未定义任何状态（使用 @state 装饰器）`)
    }

    initialState ??= stateDefs.keys().next().value ?? null

    // 组装 State 对象
    const states: State[] = []
    for (const [name, sdef] of stateDefs) {
      states.push(
        makeState(
          name,
          {
            onEnter: sdef.onEnter,
            onExit: exitHandlers.get(name),
            onInput: inputHandlers.get(name),
            parent: sdef.parent,
          },
          { isFinal: sdef.isFinal },
        ),
      )
    }

    return [states, initialState]
  }

  /**
   * 读取会话类上的 @interactiveSession 元数据。
   */
  static getSessionMeta(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    cls: Function,
  ): SessionMeta | undefined {
    return (cls as FunctionWithSessionMeta)[SESSION_META]
  }

  /**
   * 初始化状态机。
   */
  _initStateMachine(states: State[], initialState: string | null): void {
    this.stateMachine = new StateMachine(states, initialState ?? undefined)
  }
}
