import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

describe('enqueueRender', () => {
  it('向队列添加 render job 并返回 jobId', async () => {
    const queue = { add: vi.fn().mockResolvedValue({ id: 'job-123' }) } as unknown as Queue
    const { enqueueRender } = await import('@/core/utils/enqueue-render.js')

    const jobId = await enqueueRender(queue, {
      template: 'help',
      data: { title: 'test' },
      sendTo: { groupId: 100 },
    })

    expect(queue.add).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        template: 'help',
        sendTo: { groupId: 100 },
      }),
    )
    expect(jobId).toBe('job-123')
  })
})
