// tests/unit/tasks/daily-checkin.test.ts
import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import type { RedisStore } from '@/core/redis/store.js'
// 注册 checkin cache keys，否则 cacheKeyRegistry.buildKey 会抛错
import '@/services/checkin-cache-keys.js'
import { dailyCheckinProcessor, JOB_NAME } from '@/tasks/daily-checkin.js'

function createMockDb(groups: { groupId: bigint }[] = []) {
  return {
    group: {
      findMany: vi.fn().mockResolvedValue(groups),
    },
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve([])),
  } as unknown as MainPrismaClient
}

function createMockCache(existsValue = false) {
  return {
    exists: vi.fn().mockResolvedValue(existsValue),
  } as unknown as RedisStore
}

const workerSchemaMap = new Map([
  ['bot.enabled', { key: 'bot.enabled', type: 'boolean' as const, default: true }],
  [
    'daily_checkin.enabled',
    { key: 'daily_checkin.enabled', type: 'boolean' as const, default: false },
  ],
])

describe('dailyCheckinProcessor', () => {
  it('导出正确的 JOB_NAME', () => {
    expect(JOB_NAME).toBe('daily-checkin')
  })

  it('无活跃群时返回空 calls', async () => {
    const db = createMockDb([])
    const cache = createMockCache()
    const result = await dailyCheckinProcessor({} as Job, { db, cache, schemaMap: workerSchemaMap })
    expect(result.type).toBe('bot-action')
    expect(result.calls).toHaveLength(0)
  })

  it('Redis 已打卡的群被跳过', async () => {
    const db = createMockDb([{ groupId: 100n }])
    // bot.enabled=true，daily_checkin.enabled=true（需 DB 覆盖）
    db.$queryRaw = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve([{ key: 'bot.enabled', value: 'true', value_type: 'boolean' }]),
      )
      .mockImplementationOnce(() =>
        Promise.resolve([{ key: 'daily_checkin.enabled', value: 'true', value_type: 'boolean' }]),
      )
    const cache = createMockCache(true) // 已打卡
    const result = await dailyCheckinProcessor({} as Job, { db, cache, schemaMap: workerSchemaMap })
    expect(result.calls).toHaveLength(0)
  })

  it('功能未开启的群被跳过', async () => {
    const db = createMockDb([{ groupId: 200n }])
    // bot.enabled=true（schema default），daily_checkin.enabled=false（schema default）
    db.$queryRaw = vi.fn().mockImplementation(() => Promise.resolve([]))
    const cache = createMockCache(false)
    const result = await dailyCheckinProcessor({} as Job, { db, cache, schemaMap: workerSchemaMap })
    expect(result.calls).toHaveLength(0)
  })

  it('满足条件的群生成 sendGroupSign call', async () => {
    const db = createMockDb([{ groupId: 300n }])
    db.$queryRaw = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve([{ key: 'bot.enabled', value: 'true', value_type: 'boolean' }]),
      )
      .mockImplementationOnce(() =>
        Promise.resolve([{ key: 'daily_checkin.enabled', value: 'true', value_type: 'boolean' }]),
      )
    const cache = createMockCache(false)
    const result = await dailyCheckinProcessor({} as Job, { db, cache, schemaMap: workerSchemaMap })
    expect(result.type).toBe('bot-action')
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatchObject({ method: 'sendGroupSign', args: [300] })
  })
})
