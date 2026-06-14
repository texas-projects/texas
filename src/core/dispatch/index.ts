/**
 * dispatch 模块统一导出入口。
 */

export { Context, FinishError } from './context.js'
// 常量与方法级元数据类型
export { Permission, MessageScope } from './constants.js'
export type { HandlerMeta } from './constants.js'
// TC39 Stage 3 装饰器
export {
  Handler,
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
  OnOffline,
  Permission as PermissionDecorator,
  Scope,
  Priority,
  Interceptor,
  SettingNode,
} from './decorators/index.js'
export type { OnCommandOptions, HandlerOptions, HandlerRegistryData } from './decorators/index.js'
export {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
} from './decorators/symbols.js'
export type { MethodMetaEntry, InterceptorEntry, SettingNodeEntry } from './decorators/symbols.js'
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
export { buildHandlerMethod } from './handler-method-builder.js'
