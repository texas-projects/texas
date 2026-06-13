/**
 * dispatch 模块统一导出入口。
 */

export { Context, FinishError } from './context.js'
export {
  handler,
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
  OnNotice,
  OnRequest,
  OnMessageSent,
  OnPoke,
  OnEssence,
  OnBotOffline,
  Permission,
  MessageScope,
  SettingNode,
  settingNodeRegistry,
} from './decorators.js'
export type {
  HandlerMeta,
  HandlerOptions,
  OnCommandOptions,
  SettingNodeMeta,
  SettingNodeOptions,
  SettingValueType,
} from './decorators.js'
export { EventDispatcher } from './dispatcher.js'
export type { FeatureChecker } from './mapping.js'
export {
  CompositeHandlerMapping,
  CommandHandlerMapping,
  RegexHandlerMapping,
  KeywordHandlerMapping,
  StartsWithHandlerMapping,
  EndsWithHandlerMapping,
  FullMatchHandlerMapping,
  EventTypeHandlerMapping,
} from './mapping.js'
export type { HandlerMethod, ResolvedHandler } from './mapping.js'
export { handlerRegistry, HandlerRegistry } from './registry.js'
export type {
  HandlerRegistryEntry,
  MethodMeta,
  HandlerMeta as HandlerClassMeta,
} from './registry.js'
export type { HandlerInterceptor } from './interceptor.js'
