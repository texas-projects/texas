// src/core/dispatch/decorators/index.ts
/** dispatch 装饰器 barrel 导出。 */

export { Handler, type HandlerOptions, type HandlerRegistryData } from './handler.js'
export {
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
  type OnCommandOptions,
} from './routing.js'
export { Permission, Scope, Priority } from './method-options.js'
export { Interceptor } from './interceptor.js'
export { SettingNode, type SettingNodeOptions } from './setting-node.js'
export {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
  type MethodMetaEntry,
  type InterceptorEntry,
  type SettingNodeEntry,
} from './symbols.js'
