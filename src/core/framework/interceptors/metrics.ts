/**
 * MetricsInterceptor —— 收集事件处理的 Prometheus 指标（占位实现，Phase 6 接入 prom-client）。
 */

import type { Context } from '@/core/framework/context.js'
import type { HandlerInterceptor } from '@/core/framework/interceptor.js'
import type { ResolvedHandler } from '@/core/framework/mapping.js'

const CTX_KEY_START_TIME = '_metrics_start_time'

/**
 * 指标拦截器：跟踪 handler 调用次数、耗时直方图和错误计数。
 * 当前为占位实现，实际 Prometheus 指标在 Phase 6 连接。
 */
export class MetricsInterceptor implements HandlerInterceptor {
  async preHandle(ctx: Context, _handler: ResolvedHandler): Promise<boolean> {
    ctx.setAttribute(CTX_KEY_START_TIME, Date.now())
    return true
  }

  async postHandle(_ctx: Context, _handler: ResolvedHandler): Promise<void> {
    // 占位：记录 handler 调用计数（prom-client 在 Phase 6 接入）
  }

  async afterCompletion(_ctx: Context, _handler: ResolvedHandler, _error?: Error): Promise<void> {
    // 占位：记录耗时直方图和错误计数（prom-client 在 Phase 6 接入）
  }
}
