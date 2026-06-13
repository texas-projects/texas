/**
 * 日志 SSE 端点 —— 实时推送应用日志到前端。
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import { logBroadcaster } from '@/core/logging/index.js'

/**
 * 日志 SSE 路由插件。
 */
const logsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/logs — SSE 端点，实时推送应用日志。
   *
   * 客户端通过 query 参数 level 过滤日志级别（info、debug、warn、error）。
   */
  app.get(
    '/api/logs',
    async (req: FastifyRequest<{ Querystring: { level?: string } }>, reply: FastifyReply) => {
      const levelFilter = req.query.level?.toLowerCase()

      // 设置 SSE 响应头
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.setHeader('Connection', 'keep-alive')

      // 发送初始连接事件
      reply.raw.write('event: connected\ndata: {}\n\n')

      // 监听日志广播器
      const onLog = (entry: Record<string, unknown>): void => {
        // 按级别过滤
        if (levelFilter !== undefined && levelFilter !== '') {
          const rawLevel = entry.level
          const entryLevel = (typeof rawLevel === 'string' ? rawLevel : '').toLowerCase()
          if (entryLevel !== levelFilter) return
        }

        try {
          const data = JSON.stringify(entry)
          reply.raw.write(`data: ${data}\n\n`)
        } catch {
          // 序列化失败时忽略
        }
      }

      logBroadcaster.on('log', onLog)

      // 客户端断开时清理监听器
      const cleanup = (): void => {
        logBroadcaster.off('log', onLog)
        reply.raw.end()
      }

      req.raw.on('close', cleanup)

      // 阻止 Fastify 自动关闭响应，等待连接断开
      await new Promise<void>((resolve) => {
        req.raw.on('close', resolve)
      })
    },
  )
}

export default logsRoutes
export { logsRoutes }
