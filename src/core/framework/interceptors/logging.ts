/**
 * LoggingInterceptor —— 记录事件处理详情。
 */

import { logger, type Logger } from '../../logging/setup.js'
import type { Context } from '../context.js'
import type { HandlerInterceptor } from '../interceptor.js'
import type { ResolvedHandler } from '../mapping.js'

const CTX_KEY_START_TIME = '_logging_start_time'

/** 日志拦截器：记录事件处理的开始时间、完成耗时及错误信息。 */
export class LoggingInterceptor implements HandlerInterceptor {
  private readonly _log: Logger = logger.child({ name: 'dispatcher' })

  async preHandle(ctx: Context, _handler: ResolvedHandler): Promise<boolean> {
    ctx.setAttribute(CTX_KEY_START_TIME, Date.now())
    const groupId = ctx.groupId !== undefined ? String(ctx.groupId) : 'N/A'
    this._log.debug(
      `正在处理事件 post_type=${ctx.event.post_type} user_id=${String(ctx.userId)} group_id=${groupId}`,
    )
    return true
  }

  async postHandle(_ctx: Context, _handler: ResolvedHandler): Promise<void> {
    // 后置日志在 afterCompletion 中统一记录，此处为空
  }

  async afterCompletion(ctx: Context, handler: ResolvedHandler, error?: Error): Promise<void> {
    const startTime = ctx.getAttribute(CTX_KEY_START_TIME)
    const durationMs = typeof startTime === 'number' ? Date.now() - startTime : 0

    const handlerName = `${handler.handler.componentName}.${handler.handler.method.name}`

    if (error) {
      this._log.error(
        `${handlerName} 处理失败，耗时 ${String(durationMs)}ms，错误：${error.message}`,
      )
    } else {
      this._log.debug(`${handlerName} 处理完成，耗时 ${String(durationMs)}ms`)
    }
  }
}
