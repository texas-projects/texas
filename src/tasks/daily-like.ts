/** 每日点赞 BullMQ 处理器 —— Worker 内查询 DB，返回 BotApiCall[]。 */

import type { Job } from 'bullmq'

import type { MainPrismaClient } from '@/core/db.js'
import type { BotActionJobResult } from '@/core/tasks/models.js'
import type { TaskDefinition } from '@/core/tasks/types.js'

export const JOB_NAME = 'daily-like' as const

const DEFAULT_LIKE_TIMES = 10

export interface LikeWorkerDeps {
  db: MainPrismaClient
}

export async function dailyLikeProcessor(
  _job: Job,
  deps: LikeWorkerDeps,
): Promise<BotActionJobResult> {
  const tasks = await deps.db.likeTask.findMany({ select: { qq: true } })

  const calls = tasks.map((t) => ({
    method: 'sendLike',
    args: [Number(t.qq), DEFAULT_LIKE_TIMES],
  }))

  return { type: 'bot-action', calls }
}

export const taskDefinition: TaskDefinition = {
  jobName: 'daily_like',
  requires: ['db', 'cache'],
  concurrency: 1,
  schedule: { cron: '0 0 * * *', tz: 'Asia/Shanghai' },
  processor: async (job: Job, deps: Record<string, unknown>): Promise<BotActionJobResult> => {
    return dailyLikeProcessor(job, deps as unknown as LikeWorkerDeps)
  },
}
