/** Handler 装饰器共享工具函数。 */

import { HANDLER_METHODS, type MethodMetaEntry } from './symbols.js'

/**
 * 获取或创建指定方法的元数据条目。
 * 多个装饰器作用于同一方法时，会返回同一个 entry 对象。
 */
export function getOrCreateMethodEntry(context: ClassMethodDecoratorContext): MethodMetaEntry {
  const metadata = context.metadata
  if (!metadata) {
    throw new Error(
      `[dispatch] getOrCreateMethodEntry: context.metadata 为空，方法名: ${String(context.name)}`,
    )
  }

  const methods: MethodMetaEntry[] = ((metadata[HANDLER_METHODS] as
    | MethodMetaEntry[]
    | undefined) ??= [])
  let entry = methods.find((m) => m.methodName === context.name)
  if (!entry) {
    entry = {
      methodName: context.name,
      mappingType: 'command',
      trigger: {},
      permission: 0,
      scope: 'all',
      priority: null,
      interceptors: [],
    }
    methods.push(entry)
  }
  return entry
}
