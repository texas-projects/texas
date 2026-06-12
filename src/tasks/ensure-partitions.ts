/** 聊天库分区预创建 BullMQ 处理器骨架 —— 具体业务逻辑后续迭代。 */

import type { Job } from 'bullmq'

import type { ChatPrismaClient } from '@/core/db.js'
import type { SelfContainedJobResult } from '@/core/tasks/models.js'
import type { TaskDefinition } from '@/core/tasks/types.js'

export const JOB_NAME = 'ensure-chat-partitions' as const

export interface PartitionsWorkerDeps {
  chatDb: ChatPrismaClient
}

export async function ensurePartitionsProcessor(
  _job: Job,
  _deps: PartitionsWorkerDeps,
): Promise<SelfContainedJobResult> {
  return { type: 'self-contained', summary: { status: 'not-implemented' } }
}

export const taskDefinition: TaskDefinition = {
  jobName: 'ensure_partitions',
  requires: ['chat_db'],
  concurrency: 1,
  schedule: { cron: '0 1 25 * *', tz: 'Asia/Shanghai' },
  processor: async (job: Job, deps: Record<string, unknown>): Promise<SelfContainedJobResult> => {
    return ensurePartitionsProcessor(job, deps as unknown as PartitionsWorkerDeps)
  },
}
