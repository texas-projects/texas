/**
 * HandlerInterceptor 接口 —— Spring 风格的前置/后置/完成后钩子。
 */

import type { Context } from './context.js'
import type { ResolvedHandler } from './mapping.js'

/**
 * 拦截器接口。
 *
 * 执行顺序：
 *   preHandle -> 处理器执行 -> postHandle -> afterCompletion
 *                                             ^ （异常时也会执行）
 */
export interface HandlerInterceptor {
  /** 在处理器执行前调用。返回 false 则中止调用链。 */
  preHandle(ctx: Context, handler: ResolvedHandler): Promise<boolean>

  /** 在处理器成功执行后调用。 */
  postHandle(ctx: Context, handler: ResolvedHandler): Promise<void>

  /** 在完成后调用（无论成功或失败）。用于资源清理。 */
  afterCompletion(ctx: Context, handler: ResolvedHandler, error?: Error): Promise<void>
}
