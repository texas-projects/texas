/**
 * 将新装饰器元数据（HandlerRegistryData + MethodMetaEntry）转换为
 * CompositeHandlerMapping 消费的 HandlerMethod 格式。
 */

import type { HandlerMeta, Permission } from './constants.js'
import type { MethodMetaEntry } from './decorators/symbols.js'
import type { HandlerMethod } from './mapping.js'
import type { HandlerRegistryData } from './registry.js'

/**
 * 将单条方法元数据条目转换为 HandlerMethod。
 *
 * @param data        - handler 注册数据（含类引用、选项、方法列表）
 * @param methodEntry - 单个方法的路由元数据
 * @param instance    - handler 类的实例（已完成依赖注入）
 * @returns 可直接传入 CompositeHandlerMapping.register() 的 HandlerMethod 对象
 */
export function buildHandlerMethod(
  data: HandlerRegistryData,
  methodEntry: MethodMetaEntry,
  instance: object,
): HandlerMethod {
  const trigger = methodEntry.trigger

  // 将新格式 trigger 字段映射到旧格式 HandlerMeta 字段
  const meta: HandlerMeta = {
    mappingType: methodEntry.mappingType,
    // MethodMetaEntry.permission 是 number，强制转为 Permission 联合类型
    permission: methodEntry.permission as Permission,
    messageScope: methodEntry.scope as HandlerMeta['messageScope'],
    priority: methodEntry.priority,
    displayName: '',
    description: '',
    // command
    cmd: typeof trigger.cmd === 'string' ? trigger.cmd : undefined,
    aliases: trigger.aliases instanceof Set ? (trigger.aliases as Set<string>) : undefined,
    // regex
    pattern: typeof trigger.pattern === 'string' ? trigger.pattern : undefined,
    compiledPattern:
      trigger.compiledPattern instanceof RegExp ? trigger.compiledPattern : undefined,
    // keyword
    keywords: trigger.keywords instanceof Set ? (trigger.keywords as Set<string>) : undefined,
    // startsWith
    prefix: typeof trigger.prefix === 'string' ? trigger.prefix : undefined,
    // endsWith
    suffix: typeof trigger.suffix === 'string' ? trigger.suffix : undefined,
    // fullMatch
    text: typeof trigger.text === 'string' ? trigger.text : undefined,
    // event_type
    eventType: typeof trigger.eventType === 'string' ? trigger.eventType : undefined,
    noticeType:
      trigger.noticeType === null || typeof trigger.noticeType === 'string'
        ? trigger.noticeType
        : undefined,
    subType:
      trigger.subType === null || typeof trigger.subType === 'string' ? trigger.subType : undefined,
    requestType:
      trigger.requestType === null || typeof trigger.requestType === 'string'
        ? trigger.requestType
        : undefined,
  }

  // 获取实例上对应方法名的函数引用
  const methodFn = (instance as Record<string | symbol, unknown>)[methodEntry.methodName]
  if (typeof methodFn !== 'function') {
    throw new Error(
      `buildHandlerMethod: handler "${data.options.name}" 上找不到方法 "${String(methodEntry.methodName)}"`,
    )
  }

  const priority = methodEntry.priority ?? data.options.defaultPriority ?? 50

  // TODO: classInterceptors 和 methodInterceptors 已由装饰器收集，
  // 但当前 HandlerMethod 类型无对应字段，EventDispatcher 尚未支持
  // 按 Handler/方法级别执行声明式拦截器管线。待 EventDispatcher 适配后移除此注释。
  return {
    instance,

    method: methodFn,
    priority,
    componentName: data.options.name,
    meta,
  }
}
