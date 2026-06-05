/**
 * BullMQ 调度器 —— 注册所有定时任务到队列（替代 Python 侧的 APScheduler）。
 */

import type { Queue } from 'bullmq'

import { Startup, Shutdown } from '../core/lifecycle/registry.js'
import { getLogger } from '../core/logging/setup.js'
import { QUEUE_NAMES } from '../core/tasks/broker.js'

const log = getLogger('scheduler')

// ── 调度器 ID 常量 ──

const SCHEDULER_IDS = {
  DAILY_CHECKIN: 'schedule-daily-checkin',
  DAILY_LIKE: 'schedule-daily-like',
  CHAT_ARCHIVE: 'schedule-chat-archive',
  ENSURE_PARTITIONS: 'schedule-chat-partition-ensure',
} as const

/**
 * 向 BullMQ 队列注册所有定时重复任务。
 *
 * 使用 upsertJobScheduler() 幂等地注册 cron 调度，保证进程重启后不重复创建。
 *
 * @param queues - 按队列名称索引的 Queue 实例 map
 */
export async function registerScheduledJobs(queues: Record<string, Queue>): Promise<void> {
  const dailyCheckinQueue = queues[QUEUE_NAMES.DAILY_CHECKIN]
  const dailyLikeQueue = queues[QUEUE_NAMES.DAILY_LIKE]
  const chatArchiveQueue = queues[QUEUE_NAMES.CHAT_ARCHIVE]
  const ensurePartitionsQueue = queues[QUEUE_NAMES.ENSURE_PARTITIONS]

  const jobs: Promise<unknown>[] = []

  if (dailyCheckinQueue !== undefined) {
    jobs.push(
      dailyCheckinQueue.upsertJobScheduler(
        SCHEDULER_IDS.DAILY_CHECKIN,
        { pattern: '0 0 * * *', tz: 'Asia/Shanghai' },
        { name: 'daily-checkin' },
      ),
    )
  }

  if (dailyLikeQueue !== undefined) {
    jobs.push(
      dailyLikeQueue.upsertJobScheduler(
        SCHEDULER_IDS.DAILY_LIKE,
        { pattern: '0 0 * * *', tz: 'Asia/Shanghai' },
        { name: 'daily-like' },
      ),
    )
  }

  if (chatArchiveQueue !== undefined) {
    jobs.push(
      chatArchiveQueue.upsertJobScheduler(
        SCHEDULER_IDS.CHAT_ARCHIVE,
        { pattern: '0 3 1 * *', tz: 'Asia/Shanghai' },
        { name: 'chat-archive' },
      ),
    )
  }

  if (ensurePartitionsQueue !== undefined) {
    jobs.push(
      ensurePartitionsQueue.upsertJobScheduler(
        SCHEDULER_IDS.ENSURE_PARTITIONS,
        { pattern: '0 1 25 * *', tz: 'Asia/Shanghai' },
        { name: 'ensure-chat-partitions' },
      ),
    )
  }

  await Promise.all(jobs)

  log.info({ jobs: Object.values(SCHEDULER_IDS) }, '定时任务注册完成')
}

// ── 生命周期注册 ──

Startup({
  name: 'scheduler',
  provides: ['scheduler'],
  requires: ['queues'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const queues = deps.queues as Record<string, Queue>
  await registerScheduledJobs(queues)
  return { scheduler: { queues } }
})

Shutdown({ name: 'scheduler' })(async (_services: Record<string, unknown>): Promise<void> => {
  // BullMQ Queue 实例由 broker 模块管理，此处无需额外清理
})
