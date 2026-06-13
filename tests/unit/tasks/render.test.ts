import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 仅测试 processor 逻辑，mock RenderService 和 OSS
vi.mock('@/renderer/index.js', () => ({
  RenderService: vi.fn().mockImplementation(function () {
    return {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue(Buffer.from('fakepng')),
    }
  }),
  loadTemplates: vi.fn(),
  loadFonts: vi.fn().mockResolvedValue([]),
  TemplateNotFoundError: class TemplateNotFoundError extends Error {
    constructor(name: string) {
      super(`Template not found: ${name}`)
    }
  },
}))

vi.mock('@/core/oss/utils.js', () => ({
  uploadBuffer: vi.fn().mockResolvedValue(undefined),
  downloadBuffer: vi.fn().mockResolvedValue(Buffer.from('fakepng')),
}))

vi.mock('@/core/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    RENDER_CACHE_TTL: 3600,
    RENDER_CACHE_MAX_BYTES: 1_048_576,
  }),
}))

describe('render processor', () => {
  const createMockCache = () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  })

  const createMockOss = () => ({
    client: {},
    buckets: { render: 'render-bucket', archive: 'archive-bucket', media: 'media-bucket' },
  })

  const createJob = (data: Record<string, unknown>): Job =>
    ({ id: 'test-job-1', name: 'render', data }) as unknown as Job

  beforeEach(() => {
    vi.resetModules()
  })

  it('缓存未命中时渲染并写缓存和 temp key', async () => {
    const { taskDefinition } = await import('@/tasks/render.js')
    const cache = createMockCache()
    const oss = createMockOss()
    const job = createJob({
      template: 'help',
      data: { title: 'test' },
      sendTo: { groupId: 100 },
      width: 800,
      height: 1200,
    })

    const result = await taskDefinition.processor(job, { cache, oss })

    expect(result).toMatchObject({ type: 'render-send', sendTo: { groupId: 100 } })
    expect(cache.set).toHaveBeenCalledTimes(2) // result cache + temp key
  })

  it('skipCache=true 时跳过缓存读写，仍写 temp key', async () => {
    const { taskDefinition } = await import('@/tasks/render.js')
    const cache = createMockCache()
    const oss = createMockOss()
    const job = createJob({
      template: 'help',
      data: {},
      sendTo: { groupId: 100 },
      skipCache: true,
    })

    const result = await taskDefinition.processor(job, { cache, oss })

    expect(result).toMatchObject({ type: 'render-send' })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).toHaveBeenCalledTimes(1) // 只写 temp key
  })
})
