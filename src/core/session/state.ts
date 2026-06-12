/**
 * 状态与转换定义（TypeScript 移植自 state.py）。
 */

import type { SessionContext } from './context.js'

/** 状态转换。 */
export interface Transition {
  /** 目标状态名称。 */
  target: string
  /** 转换守卫条件，返回 false 则不执行转换。 */
  guard?: (ctx: SessionContext) => Promise<boolean>
  /** 转换过程中执行的动作。 */
  action?: (ctx: SessionContext) => Promise<void>
  /** 触发事件名称（配置式定义使用）。 */
  event?: string
}

/** 状态定义。 */
export interface State {
  /** 状态名称。 */
  name: string
  /** 进入状态时的回调。 */
  onEnter?: (ctx: SessionContext) => Promise<void>
  /** 退出状态时的回调。 */
  onExit?: (ctx: SessionContext) => Promise<void>
  /** 接收用户输入的处理函数，返回目标状态名或 null（停留）。 */
  onInput?: (ctx: SessionContext) => Promise<string | null>
  /** 按事件名索引的转换字典（配置式定义使用）。 */
  transitions: Map<string, Transition>
  /** 父状态名称（嵌套状态）。 */
  parent?: string
  /** 默认子状态（嵌套状态）。 */
  initialSubstate?: string
  /** 是否为终止状态。 */
  isFinal: boolean
  /** 自定义元数据。 */
  metadata: Record<string, unknown>
}

/** 创建状态定义（填充默认值）。 */
export function makeState(
  name: string,
  overrides?: Partial<Omit<State, 'name' | 'transitions' | 'isFinal' | 'metadata'>>,
  options?: {
    transitions?: Map<string, Transition>
    isFinal?: boolean
    metadata?: Record<string, unknown>
  },
): State {
  const transitions: Map<string, Transition> = options?.transitions ?? new Map<string, Transition>()
  return {
    name,
    transitions,
    isFinal: options?.isFinal ?? false,
    metadata: options?.metadata ?? {},
    ...overrides,
  }
}
