/** Handler 方法级选项装饰器：@Permission、@Scope、@Priority。 */

import { getOrCreateMethodEntry } from './utils.js'

/** 设置方法处理器的权限级别（对应 Permission 枚举值）。 */
export function Permission(level: number) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.permission = level
  }
}

/** 设置方法处理器的消息作用域（group / private / all）。 */
export function Scope(scope: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.scope = scope
  }
}

/** 设置方法处理器的路由优先级（数值越大越先匹配）。 */
export function Priority(n: number) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.priority = n
  }
}
