// tests/unit/core/settings/query.test.ts
import { describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import { getSettingValue } from '@/core/settings/query.js'
import type { SettingsQueryContext } from '@/core/settings/query.js'

function createMockDb(rows: { key: string; value: string; value_type: string }[] = []) {
  return {
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(rows)),
  } as unknown as MainPrismaClient
}

describe('getSettingValue', () => {
  const schemaMap = new Map([
    ['bot.enabled', { key: 'bot.enabled', type: 'boolean' as const, default: true }],
    [
      'daily_checkin.enabled',
      { key: 'daily_checkin.enabled', type: 'boolean' as const, default: false },
    ],
  ])

  it('DB 有覆盖行时返回 DB 值', async () => {
    const db = createMockDb([{ key: 'bot.enabled', value: 'false', value_type: 'boolean' }])
    const ctx: SettingsQueryContext = { db, schemaMap, group: 123n }
    const result = await getSettingValue<boolean>('bot.enabled', ctx)
    expect(result).toBe(false)
  })

  it('DB 无覆盖行时回退 schema default', async () => {
    const db = createMockDb([])
    const ctx: SettingsQueryContext = { db, schemaMap, group: 456n }
    const result = await getSettingValue<boolean>('daily_checkin.enabled', ctx)
    expect(result).toBe(false)
  })

  it('schema 无此 key 时返回 undefined', async () => {
    const db = createMockDb([])
    const ctx: SettingsQueryContext = { db, schemaMap }
    const result = await getSettingValue('nonexistent.key', ctx)
    expect(result).toBeUndefined()
  })

  it('group 为 number 时正常工作', async () => {
    const db = createMockDb([{ key: 'bot.enabled', value: 'true', value_type: 'boolean' }])
    const ctx: SettingsQueryContext = { db, schemaMap, group: 789 }
    const result = await getSettingValue<boolean>('bot.enabled', ctx)
    expect(result).toBe(true)
  })
})
