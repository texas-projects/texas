/**
 * SessionInterceptor —— 会话消息路由拦截器（存根，会话系统在 Phase 4 实现）。
 */

import type { Context } from '@/core/framework/context.js'
import type { HandlerInterceptor } from '@/core/framework/interceptor.js'
import type { ResolvedHandler } from '@/core/framework/mapping.js'

/**
 * 会话拦截器：在 handler 执行前检查是否有活跃会话并路由消息。
 * 当前为存根实现，会话系统在 Phase 4 接入。
 */
export class SessionInterceptor implements HandlerInterceptor {
  async preHandle(_ctx: Context, _handler: ResolvedHandler): Promise<boolean> {
    // Phase 4: 检查活跃会话并路由消息
    return true
  }

  async postHandle(_ctx: Context, _handler: ResolvedHandler): Promise<void> {
    // 无操作
  }

  async afterCompletion(_ctx: Context, _handler: ResolvedHandler, _error?: Error): Promise<void> {
    // 无操作
  }
}
