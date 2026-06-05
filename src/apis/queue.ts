/**
 * 任务队列 API 端点 —— 查询定时任务与消息队列状态，SSE 实时推送。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

import { getLogger } from '../core/logging/setup.js'
import { ok, fail } from '../core/utils/response.js'

const log = getLogger('queue')

const TASK_DISPLAY_NAMES: Record<string, string> = {
  archive_chat_history: '聊天记录归档',
  ensure_chat_partitions: '分区预创建',
  trigger_daily_checkin: '每日打卡',
  trigger_daily_like: '每日点赞',
  _send_chat_archive: '聊天记录归档',
  _send_ensure_partitions: '分区预创建',
  _send_daily_checkin: '每日打卡',
  _send_daily_like: '每日点赞',
}

function displayTaskName(name: string): string {
  const short = name.includes('.') ? (name.split('.').at(-1) ?? name) : name
  return TASK_DISPLAY_NAMES[short] ?? TASK_DISPLAY_NAMES[name] ?? name
}

function getState(app: FastifyInstance): Record<string, unknown> {
  return (app as unknown as { state: Record<string, unknown> }).state
}

// ── BullMQ 队列操作接口（内联类型，避免引入 bullmq 运行时） ──

interface BullJob {
  id: string | undefined
  name: string
  data: unknown
  processedOn?: number
}

interface BullWorker {
  id: string
  addr?: string
  name?: string
}

interface BullQueue {
  getActive(): Promise<BullJob[]>
  getWaiting(): Promise<BullJob[]>
  getWorkers(): Promise<BullWorker[]>
}

// ── 调度器接口 ──

interface SchedulerApi {
  getSchedules(): Promise<Record<string, unknown>[]>
}

// ── 聚合所有队列状态的辅助函数 ──

interface QueueStateResult {
  scheduledTasks: unknown[]
  activeTasks: unknown[]
  pendingTasks: unknown[]
  workers: unknown[]
  totalLength: number
}

async function collectQueueState(app: FastifyInstance): Promise<QueueStateResult> {
  const state = getState(app)

  // 定时任务（从 scheduler 服务获取）
  const scheduledTasks: unknown[] = []
  const scheduler = state.scheduler as SchedulerApi | undefined
  if (scheduler !== undefined) {
    try {
      const schedules = await scheduler.getSchedules()
      for (const s of schedules) {
        const funcName = (s.task_id as string | undefined) ?? (s.id as string | undefined) ?? ''
        scheduledTasks.push({
          name: displayTaskName(funcName),
          task: funcName,
          schedule: s.trigger ?? '',
          scheduleRaw: null,
          args: null,
          kwargs: null,
          options: { expires: null, queue: 'texas_queue' },
          enabled: true,
        })
      }
    } catch (err) {
      log.warn({ err }, '获取定时任务失败')
    }
  }

  // BullMQ 队列数据
  const queues = state.queues as Record<string, BullQueue> | undefined
  const activeTasks: unknown[] = []
  const pendingTasks: unknown[] = []
  const seenWorkers = new Set<string>()
  const workers: unknown[] = []
  let totalLength = 0

  if (queues !== undefined) {
    await Promise.all(
      Object.entries(queues).map(async ([queueName, queue]) => {
        try {
          const [active, waiting, queueWorkers] = await Promise.all([
            queue.getActive(),
            queue.getWaiting(),
            queue.getWorkers(),
          ])

          for (const job of active) {
            activeTasks.push({
              worker: queueName,
              id: job.id ?? '',
              name: displayTaskName(job.name),
              args: JSON.stringify(job.data),
              kwargs: '{}',
              started: job.processedOn != null ? Math.floor(job.processedOn / 1000) : null,
              acknowledged: true,
            })
          }

          for (const job of waiting) {
            pendingTasks.push({
              id: job.id ?? '',
              name: displayTaskName(job.name),
              args: JSON.stringify(job.data),
              kwargs: null,
            })
          }

          for (const w of queueWorkers) {
            const key = w.addr ?? w.id
            if (seenWorkers.has(key)) continue
            seenWorkers.add(key)
            // BullMQ addr 格式：hostname:port:pid:workerName
            const parts = (w.addr ?? '').split(':')
            const pid = parts[2] ? parseInt(parts[2], 10) : null
            workers.push({
              name: w.name ?? w.addr ?? w.id,
              concurrency: null,
              broker: queueName,
              prefetch_count: null,
              pid: pid !== null && Number.isFinite(pid) ? pid : null,
              uptime: null,
            })
          }

          totalLength += active.length + waiting.length
        } catch (err) {
          log.warn({ queueName, err }, '队列数据收集失败')
        }
      }),
    )
  }

  return { scheduledTasks, activeTasks, pendingTasks, workers, totalLength }
}

/**
 * 任务队列路由插件。
 */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/queue/scheduled-tasks — 获取已注册的定时任务列表。 */
  app.get('/api/queue/scheduled-tasks', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const scheduler = state.scheduler as SchedulerApi | undefined

    const tasks: Record<string, unknown>[] = []
    if (scheduler !== undefined) {
      try {
        const schedules = await scheduler.getSchedules()
        for (const s of schedules) {
          const funcName = (s.task_id as string | undefined) ?? (s.id as string | undefined) ?? ''
          tasks.push({
            name: displayTaskName(funcName),
            task: funcName,
            schedule: s.trigger ?? '',
            scheduleRaw: null,
            args: null,
            kwargs: null,
            options: { expires: null, queue: 'texas_queue' },
            enabled: true,
          })
        }
      } catch (err) {
        log.warn({ err }, '获取定时任务失败')
      }
    }

    await reply.send(ok(tasks))
  })

  /** GET /api/queue/active-tasks — 获取当前正在执行的任务。 */
  app.get('/api/queue/active-tasks', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const queues = state.queues as Record<string, BullQueue> | undefined
    if (queues === undefined) {
      await reply.send(ok([]))
      return
    }

    const results: unknown[] = []
    await Promise.all(
      Object.entries(queues).map(async ([queueName, queue]) => {
        try {
          const jobs = await queue.getActive()
          for (const job of jobs) {
            results.push({
              worker: queueName,
              id: job.id ?? '',
              name: displayTaskName(job.name),
              args: JSON.stringify(job.data),
              kwargs: '{}',
              started: job.processedOn != null ? Math.floor(job.processedOn / 1000) : null,
              acknowledged: true,
            })
          }
        } catch (err) {
          log.warn({ queueName, err }, '获取队列活跃任务失败')
        }
      }),
    )
    await reply.send(ok(results))
  })

  /** GET /api/queue/reserved-tasks — 获取已预取但未执行的任务。 */
  app.get('/api/queue/reserved-tasks', async (_req: FastifyRequest, reply: FastifyReply) => {
    await reply.send(ok([]))
  })

  /** GET /api/queue/workers — 获取在线 Worker 节点信息。 */
  app.get('/api/queue/workers', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const queues = state.queues as Record<string, BullQueue> | undefined
    if (queues === undefined) {
      await reply.send(ok([]))
      return
    }

    const seen = new Set<string>()
    const results: unknown[] = []
    await Promise.all(
      Object.entries(queues).map(async ([queueName, queue]) => {
        try {
          const queueWorkers = await queue.getWorkers()
          for (const w of queueWorkers) {
            const key = w.addr ?? w.id
            if (seen.has(key)) continue
            seen.add(key)
            const parts = (w.addr ?? '').split(':')
            const pid = parts[2] ? parseInt(parts[2], 10) : null
            results.push({
              name: w.name ?? w.addr ?? w.id,
              concurrency: null,
              broker: queueName,
              prefetch_count: null,
              pid: pid !== null && Number.isFinite(pid) ? pid : null,
              uptime: null,
            })
          }
        } catch (err) {
          log.warn({ queueName, err }, '获取队列 Worker 信息失败')
        }
      }),
    )
    await reply.send(ok(results))
  })

  /** GET /api/queue/queue-length — 获取队列中的消息数量。 */
  app.get('/api/queue/queue-length', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = getState(app)
      const queues = state.queues as Record<string, BullQueue> | undefined
      if (queues === undefined) {
        await reply.send(fail('队列未就绪', { queue: 'bullmq', length: null }))
        return
      }
      let total = 0
      await Promise.all(
        Object.values(queues).map(async (queue) => {
          try {
            const [active, waiting] = await Promise.all([queue.getActive(), queue.getWaiting()])
            total += active.length + waiting.length
          } catch {
            // 单个队列失败不影响整体
          }
        }),
      )
      await reply.send(ok({ queue: 'bullmq', length: total }))
    } catch (err) {
      log.warn({ err }, '获取队列长度失败')
      await reply.send(fail('无法获取队列长度', { queue: 'bullmq', length: null }))
    }
  })

  /** GET /api/queue/pending-tasks — 获取队列中等待被消费的任务。 */
  app.get('/api/queue/pending-tasks', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const queues = state.queues as Record<string, BullQueue> | undefined
    if (queues === undefined) {
      await reply.send(ok([]))
      return
    }

    const results: unknown[] = []
    await Promise.all(
      Object.entries(queues).map(async ([_queueName, queue]) => {
        try {
          const jobs = await queue.getWaiting()
          for (const job of jobs) {
            results.push({
              id: job.id ?? '',
              name: displayTaskName(job.name),
              args: JSON.stringify(job.data),
              kwargs: null,
            })
          }
        } catch (err) {
          log.warn({ err }, '获取待处理任务失败')
        }
      }),
    )
    await reply.send(ok(results))
  })

  /**
   * GET /api/queue/stream — SSE 端点，实时推送队列状态数据。
   */
  app.get(
    '/api/queue/stream',
    async (req: FastifyRequest<{ Querystring: { interval?: string } }>, reply: FastifyReply) => {
      const intervalSecs = req.query.interval !== undefined ? parseFloat(req.query.interval) : 5.0

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.setHeader('Connection', 'keep-alive')

      let timer: NodeJS.Timeout | undefined

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
        if (!reply.raw.writableEnded) {
          reply.raw.end()
        }
      }

      timer = setInterval(() => {
        void (async () => {
          // 连接已关闭时跳过并清理
          if (reply.raw.writableEnded) {
            cleanup()
            return
          }
          try {
            const { scheduledTasks, activeTasks, pendingTasks, workers, totalLength } =
              await collectQueueState(app)

            const payload = JSON.stringify({
              scheduledTasks,
              activeTasks,
              reservedTasks: [],
              pendingTasks,
              workers,
              queueLength: { queue: 'bullmq', length: totalLength },
            })
            reply.raw.write(`data: ${payload}\n\n`)
          } catch (err) {
            log.warn({ err }, '队列流数据收集失败')
          }
        })()
      }, intervalSecs * 1000)

      req.raw.on('close', cleanup)

      await new Promise<void>((resolve) => {
        req.raw.on('close', resolve)
      })
    },
  )
}
