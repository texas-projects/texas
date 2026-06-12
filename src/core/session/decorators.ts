/**
 * 会话装饰器 —— 标记会话类和状态处理方法（TypeScript 移植自 decorators.py）。
 *
 * TypeScript 装饰器使用 Symbol 作为元数据键，通过函数属性附加元数据。
 * 由于 TypeScript 不支持运行时泛型，装饰器元数据以 unknown 类型存储。
 */

import { TimeoutMode } from './enums.js'
import type { TimeoutConfig } from './timeout.js'
import { makeTimeoutConfig } from './timeout.js'

// ── 元数据键 ──

export const SESSION_META = '__session_meta__'
export const STATE_META = '__state_meta__'
export const INPUT_META = '__input_meta__'
export const EXIT_META = '__exit_meta__'

// ── 元数据类型 ──

/** 会话类元数据。 */
export interface SessionMeta {
  timeout: TimeoutConfig
  displayName: string
  description: string
}

/** 状态方法元数据。 */
export interface StateMeta {
  name: string
  initial: boolean
  final: boolean
  parent: string | undefined
  displayName: string
}

/** 输入处理器元数据。 */
export interface InputMeta {
  stateName: string
}

/** 退出回调元数据。 */
export interface ExitMeta {
  stateName: string
}

// ── 带元数据的函数类型 ──

interface FunctionWithMeta {
  [SESSION_META]?: SessionMeta
  [STATE_META]?: StateMeta
  [INPUT_META]?: InputMeta
  [EXIT_META]?: ExitMeta
}

function assignMeta<K extends keyof FunctionWithMeta>(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  target: Function,
  key: K,
  value: FunctionWithMeta[K],
): void {
  Object.assign(target, { [key]: value })
}

// ── 装饰器 ──

/**
 * 标记类为交互式会话。
 *
 * 使用方式：
 * ```ts
 * @interactiveSession({ timeout: 300 })
 * class FeedbackSession extends InteractiveSession<FeedbackData> {
 *   ...
 * }
 * ```
 */
export function interactiveSession(options: {
  timeout?: TimeoutConfig | number
  displayName?: string
  description?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const rawTimeout = options.timeout ?? 300
    const timeout =
      typeof rawTimeout === 'number'
        ? makeTimeoutConfig({ duration: rawTimeout, mode: TimeoutMode.SILENT })
        : rawTimeout

    const meta: SessionMeta = {
      timeout,
      displayName: options.displayName ?? '',
      description: options.description ?? '',
    }

    assignMeta(target, SESSION_META, meta)
  }
}

/**
 * 标记方法为状态入口（onEnter），进入该状态时自动调用。
 *
 * 使用方式：
 * ```ts
 * @state({ name: 'ask_name', initial: true })
 * async askName(ctx: SessionContext): Promise<void> { ... }
 * ```
 */
export function state(options: {
  name: string
  initial?: boolean
  final?: boolean
  parent?: string
  displayName?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: StateMeta = {
      name: options.name,
      initial: options.initial ?? false,
      final: options.final ?? false,
      parent: options.parent,
      displayName: options.displayName ?? '',
    }
    assignMeta(target, STATE_META, meta)
  }
}

/**
 * 标记方法为状态输入处理器。
 *
 * 用户在该状态下发送消息时调用此方法。
 * 方法应返回目标状态名（触发转换）或 null（停留当前状态）。
 */
export function onInput(stateName: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    assignMeta(target, INPUT_META, { stateName })
  }
}

/**
 * 标记方法为状态退出回调。
 *
 * 离开该状态时自动调用。
 */
export function onExit(stateName: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    assignMeta(target, EXIT_META, { stateName })
  }
}
