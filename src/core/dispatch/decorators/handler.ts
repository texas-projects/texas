// src/core/dispatch/decorators/handler.ts

import { SERVICE_INJECTS, type InjectEntry } from '../../lifecycle/decorators/symbols.js'
import { handlerRegistry, type HandlerOptions, type HandlerRegistryData } from '../registry.js'

import {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
  type MethodMetaEntry,
  type InterceptorEntry,
  type SettingNodeEntry,
} from './symbols.js'

export type { HandlerOptions, HandlerRegistryData }

/**
 * 注册一个 Handler 类。收集所有方法/类装饰器的元数据，注册到 handlerRegistry。
 */
export function Handler(opts: HandlerOptions) {
  return function (target: new (...args: unknown[]) => unknown, context: ClassDecoratorContext) {
    const metadata = context.metadata
    if (!metadata) throw new Error(`@Handler: context.metadata 不可用`)
    const defaultPriority = opts.defaultPriority ?? 50

    // 使用 Object.hasOwn 防止继承链污染
    const methods = (
      Object.hasOwn(metadata, HANDLER_METHODS) ? metadata[HANDLER_METHODS] : []
    ) as MethodMetaEntry[]

    const classInterceptors = (
      Object.hasOwn(metadata, HANDLER_CLASS_INTERCEPTORS)
        ? metadata[HANDLER_CLASS_INTERCEPTORS]
        : []
    ) as InterceptorEntry[]

    const settingNodes = (
      Object.hasOwn(metadata, HANDLER_SETTINGS) ? metadata[HANDLER_SETTINGS] : []
    ) as SettingNodeEntry[]

    const injects = (
      Object.hasOwn(metadata, SERVICE_INJECTS) ? metadata[SERVICE_INJECTS] : []
    ) as InjectEntry[]

    // 填充默认优先级
    for (const method of methods) {
      method.priority ??= defaultPriority
    }

    // 拼接 SettingNode key 前缀
    const prefixedSettings = settingNodes.map((node) => ({
      ...node,
      key: `${opts.name}.${node.key}`,
    }))

    const data: HandlerRegistryData = {
      options: opts,
      handlerClass: target,
      methods,
      classInterceptors,
      settingNodes: prefixedSettings,
      injects,
    }

    // 注册到全局 handlerRegistry
    handlerRegistry.register(data)
  }
}
