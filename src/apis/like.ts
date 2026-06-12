/**
 * 点赞管理 REST API —— /api/like。
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import type { ServiceRegistry } from '@/core/lifecycle/service-registry.js'
import { ok } from '@/core/response.js'
import type { LikeService } from '@/services/like.js'

function getServiceRegistry(app: FastifyInstance): ServiceRegistry {
  const state = (app as unknown as { state: { serviceRegistry: ServiceRegistry } }).state
  return state.serviceRegistry
}

async function getLikeSvc(app: FastifyInstance): Promise<LikeService> {
  const { LikeService: Cls } = await import('@/services/like.js')
  const registry = getServiceRegistry(app)

  return registry.getTyped(Cls, 'like_service')
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b)
}

/**
 * 点赞管理路由插件。
 */
const likeRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/like/tasks — 分页查询已注册的定时点赞任务列表。 */
  app.get(
    '/api/like/tasks',
    async (
      req: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>,
      reply: FastifyReply,
    ) => {
      const svc = await getLikeSvc(app)

      const page = req.query.page ? parseInt(req.query.page, 10) : 1
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20

      const [items, total] = await svc.listTasks({ page, pageSize })
      const taskItems = items.map((t: Record<string, unknown>) => ({
        id: t.id,
        qq: String(t.qq as bigint | number),
        registeredAt:
          t.registeredAt instanceof Date
            ? t.registeredAt.toISOString()
            : (t.registeredAt as string),
        registeredGroupId:
          t.registeredGroupId !== null && t.registeredGroupId !== undefined
            ? String(t.registeredGroupId as bigint | number)
            : null,
      }))

      await reply.send(
        ok({ items: taskItems, total, page, pageSize, pages: ceilDiv(total, pageSize) }),
      )
    },
  )

  /** POST /api/like/tasks — 新增定时点赞任务。 */
  app.post(
    '/api/like/tasks',
    async (req: FastifyRequest<{ Body: { qq: number } }>, reply: FastifyReply) => {
      const svc = await getLikeSvc(app)

      const result = await svc.registerTask(BigInt(req.body.qq), null)
      if (result.alreadyExists) {
        await reply.status(409).send({ code: -1, data: null, message: '该用户已存在定时点赞任务' })
        return
      }
      await reply.send(ok({ qq: req.body.qq }))
    },
  )

  /** POST /api/like/tasks/:qq/cancel — 取消指定用户的定时点赞任务。 */
  app.post(
    '/api/like/tasks/:qq/cancel',
    async (req: FastifyRequest<{ Params: { qq: string } }>, reply: FastifyReply) => {
      const svc = await getLikeSvc(app)

      const qq = BigInt(req.params.qq)
      const deleted = await svc.cancelTask(qq)
      if (!deleted) {
        await reply.status(404).send({ code: -1, data: null, message: '任务不存在' })
        return
      }
      await reply.send(ok({ qq: req.params.qq }))
    },
  )

  /** GET /api/like/history — 分页查询点赞执行历史。 */
  app.get(
    '/api/like/history',
    async (
      req: FastifyRequest<{
        Querystring: {
          qq?: string
          source?: string
          dateFrom?: string
          dateTo?: string
          page?: string
          pageSize?: string
        }
      }>,
      reply: FastifyReply,
    ) => {
      const svc = await getLikeSvc(app)
      const qq = req.query.qq ? BigInt(req.query.qq) : undefined
      // LikeSource 为数据库枚举：'manual'（手动）| 'scheduled'（定时）
      const sourceStr = req.query.source
      const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : undefined
      const dateTo = req.query.dateTo ? new Date(req.query.dateTo) : undefined
      const page = req.query.page ? parseInt(req.query.page, 10) : 1
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20

      const { LikeSource } = await import('#prisma/main')
      const source =
        sourceStr !== undefined && Object.values(LikeSource).includes(sourceStr as never)
          ? (sourceStr as (typeof LikeSource)[keyof typeof LikeSource])
          : undefined

      const [items, total] = await svc.listHistory({ qq, source, dateFrom, dateTo, page, pageSize })
      const historyItems = items.map((h: Record<string, unknown>) => ({
        id: h.id,
        qq: String(h.qq as bigint | number),
        times: h.times,
        triggeredAt:
          h.triggeredAt instanceof Date ? h.triggeredAt.toISOString() : (h.triggeredAt as string),
        source: h.source,
        success: h.success,
      }))

      await reply.send(
        ok({ items: historyItems, total, page, pageSize, pages: ceilDiv(total, pageSize) }),
      )
    },
  )
}

export default likeRoutes
export { likeRoutes }
