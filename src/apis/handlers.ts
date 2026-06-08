/**
 * 处理器管理 API 端点 —— 列出已注册的组件和处理器。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

import { componentRegistry, handlerRegistry } from '@/core/framework/decorators.js'
import { ok } from '@/core/utils/response.js'

/**
 * 处理器管理路由插件。
 */
export async function handlerRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/handlers — 列出所有已注册的控制器及其处理器。 */
  app.get('/api/handlers', async (_req: FastifyRequest, reply: FastifyReply) => {
    const controllers = [...componentRegistry.values()].map((meta) => {
      // 收集该组件的所有 handler 方法元数据
      const instance = new (meta.target as new () => object)()
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>
      const methods: Record<string, unknown>[] = []

      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (methodName === 'constructor') continue
        const fn = proto[methodName]
        if (typeof fn !== 'function') continue

        const handlerMetas = handlerRegistry.get(fn)
        if (handlerMetas && handlerMetas.length > 0) {
          for (const hm of handlerMetas) {
            methods.push({
              name: methodName,
              mappingType: hm.mappingType,
              displayName: hm.displayName,
              description: hm.description,
              permission: hm.permission,
              messageScope: hm.messageScope,
              cmd: hm.cmd,
              pattern: hm.pattern,
              keywords: hm.keywords ? [...hm.keywords] : undefined,
              prefix: hm.prefix,
              text: hm.text,
            })
          }
        }
      }

      return {
        name: meta.name,
        displayName: meta.displayName,
        description: meta.description,
        tags: meta.tags,
        system: meta.system,
        defaultEnabled: meta.defaultEnabled,
        methods,
      }
    })

    await reply.send(ok({ controllers }))
  })
}
