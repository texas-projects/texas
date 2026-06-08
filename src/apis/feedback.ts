/**
 * 用户反馈 REST API 路由 —— /api/feedbacks。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

import type { ServiceRegistry } from '@/core/registries/service-registry.js'
import { ok, fail } from '@/core/utils/response.js'
import type { FeedbackService } from '@/services/feedback.js'

function getServiceRegistry(app: FastifyInstance): ServiceRegistry {
  const state = (app as unknown as { state: { serviceRegistry: ServiceRegistry } }).state
  return state.serviceRegistry
}

async function getFeedbackSvc(app: FastifyInstance): Promise<FeedbackService> {
  const { FeedbackService: Cls } = await import('@/services/feedback.js')
  const registry = getServiceRegistry(app)

  return registry.getTyped(Cls, 'feedback_service')
}

interface UpdateStatusBody {
  status: string
  adminReply?: string | null
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b)
}

function feedbackToDict(f: Record<string, unknown>): Record<string, unknown> {
  return {
    id: f.id,
    userId: String(f.userId),

    groupId:
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      f.groupId != null ? String(f.groupId) : null,
    content: f.content,
    status: f.status,
    feedbackType: f.feedbackType ?? null,
    source: f.source,
    adminReply: f.adminReply ?? null,
    createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
    updatedAt: f.updatedAt instanceof Date ? f.updatedAt.toISOString() : f.updatedAt,
    processedAt:
      f.processedAt instanceof Date ? f.processedAt.toISOString() : (f.processedAt ?? null),
  }
}

/**
 * 反馈管理路由插件。
 */
export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/feedbacks — 分页查询反馈列表。 */
  app.get(
    '/api/feedbacks',
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string
          pageSize?: string
          status?: string
          feedbackType?: string
          userId?: string
          source?: string
          search?: string
        }
      }>,
      reply: FastifyReply,
    ) => {
      const svc = await getFeedbackSvc(app)

      const page = req.query.page ? parseInt(req.query.page, 10) : 1
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20

      // listFeedbacks 返回 PageResult<Feedback>，格式为 { items, total }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const result = (await (svc.listFeedbacks as any)({
        page,
        pageSize,
        status: req.query.status,
        feedbackType: req.query.feedbackType,
        userId: req.query.userId ? BigInt(req.query.userId) : undefined,
        source: req.query.source,
        search: req.query.search,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as { items: any[]; total: number }

      const pages = ceilDiv(result.total, pageSize)
      await reply.send(
        ok({
          items: result.items.map((f) => feedbackToDict(f as Record<string, unknown>)),
          total: result.total,
          page,
          pageSize,
          pages,
        }),
      )
    },
  )

  /** GET /api/feedbacks/:feedbackId — 获取单个反馈详情。 */
  app.get(
    '/api/feedbacks/:feedbackId',
    async (req: FastifyRequest<{ Params: { feedbackId: string } }>, reply: FastifyReply) => {
      const svc = await getFeedbackSvc(app)
      const feedback = await svc.getFeedback(req.params.feedbackId)

      if (feedback === null) {
        await reply.status(404).send(fail('Feedback not found'))
        return
      }

      await reply.send(ok(feedbackToDict(feedback as unknown as Record<string, unknown>)))
    },
  )

  /** POST /api/feedbacks/:feedbackId/status — 更新反馈状态。 */
  app.post(
    '/api/feedbacks/:feedbackId/status',
    async (
      req: FastifyRequest<{
        Params: { feedbackId: string }
        Body: UpdateStatusBody
      }>,
      reply: FastifyReply,
    ) => {
      const svc = await getFeedbackSvc(app)
      const { status, adminReply } = req.body

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const feedback = (await (svc.updateStatus as any)(
        req.params.feedbackId,
        status,
        adminReply ?? undefined,
      )) as Record<string, unknown> | null
      if (feedback === null) {
        await reply.status(404).send(fail('Feedback not found'))
        return
      }

      await reply.send(ok(null, 'Status updated successfully'))
    },
  )
}
