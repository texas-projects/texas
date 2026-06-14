/** @Interceptor 装饰器：声明式绑定拦截器，可作用于类或方法。 */

import { HANDLER_CLASS_INTERCEPTORS, type InterceptorEntry } from './symbols.js'
import { getOrCreateMethodEntry } from './utils.js'

/**
 * 声明式绑定拦截器。可用于类（对所有方法生效）或方法（仅对该方法生效）。
 *
 * @param interceptorClass - 拦截器构造函数
 * @param options - 传递给拦截器构造函数的可选配置
 */
export function Interceptor(
  interceptorClass: new (options?: unknown) => unknown,
  options?: unknown,
) {
  const entry: InterceptorEntry = { interceptorClass, options }

  function decorator(
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind === 'class') {
      // 类级别：写入 HANDLER_CLASS_INTERCEPTORS，对该类所有方法生效
      const metadata = context.metadata
      if (!metadata) throw new Error('[dispatch] @Interceptor: context.metadata 不可用')
      const list: InterceptorEntry[] = ((metadata[HANDLER_CLASS_INTERCEPTORS] as
        | InterceptorEntry[]
        | undefined) ??= [])
      list.push(entry)
    } else {
      // 方法级别：复用 getOrCreateMethodEntry，仅对该方法生效
      const methodEntry = getOrCreateMethodEntry(context)
      ;(methodEntry.interceptors as InterceptorEntry[]).push(entry)
    }
  }

  return decorator
}
