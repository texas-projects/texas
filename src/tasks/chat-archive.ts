/** 聊天记录归档 BullMQ 处理器骨架 —— 具体业务逻辑后续迭代。 */

import type { Job } from 'bullmq'

import type { ChatPrismaClient, MainPrismaClient } from '@/core/db.js'
import type { SelfContainedJobResult, TaskDefinition } from '@/core/tasks/index.js'

export const JOB_NAME = 'chat-archive' as const

export interface ArchiveWorkerDeps {
  db: MainPrismaClient
  chatDb: ChatPrismaClient
}

export async function chatArchiveProcessor(
  _job: Job,
  _deps: ArchiveWorkerDeps,
): Promise<SelfContainedJobResult> {
  return { type: 'self-contained', summary: { status: 'not-implemented' } }
}

export const taskDefinition: TaskDefinition = {
  jobName: 'chat_archive',
  requires: ['chat_db'],
  concurrency: 1,
  schedule: { cron: '0 3 1 * *', tz: 'Asia/Shanghai' },
  processor: async (job: Job, deps: Record<string, unknown>): Promise<SelfContainedJobResult> => {
    return chatArchiveProcessor(job, deps as unknown as ArchiveWorkerDeps)
  },
}
