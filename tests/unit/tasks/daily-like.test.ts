// tests/unit/tasks/daily-like.test.ts
import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import { dailyLikeProcessor, JOB_NAME } from '@/tasks/daily-like.js'

function createMockDb(tasks: { qq: bigint }[] = []) {
  return {
    likeTask: {
      findMany: vi.fn().mockResolvedValue(tasks),
    },
  } as unknown as MainPrismaClient
}

describe('dailyLikeProcessor', () => {
  it('导出正确的 JOB_NAME', () => {
    expect(JOB_NAME).toBe('daily-like')
  })

  it('无任务时返回空 calls', async () => {
    const db = createMockDb([])
    const result = await dailyLikeProcessor({} as Job, { db })
    expect(result.type).toBe('bot-action')
    expect(result.calls).toHaveLength(0)
  })

  it('每个任务生成一个 sendLike call', async () => {
    const db = createMockDb([{ qq: 111n }, { qq: 222n }])
    const result = await dailyLikeProcessor({} as Job, { db })
    expect(result.calls).toHaveLength(2)
    expect(result.calls[0]).toMatchObject({ method: 'sendLike', args: [111, 10] })
    expect(result.calls[1]).toMatchObject({ method: 'sendLike', args: [222, 10] })
  })
})
