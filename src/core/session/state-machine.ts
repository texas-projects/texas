/**
 * 状态机引擎 —— 管理状态图和转换逻辑（TypeScript 移植自 state_machine.py）。
 */

import { CONFIRM_COMMANDS, CONFIRM_STATE_PREFIX } from './commands.js'
import type { SessionContext } from './context.js'
import { makeState } from './state.js'
import type { State, Transition } from './state.js'

/** 状态机异常基类。 */
export class StateMachineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateMachineError'
  }
}

/** 无效的状态转换。 */
export class InvalidTransitionError extends StateMachineError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTransitionError'
  }
}

/**
 * 有限状态机引擎。
 *
 * 支持条件转换、嵌套状态（通过 State.parent 字段）和历史状态恢复。
 */
export class StateMachine {
  private readonly _states = new Map<string, State>()
  private _initialState: string | null
  private _currentState: string | null = null
  private readonly _history = new Map<string, string>() // 父状态 → 最后激活的子状态

  constructor(states: State[], initialState?: string) {
    this._initialState = initialState ?? null

    for (const s of states) {
      this.addState(s)
    }

    // 自动检测初始状态
    if (this._initialState === null && this._states.size > 0) {
      this._initialState = this._states.keys().next().value ?? null
    }
  }

  /** 当前状态名称。 */
  get currentState(): string | null {
    return this._currentState
  }

  /** 初始状态名称。 */
  get initialState(): string | null {
    return this._initialState
  }

  /** 状态机是否已到达终止状态。 */
  get isFinished(): boolean {
    if (this._currentState === null) return false
    const state = this._states.get(this._currentState)
    return state?.isFinal ?? false
  }

  /** 注册状态。 */
  addState(state: State): void {
    this._states.set(state.name, state)
  }

  /** 为状态添加转换规则。 */
  addTransition(fromState: string, transition: Transition): void {
    const state = this._states.get(fromState)
    if (state === undefined) {
      throw new StateMachineError(`状态 '${fromState}' 不存在`)
    }
    const eventKey = transition.event ?? `_auto_${String(state.transitions.size)}`
    state.transitions.set(eventKey, transition)
  }

  /** 按名称获取状态。 */
  getState(name: string): State | undefined {
    return this._states.get(name)
  }

  /** 遍历所有已注册的状态。 */
  iterStates(): IterableIterator<State> {
    return this._states.values()
  }

  /** 启动状态机，进入初始状态。 */
  async start(ctx: SessionContext): Promise<void> {
    if (this._initialState === null) {
      throw new StateMachineError('未设置初始状态')
    }
    await this._enterState(this._initialState, ctx)
  }

  /**
   * 处理用户输入，返回新状态名称或 null（停留当前状态）。
   */
  async processInput(ctx: SessionContext): Promise<string | null> {
    if (this._currentState === null) {
      throw new StateMachineError('状态机未启动')
    }

    const state = this._states.get(this._currentState)
    if (state === undefined) {
      throw new StateMachineError(`当前状态 '${this._currentState}' 不存在`)
    }

    if (state.isFinal) return null

    // 优先使用 onInput 处理函数
    if (state.onInput !== undefined) {
      const target = await state.onInput(ctx)
      if (target !== null) {
        await this.transitionTo(target, ctx)
        return target
      }
      return null
    }

    // 尝试匹配转换规则
    const userInput = ctx.input ?? ''
    for (const [, transition] of state.transitions) {
      if (transition.event !== undefined && transition.event !== userInput) {
        continue
      }
      if (transition.guard !== undefined && !(await transition.guard(ctx))) {
        continue
      }
      await this._executeTransition(transition, ctx)
      return transition.target
    }

    return null
  }

  /** 显式转换到目标状态。 */
  async transitionTo(target: string, ctx: SessionContext): Promise<void> {
    // 目标为确认等待状态且尚未注入时，动态构建并注入该状态
    if (!this._states.has(target) && target.startsWith(CONFIRM_STATE_PREFIX)) {
      this._injectConfirmState(ctx)
    }

    if (!this._states.has(target)) {
      throw new InvalidTransitionError(`目标状态 '${target}' 不存在`)
    }

    if (this._currentState !== null) {
      await this._exitState(this._currentState, ctx)
    }

    await this._enterState(target, ctx)
  }

  private _injectConfirmState(ctx: SessionContext): void {
    /**
     * 动态注入确认等待状态。
     *
     * 由 transitionTo 在目标状态为确认状态时自动调用。
     * 通过 ctx.popConfirmConfig() 读取配置（取出后自动清空，防止重复注入）。
     */
    const config = ctx.popConfirmConfig()
    if (config === null) return

    const { stateName, prompt, onConfirm } = config

    const confirmState = makeState(stateName, {
      onEnter: async (sctx: SessionContext): Promise<void> => {
        await sctx.reply(prompt)
      },
      onInput: async (sctx: SessionContext): Promise<string | null> => {
        const text = (sctx.input ?? '').trim()
        if (CONFIRM_COMMANDS.has(text)) {
          return onConfirm
        }
        await sctx.reply('请发送 /确认 继续，或 /取消 放弃')
        return null
      },
    })

    this.addState(confirmState)
  }

  private async _enterState(stateName: string, ctx: SessionContext): Promise<void> {
    /** 进入指定状态。 */
    const state = this._states.get(stateName)
    if (state === undefined) {
      throw new StateMachineError(`状态 '${stateName}' 不存在`)
    }

    this._currentState = stateName
    ctx.currentState = stateName

    // 记录嵌套状态历史
    if (state.parent !== undefined) {
      this._history.set(state.parent, stateName)
    }

    if (state.onEnter !== undefined) {
      await state.onEnter(ctx)
    }

    if (state.isFinal) return

    if (state.initialSubstate !== undefined) {
      await this._enterState(state.initialSubstate, ctx)
    }
  }

  private async _exitState(stateName: string, ctx: SessionContext): Promise<void> {
    /** 退出指定状态。 */
    const state = this._states.get(stateName)
    if (state === undefined) return

    if (state.onExit !== undefined) {
      await state.onExit(ctx)
    }
  }

  private async _executeTransition(transition: Transition, ctx: SessionContext): Promise<void> {
    /** 执行状态转换。 */
    if (this._currentState !== null) {
      await this._exitState(this._currentState, ctx)
    }

    if (transition.action !== undefined) {
      await transition.action(ctx)
    }

    await this._enterState(transition.target, ctx)
  }
}
