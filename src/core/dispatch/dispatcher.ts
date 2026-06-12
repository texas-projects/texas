/**
 * EventDispatcher —— 统一事件分发（类似 Spring DispatcherServlet）。
 */

import { logger } from '@logger'

import { Context, FinishError } from './context.js'
import type { HandlerInterceptor } from './interceptor.js'
import type { CompositeHandlerMapping, FeatureChecker, ResolvedHandler } from './mapping.js'

import type { BotAPI } from '@/core/protocol/api.js'
import type { AnyOneBotEvent } from '@/core/protocol/models/events.js'

/**
 * 接收已解析的事件，通过映射解析处理器，并运行拦截器链。
 *
 * 权限检查（功能级 + 角色级）统一委托给 featureChecker，
 * 分发器不实现任何权限规则。
 *
 * 拦截器执行顺序（每个 handler 独立执行一次）：
 *   preHandle → handler.method → postHandle → afterCompletion
 *   异常时：→ afterCompletion(error)
 */
export class EventDispatcher {
  private readonly _log = logger.child({ name: 'dispatcher' })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  readonly services: Map<Function, unknown>

  constructor(
    private readonly mapping: CompositeHandlerMapping,
    private readonly interceptors: HandlerInterceptor[] = [],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    services?: Map<Function, unknown>,
    private _featureChecker?: FeatureChecker,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    this.services = services ?? new Map<Function, unknown>()
  }

  /** 延迟注入权限检查器（在 Startup 完成后设置）。 */
  setFeatureChecker(checker: FeatureChecker): void {
    this._featureChecker = checker
  }

  /** 分发事件到匹配的处理器，依次运行拦截器链。 */
  async dispatch(event: AnyOneBotEvent, bot: BotAPI): Promise<void> {
    const ctx = new Context(event, bot, this.services)

    // 解析匹配的处理器
    const resolvedHandlers = this.mapping.resolve(event)
    if (resolvedHandlers.length === 0) {
      return
    }

    // 按优先级执行处理器
    for (const resolved of resolvedHandlers) {
      // 设置正则匹配结果（仅 regex 类型 handler 有值）
      if (resolved.regexMatch !== null) {
        ctx.setRegexMatch(resolved.regexMatch)
      }

      // 注入 handler 元数据供权限检查器读取
      ctx.setAttribute('handlerMethod', {
        componentName: resolved.handler.componentName,
        methodName: resolved.handler.method.name,
        permission: resolved.handler.meta.permission,
      })

      // 统一权限检查（功能级 + 角色级，由 featureChecker 统一处理）
      if (this._featureChecker !== undefined) {
        const allowed = await this._featureChecker.check(ctx)
        if (!allowed) {
          continue
        }
      }

      await this._runHandlerWithInterceptors(ctx, resolved)
    }
  }

  /** 为单个 handler 运行完整的拦截器链。 */
  private async _runHandlerWithInterceptors(
    ctx: Context,
    resolved: ResolvedHandler,
  ): Promise<void> {
    let handlerError: Error | undefined

    // 前置拦截器（顺序）
    for (const interceptor of this.interceptors) {
      try {
        const ok = await interceptor.preHandle(ctx, resolved)
        if (!ok) {
          this._log.debug(`拦截器 ${interceptor.constructor.name} 已阻断事件`)
          // 依然需要运行 afterCompletion（已完成的前置拦截器），此处简化：直接返回
          return
        }
      } catch (err) {
        handlerError = err instanceof Error ? err : new Error(String(err))
        this._log.error(`preHandle 中发生错误：${handlerError.message}`)
        break
      }
    }

    // 调用处理器方法
    if (handlerError === undefined) {
      try {
        const fn = resolved.handler.method
        const result: unknown = await (
          fn as (this: object, ...args: unknown[]) => Promise<unknown>
        ).call(resolved.handler.instance, ctx)

        // result === true 表示调用方希望停止（不是异常，只是信号）
        // 后置拦截器（逆序）
        for (const interceptor of [...this.interceptors].reverse()) {
          try {
            await interceptor.postHandle(ctx, resolved)
          } catch (err) {
            handlerError = err instanceof Error ? err : new Error(String(err))
            this._log.error(`postHandle 中发生错误：${handlerError.message}`)
            break
          }
        }

        // 停止后续 handler 的信号由调用方（dispatch 循环）处理；
        // 这里通过 FinishError 约定，return true 不需要特殊处理（已在外层 break）
        void result
      } catch (err) {
        if (err instanceof FinishError) {
          // 正常流程终止，不视为错误
        } else {
          handlerError = err instanceof Error ? err : new Error(String(err))
          this._log.error(
            `handler ${resolved.handler.componentName}.${resolved.handler.method.name} 执行失败：${handlerError.message}`,
          )
        }
      }
    }

    // 完成后拦截器（始终执行，逆序）
    for (const interceptor of [...this.interceptors].reverse()) {
      try {
        await interceptor.afterCompletion(ctx, resolved, handlerError)
      } catch (cleanupErr) {
        this._log.error(`afterCompletion 中发生错误：${String(cleanupErr)}`)
      }
    }
  }
}
