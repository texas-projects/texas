/**
 * session 模块统一导出入口。
 */

export { InteractiveSession } from './base.js'
export type { SessionData } from './base.js'
export { SessionManager } from './manager.js'
export { SessionContext } from './context.js'
export type { ConfirmConfig } from './context.js'
export { TimeoutMode } from './enums.js'
export { interactiveSession, state, onInput, onExit } from './decorators.js'
export type { SessionMeta, StateMeta, InputMeta, ExitMeta } from './decorators.js'
export { sessionKey, sessionDataKey } from './keys.js'
export { StateMachine, StateMachineError, InvalidTransitionError } from './state-machine.js'
export { makeState } from './state.js'
export type { State, Transition } from './state.js'
export { makeTimeoutConfig, resolveTimeout } from './timeout.js'
export type { TimeoutConfig } from './timeout.js'
export { CANCEL_COMMANDS, CONFIRM_COMMANDS, CONFIRM_STATE_PREFIX } from './commands.js'
