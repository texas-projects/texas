/** 每日打卡 BullMQ 处理器 —— Worker 内完成预处理，返回 BotApiCall[]。 */

import type { Job } from 'bullmq'

import type { MainPrismaClient } from '@/core/db.js'
import type { RedisStore } from '@/core/redis/store.js'
import { cacheKeyRegistry } from '@/core/registries.js'
import type { MinimalSettingSchema } from '@/core/settings/query.js'
import { getSettingValue } from '@/core/settings/query.js'
import type { BotActionJobResult, PostCacheOp } from '@/core/tasks/models.js'
import type { TaskDefinition } from '@/core/tasks/types.js'

export const JOB_NAME = 'daily-checkin' as const

/** 打卡成功后写入 Redis 去重键的 TTL（秒）：90000 秒 ≈ 25 小时。 */
const CHECKIN_TTL = 90_000

export interface CheckinWorkerDeps {
  db: MainPrismaClient
  cache: RedisStore
  schemaMap: ReadonlyMap<string, MinimalSettingSchema>
}

export async function dailyCheckinProcessor(
  _job: Job,
  deps: CheckinWorkerDeps,
): Promise<BotActionJobResult> {
  const { db, cache, schemaMap } = deps
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())

  const groups = await db.group.findMany({
    where: { isActive: true },
    select: { groupId: true },
  })

  const calls: { method: string; args: unknown[] }[] = []
  const postCacheOps: PostCacheOp[] = []

  for (const g of groups) {
    const botEnabled = await getSettingValue<boolean>('bot.enabled', {
      db,
      schemaMap,
      group: g.groupId,
    })
    if (!botEnabled) continue

    const featureEnabled = await getSettingValue<boolean>('daily_checkin.enabled', {
      db,
      schemaMap,
      group: g.groupId,
    })
    if (!featureEnabled) continue

    const dailyKey = cacheKeyRegistry.buildKey('checkin', 'daily', String(g.groupId), today)
    if (await cache.exists(dailyKey)) continue

    calls.push({ method: 'sendGroupSign', args: [Number(g.groupId)] })
    postCacheOps.push({ action: 'set', key: dailyKey, value: '1', ttl: CHECKIN_TTL })
  }

  return { type: 'bot-action', calls, postCacheOps }
}

export const taskDefinition: TaskDefinition = {
  jobName: 'daily_checkin',
  requires: ['db', 'cache'],
  concurrency: 1,
  schedule: { cron: '0 0 * * *', tz: 'Asia/Shanghai' },
  settings: {
    'bot.enabled': { key: 'bot.enabled', type: 'boolean', default: true },
    'daily_checkin.enabled': { key: 'daily_checkin.enabled', type: 'boolean', default: false },
  },
  processor: async (job: Job, deps: Record<string, unknown>): Promise<BotActionJobResult> => {
    return dailyCheckinProcessor(job, deps as unknown as CheckinWorkerDeps)
  },
}
