// tests/unit/core/tasks/executor.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BotAPI } from '@/core/protocol/api.js'
import type { RedisStore } from '@/core/redis/store.js'
import type { RenderSendJobResult } from '@/core/tasks/models.js'
import type { ConnectionManager } from '@/core/ws/connection.js'

// ── BullMQ mock 工厂（每个 test 独立实例化，避免 .mock.results 下标竞争）──

type EventListener = (data: unknown) => void

interface MockQueueEvents {
  on: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  emit: (event: string, data: unknown) => void
}

function createMockQueueEvents(): MockQueueEvents {
  const listeners: Record<string, EventListener[]> = {}
  return {
    on: vi.fn((event: string, cb: EventListener) => {
      listeners[event] ??= []
      listeners[event].push(cb)
    }),
    close: vi.fn().mockResolvedValue(undefined),
    emit: (event: string, data: unknown) => {
      listeners[event]?.forEach((cb) => {
        cb(data)
      })
    },
  }
}

vi.mock('bullmq', () => ({
  QueueEvents: vi.fn(),
  Queue: vi.fn().mockImplementation(function () {
    return {}
  }),
  Job: { fromId: vi.fn() },
}))

function createMockBotApi() {
  return {
    sendGroupSign: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
    sendLike: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
    sendGroupMsg: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
    sendPrivateMsg: vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: null, echo: '' }),
  } as unknown as BotAPI
}

function createMockConnMgr(connected = true) {
  return { isConnected: connected } as unknown as ConnectionManager
}

