import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainPrismaClient } from '@/core/db.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'
import { SettingNode, settingNodeRegistry } from '@/core/settings/decorators.js'
import { buildSchemaMap, cleanOrphanKeys } from '@/core/settings/schema.js'

beforeEach(() => {
  settingNodeRegistry.clear()
  handlerRegistry.clear()
})

class TestHandler {
  handle(): void {}
}

describe('buildSchemaMap', () => {
  it('内置 bot.enabled 始终包含在 schemaMap 中', () => {
    const map = buildSchemaMap()
    expect(map.has('bot.enabled')).toBe(true)
    expect(map.get('bot.enabled')).toMatchObject({
      key: 'bot.enabled',
      type: 'boolean',
      default: true,
      owner: '__system__',
      ownerDisplayName: '系统',
      scope: 'group',
      category: 'permission',
    })
  })

  it('从 settingNodeRegistry 收集用户定义的配置项', () => {
    SettingNode('myfeature.enabled', { type: 'boolean', default: false })(TestHandler)

    // 注册到 handlerRegistry，让 buildSchemaMap 能找到 owner 和 displayName
    handlerRegistry.register('myfeature', {
      meta: {
        name: 'myfeature',
        displayName: 'My Feature',
        description: '',
        tags: [],
        defaultPriority: 10,
        system: false,
        target: TestHandler,
      },
      methods: [],
    })

    const map = buildSchemaMap()
    expect(map.has('myfeature.enabled')).toBe(true)
    expect(map.get('myfeature.enabled')!.owner).toBe('myfeature')
    expect(map.get('myfeature.enabled')!.ownerDisplayName).toBe('My Feature')
  })

  it('找不到 owner 时 owner 为 __unknown__，ownerDisplayName 回退为 __unknown__', () => {
    SettingNode('orphan.enabled', { type: 'boolean', default: true })(TestHandler)

    const map = buildSchemaMap()
    expect(map.get('orphan.enabled')!.owner).toBe('__unknown__')
    expect(map.get('orphan.enabled')!.ownerDisplayName).toBe('__unknown__')
  })
})

describe('cleanOrphanKeys', () => {
  function createMockDb(existingKeys: string[] = []) {
    return {
      $queryRaw: vi.fn().mockResolvedValue(existingKeys.map((key) => ({ key }))),
      $executeRaw: vi.fn().mockResolvedValue(1),
    } as unknown as MainPrismaClient
  }

  it('DB 中不存在废弃 key 时不执行 DELETE', async () => {
    const map = buildSchemaMap() // 仅含内置 bot.enabled
    const db = createMockDb(['bot.enabled']) // DB 与 schema 一致

    await cleanOrphanKeys(db, map)

    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('Schema 中不存在的 DB key 应被 DELETE', async () => {
    const map = buildSchemaMap() // 仅含内置 bot.enabled
    const db = createMockDb(['obsolete.key']) // DB 含废弃 key

    await cleanOrphanKeys(db, map)

    expect(db.$executeRaw).toHaveBeenCalled()
  })

  it('DB 为空时不执行 DELETE', async () => {
    const map = buildSchemaMap()
    const db = createMockDb([]) // DB 为空

    await cleanOrphanKeys(db, map)

    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('logger 回调被调用时不抛出异常', async () => {
    const map = buildSchemaMap()
    const db = createMockDb(['obsolete.key'])
    const logger = { info: vi.fn() }

    await expect(cleanOrphanKeys(db, map, logger)).resolves.toBeUndefined()
    expect(logger.info).toHaveBeenCalled()
  })
})
