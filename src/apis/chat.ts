/**
 * 聊天记录 REST API 路由 —— /api/chat。
 */

import { getLogger } from '@logger'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import type { ServiceRegistry } from '@/core/lifecycle/service-registry.js'
import { ok, fail } from '@/core/response.js'

const log = getLogger('chat')

function getServiceRegistry(app: FastifyInstance): ServiceRegistry {
  const state = (app as unknown as { state: { serviceRegistry: ServiceRegistry } }).state
  return state.serviceRegistry
}

function getAppState(app: FastifyInstance): Record<string, unknown> {
  return (app as unknown as { state: Record<string, unknown> }).state
}

/**
 * 聊天记录管理路由插件。
 */
const chatRoutes: FastifyPluginAsync = async (app) => {
  // ── 消息查询 ──

  /** GET /api/chat/messages/group/:groupId — 获取群聊消息列表（游标分页）。 */
  app.get(
    '/api/chat/messages/group/:groupId',
    async (
      req: FastifyRequest<{
        Params: { groupId: string }
        Querystring: {
          before?: string
          limit?: string
          keyword?: string
          userId?: string
          startDate?: string
          endDate?: string
        }
      }>,
      reply: FastifyReply,
    ) => {
      const { ChatHistoryService } = await import('@/core/chat/index.js')
      const registry = getServiceRegistry(app)

      const svc = registry.getTyped(ChatHistoryService, 'chat_service')

      const groupId = BigInt(req.params.groupId)
      const q = req.query

      const result = await svc.getGroupHistory(groupId, {
        before: q.before ? new Date(q.before) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
        keyword: q.keyword,
        userId: q.userId ? BigInt(q.userId) : undefined,
        startDate: q.startDate ? new Date(q.startDate) : undefined,
        endDate: q.endDate ? new Date(q.endDate) : undefined,
      })
      await reply.send(ok(result))
    },
  )

  /** GET /api/chat/messages/private/:userId — 获取私聊消息列表。 */
  app.get(
    '/api/chat/messages/private/:userId',
    async (
      req: FastifyRequest<{
        Params: { userId: string }
        Querystring: { before?: string; limit?: string }
      }>,
      reply: FastifyReply,
    ) => {
      const { ChatHistoryService } = await import('@/core/chat/index.js')
      const registry = getServiceRegistry(app)

      const svc = registry.getTyped(ChatHistoryService, 'chat_service')

      const userId = BigInt(req.params.userId)
      const q = req.query

      const result = await svc.getPrivateHistory(userId, {
        before: q.before ? new Date(q.before) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
      })
      await reply.send(ok(result))
    },
  )

  /** GET /api/chat/messages/:messageId/context — 获取消息上下文（前后 N 条）。 */
  app.get(
    '/api/chat/messages/:messageId/context',
    async (
      req: FastifyRequest<{
        Params: { messageId: string }
        Querystring: { createdAt: string; context?: string }
      }>,
      reply: FastifyReply,
    ) => {
      const { ChatHistoryService } = await import('@/core/chat/index.js')
      const registry = getServiceRegistry(app)

      const svc = registry.getTyped(ChatHistoryService, 'chat_service')

      const messageId = BigInt(req.params.messageId)
      const createdAt = new Date(req.query.createdAt)
      const contextSize = req.query.context ? parseInt(req.query.context, 10) : 5

      const result = await svc.getMessageContext(messageId, createdAt, contextSize)
      await reply.send(ok(result))
    },
  )

  // ── 归档管理 ──

  /** GET /api/chat/archives — 获取归档列表。 */
  app.get(
    '/api/chat/archives',
    async (
      req: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>,
      reply: FastifyReply,
    ) => {
      const { ArchiveService } = await import('@/core/chat/archive.js')
      const registry = getServiceRegistry(app)

      const svc = registry.getTyped(ArchiveService, 'archive_service')

      const page = req.query.page ? parseInt(req.query.page, 10) : 1
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20

      const result = await svc.getArchiveLogs(page, pageSize)
      await reply.send(ok(result))
    },
  )

  /** POST /api/chat/archives/trigger — 手动触发归档任务（发送 BullMQ job）。 */
  app.post(
    '/api/chat/archives/trigger',
    async (req: FastifyRequest<{ Body?: { partitionName?: string } }>, reply: FastifyReply) => {
      const state = getAppState(app)
      const queues = state.queues as
        | Record<string, { add(name: string, data: unknown): Promise<{ id?: string }> }>
        | undefined

      const archiveQueue = queues?.['chat-archive']
      if (archiveQueue === undefined) {
        await reply.status(503).send(fail('归档队列未就绪'))
        return
      }

      const partitionName = req.body?.partitionName
      try {
        const job = await archiveQueue.add('archive_chat_history', { partitionName })
        await reply.send(ok({ task_id: job.id ?? 'unknown' }, 'Archive task queued'))
      } catch (err) {
        log.error({ err }, '归档任务入队失败')
        await reply.status(500).send(fail(`归档任务入队失败: ${String(err)}`))
      }
    },
  )

  /** GET /api/chat/archives/query — 查询已完成的归档记录（按起始时间过滤）。 */
  app.get(
    '/api/chat/archives/query',
    async (
      req: FastifyRequest<{
        Querystring: { periodStart: string; groupId?: string; limit?: string }
      }>,
      reply: FastifyReply,
    ) => {
      const periodStart = new Date(req.query.periodStart)
      if (isNaN(periodStart.getTime())) {
        await reply.status(400).send(fail('periodStart 格式无效，请使用 ISO 8601 格式'))
        return
      }
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50

      const { ArchiveService } = await import('@/core/chat/archive.js')
      const registry = getServiceRegistry(app)
      const svc = registry.getTyped(ArchiveService, 'archive_service')

      const result = await svc.listArchives({ periodStart, limit })
      await reply.send(ok(result))
    },
  )
}

export default chatRoutes
export { chatRoutes }