function createMockCache() {
  return {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisStore
}

describe('TaskExecutor', () => {
  let mockEvents: MockQueueEvents

  beforeEach(async () => {
    mockEvents = createMockQueueEvents()
    const captured = mockEvents
    const { QueueEvents } = await import('bullmq')
    ;(QueueEvents as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return captured
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('self-contained 结果不调用 BotAPI', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'test-job' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const botApi = createMockBotApi()
    const executor = new TaskExecutor(
      botApi,
      createMockConnMgr(),
      createMockCache(),
      {},
      'aemeath-tasks',
    )
    executor.start()

    mockEvents.emit('completed', {
      jobId: '1',
      returnvalue: JSON.stringify({ type: 'self-contained', summary: { rows: 0 } }),
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(botApi.sendGroupSign).not.toHaveBeenCalled()
  })

  it('WS 未连接时跳过 BotAPI 调用', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'checkin' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const botApi = createMockBotApi()
    const executor = new TaskExecutor(
      botApi,
      createMockConnMgr(false),
      createMockCache(),
      {},
      'aemeath-tasks',
    )
    executor.start()

    mockEvents.emit('completed', {
      jobId: '2',
      returnvalue: JSON.stringify({
        type: 'bot-action',
        calls: [{ method: 'sendGroupSign', args: [100] }],
      }),
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(botApi.sendGroupSign).not.toHaveBeenCalled()
  })

  it('白名单内方法正常调用', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'like' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const botApi = createMockBotApi()
    const executor = new TaskExecutor(
      botApi,
      createMockConnMgr(),
      createMockCache(),
      {},
      'aemeath-tasks',
    )
    executor.start()

    mockEvents.emit('completed', {
      jobId: '3',
      returnvalue: JSON.stringify({
        type: 'bot-action',
        calls: [{ method: 'sendLike', args: [111, 10] }],
      }),
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(botApi.sendLike).toHaveBeenCalledWith(111, 10)
  })

  it('白名单外方法被拒绝', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'evil' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const botApi = createMockBotApi()
    const executor = new TaskExecutor(
      botApi,
      createMockConnMgr(),
      createMockCache(),
      {},
      'aemeath-tasks',
    )
    executor.start()

    mockEvents.emit('completed', {
      jobId: '4',
      returnvalue: JSON.stringify({
        type: 'bot-action',
        calls: [{ method: 'deleteMsg', args: [999] }],
      }),
    })

    await new Promise((r) => setTimeout(r, 10))
    expect((botApi as unknown as Record<string, unknown>).deleteMsg).toBeUndefined()
    expect(botApi.sendGroupSign).not.toHaveBeenCalled()
  })

  it('sendGroupSign 成功后通过 postCacheOps 写入打卡去重键', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'checkin' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const botApi = createMockBotApi()
    const cache = createMockCache()
    const executor = new TaskExecutor(botApi, createMockConnMgr(), cache, {}, 'aemeath-tasks')
    executor.start()

    mockEvents.emit('completed', {
      jobId: '5',
      returnvalue: JSON.stringify({
        type: 'bot-action',
        calls: [{ method: 'sendGroupSign', args: [300] }],
        postCacheOps: [
          { action: 'set', key: 'aemeath:checkin:300:2024-01-01', value: '1', ttl: 90_000 },
        ],
      }),
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(botApi.sendGroupSign).toHaveBeenCalledWith(300)
    expect(cache.set).toHaveBeenCalledOnce()
    // 验证 cache.set 的第三个参数是 TTL（90000）
    expect((cache.set as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe(90_000)
  })
})

describe('render-send result', () => {
  let mockEvents: MockQueueEvents

  beforeEach(async () => {
    mockEvents = createMockQueueEvents()
    const captured = mockEvents
    const { QueueEvents } = await import('bullmq')
    ;(QueueEvents as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return captured
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('从 temp key 取图并调用 sendGroupMsg', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'render' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const cache = createMockCache()
    ;(cache.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('base64pngdata')

    const botApi = createMockBotApi()
    const executor = new TaskExecutor(botApi, createMockConnMgr(), cache, {}, 'test-queue')
    executor.start()

    const result: RenderSendJobResult = {
      type: 'render-send',
      tempKey: 'aemeath:render:temp:job-1',
      sendTo: { groupId: 12345 },
    }
    mockEvents.emit('completed', { jobId: 'job-1', returnvalue: JSON.stringify(result) })
    await new Promise((r) => setTimeout(r, 30))

    expect(botApi.sendGroupMsg).toHaveBeenCalledWith(
      12345,
      '[CQ:image,file=base64://base64pngdata]',
    )
    expect(cache.del).toHaveBeenCalledWith('aemeath:render:temp:job-1')
  })

  it('temp key 过期时打 warn 并跳过发送', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'render' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const cache = createMockCache()
    // 默认 get 返回 null（已在 createMockCache 中设置）

    const botApi = createMockBotApi()
    const executor = new TaskExecutor(botApi, createMockConnMgr(), cache, {}, 'test-queue')
    executor.start()

    const result: RenderSendJobResult = {
      type: 'render-send',
      tempKey: 'aemeath:render:temp:job-expired',
      sendTo: { groupId: 12345 },
    }
    mockEvents.emit('completed', { jobId: 'job-2', returnvalue: JSON.stringify(result) })
    await new Promise((r) => setTimeout(r, 30))

    expect(botApi.sendGroupMsg).not.toHaveBeenCalled()
  })

  it('sendTo userId 时调用 sendPrivateMsg', async () => {
    const { Job } = await import('bullmq')
    Job.fromId = vi.fn().mockResolvedValue({ name: 'render' })

    const { TaskExecutor } = await import('@/core/tasks/executor.js')
    const cache = createMockCache()
    ;(cache.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('imgdata')

    const botApi = createMockBotApi()
    const executor = new TaskExecutor(botApi, createMockConnMgr(), cache, {}, 'test-queue')
    executor.start()

    const result: RenderSendJobResult = {
      type: 'render-send',
      tempKey: 'aemeath:render:temp:job-pm',
      sendTo: { userId: 9999 },
    }
    mockEvents.emit('completed', { jobId: 'job-3', returnvalue: JSON.stringify(result) })
    await new Promise((r) => setTimeout(r, 30))

    expect(botApi.sendPrivateMsg).toHaveBeenCalledWith(9999, '[CQ:image,file=base64://imgdata]')
    expect(cache.del).toHaveBeenCalledWith('aemeath:render:temp:job-pm')
  })
})
