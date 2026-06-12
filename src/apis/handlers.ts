/**
 * 处理器管理 API 端点 —— 列出已注册的组件和处理器。
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import { handlerRegistry } from '@/core/dispatch/registry.js'
import { ok } from '@/core/response.js'

/**
 * 处理器管理路由插件。
 */
const handlerRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/handlers — 列出所有已注册的控制器及其处理器。 */
  app.get('/api/handlers', async (_req: FastifyRequest, reply: FastifyReply) => {
    const controllers = [...handlerRegistry.values()].map((entry) => {
      const methods: Record<string, unknown>[] = entry.methods.map((methodMeta) => ({
        name: methodMeta.method.name || 'anonymous',
        mappingType: methodMeta.mappingType,
        displayName: methodMeta.displayName,
        description: methodMeta.description,
        permission: methodMeta.permission,
        messageScope: methodMeta.messageScope,
        cmd: methodMeta.cmd as string | undefined,
        pattern: methodMeta.pattern as string | undefined,
        keywords:
          methodMeta.keywords instanceof Set
            ? [...(methodMeta.keywords as Set<string>)]
            : undefined,
        prefix: methodMeta.prefix as string | undefined,
        text: methodMeta.text as string | undefined,
      }))

      return {
        name: entry.meta.name,
        displayName: entry.meta.displayName,
        description: entry.meta.description,
        tags: entry.meta.tags,
        system: entry.meta.system,
        methods,
      }
    })

    await reply.send(ok({ controllers }))
  })
}

export default handlerRoutes
export { handlerRoutes }
