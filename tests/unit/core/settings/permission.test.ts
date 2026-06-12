import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Context } from '@/core/dispatch/context.js'
import { Permission } from '@/core/dispatch/decorators.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'
import type { PersonnelService } from '@/core/personnel/index.js'
import { SettingNode, settingNodeRegistry } from '@/core/settings/decorators.js'
import { SettingsPermissionChecker } from '@/core/settings/permission.js'
import { buildSchemaMap } from '@/core/settings/schema.js'
import type { SettingsService } from '@/core/settings/service.js'

// ── Mock 工厂 ──

function createMockSettings(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn((_key: string) => Promise.resolve(overrides[_key] ?? true)),
    resolveEnum: vi.fn(
      (_key: string, label: string) => Permission[label as keyof typeof Permission] ?? 0,
    ),
  } as unknown as SettingsService
}

function createMockPersonnel(adminQqs: bigint[] = []) {
  return {
    getAdminQqSet: vi.fn().mockResolvedValue(new Set(adminQqs)),
  } as unknown as PersonnelService
}

function createGroupContext(
  opts: {
    userId?: number
    groupId?: number
    componentName?: string
    permission?: number
    senderRole?: string
  } = {},
): Partial<Context> {
  return {
    userId: opts.userId ?? 100,
    groupId: opts.groupId ?? 12345,
    event: {
      sender: { role: opts.senderRole ?? 'member' },
    } as unknown as Context['event'],
    getAttribute: vi.fn().mockReturnValue({
      componentName: opts.componentName ?? 'test_feature',
      methodName: 'handle',
      permission: opts.permission ?? Permission.ANYONE,
    }),
    setAttribute: vi.fn(),
  }
}

function createPrivateContext(
  opts: { userId?: number; componentName?: string } = {},
): Partial<Context> {
  return {
    userId: opts.userId ?? 200,
    groupId: undefined,
    event: {} as unknown as Context['event'],
    getAttribute: vi.fn().mockReturnValue({
      componentName: opts.componentName ?? 'test_feature',
      methodName: 'handle',
      permission: Permission.ANYONE,
    }),
    setAttribute: vi.fn(),
  }
}

// ── 测试 ──

class TestHandler {
  handle(): void {}
}

beforeEach(() => {
  settingNodeRegistry.clear()
  handlerRegistry.clear()
})

function buildChecker(settingsValues: Record<string, unknown> = {}, adminQqs: bigint[] = []) {
  SettingNode('test_feature.enabled', { type: 'boolean', default: true })(TestHandler)
  SettingNode('test_feature.permission', {
    type: 'enum',
    default: 'ANYONE',
    enumOptions: Permission,
  })(TestHandler)

  const schemaMap = buildSchemaMap()
  const settings = createMockSettings(settingsValues)
  const personnel = createMockPersonnel(adminQqs)
  return {
    checker: new SettingsPermissionChecker(settings, personnel, schemaMap),
    settings,
    personnel,
  }
}

describe('system 功能直通', () => {
  it('system 组件跳过所有检查', async () => {
    settingNodeRegistry.clear()
    handlerRegistry.clear()
    handlerRegistry.register('sys_feature', {
      meta: {
        name: 'sys_feature',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: true,
        target: TestHandler,
      },
      methods: [],
    })

    const schemaMap = buildSchemaMap()
    const settings = createMockSettings()
    const personnel = createMockPersonnel()
    const checker = new SettingsPermissionChecker(settings, personnel, schemaMap)

    const ctx = createGroupContext({ componentName: 'sys_feature' })
    expect(await checker.check(ctx as Context)).toBe(true)
    expect(personnel.getAdminQqSet).not.toHaveBeenCalled()
  })
})

describe('超级管理员绕过', () => {
  it('超级管理员无视所有功能开关', async () => {
    const { checker } = buildChecker({ 'bot.enabled': false }, [100n])
    const ctx = createGroupContext({ userId: 100 })
    expect(await checker.check(ctx as Context)).toBe(true)
  })
})

describe('ADMIN 权限', () => {
  it('非超管访问 ADMIN 功能被拒绝', async () => {
    const { checker } = buildChecker()
    const ctx = createGroupContext({ permission: Permission.ADMIN })
    expect(await checker.check(ctx as Context)).toBe(false)
  })
})

describe('群聊检查链路', () => {
  it('bot.enabled=false 时拒绝所有请求', async () => {
    const { checker } = buildChecker({ 'bot.enabled': false, 'test_feature.enabled': true })
    const ctx = createGroupContext()
    expect(await checker.check(ctx as Context)).toBe(false)
  })

  it('功能 enabled=false 时被拒绝', async () => {
    const { checker } = buildChecker({ 'bot.enabled': true, 'test_feature.enabled': false })
    const ctx = createGroupContext()
    expect(await checker.check(ctx as Context)).toBe(false)
  })

  it('权限配置为 ANYONE 时 member 角色通过', async () => {
    const { checker, settings } = buildChecker({
      'bot.enabled': true,
      'test_feature.enabled': true,
      'test_feature.permission': 'ANYONE',
    })
    vi.mocked(settings.resolveEnum).mockReturnValue(Permission.ANYONE)

    const ctx = createGroupContext({ senderRole: 'member' })
    expect(await checker.check(ctx as Context)).toBe(true)
  })

  it('权限配置为 GROUP_OWNER 时 member 角色被拒绝', async () => {
    const { checker, settings } = buildChecker({
      'bot.enabled': true,
      'test_feature.enabled': true,
      'test_feature.permission': 'GROUP_OWNER',
    })
    vi.mocked(settings.resolveEnum).mockReturnValue(Permission.GROUP_OWNER)

    const ctx = createGroupContext({ senderRole: 'member' })
    expect(await checker.check(ctx as Context)).toBe(false)
  })

  it('权限配置为 GROUP_ADMIN 时 admin 角色通过', async () => {
    const { checker, settings } = buildChecker({
      'bot.enabled': true,
      'test_feature.enabled': true,
      'test_feature.permission': 'GROUP_ADMIN',
    })
    vi.mocked(settings.resolveEnum).mockReturnValue(Permission.GROUP_ADMIN)

    const ctx = createGroupContext({ senderRole: 'admin' })
    expect(await checker.check(ctx as Context)).toBe(true)
  })
})

describe('私聊检查链路', () => {
  it('功能 enabled=true 时通过', async () => {
    const { checker } = buildChecker({ 'test_feature.enabled': true })
    const ctx = createPrivateContext()
    expect(await checker.check(ctx as Context)).toBe(true)
  })

  it('功能 enabled=false 时被拒绝', async () => {
    const { checker } = buildChecker({ 'test_feature.enabled': false })
    const ctx = createPrivateContext()
    expect(await checker.check(ctx as Context)).toBe(false)
  })
})

describe('handlerMethod 缺失', () => {
  it('无 handlerMethod 属性时直通', async () => {
    const { checker } = buildChecker()
    const ctx: Partial<Context> = {
      userId: 100,
      groupId: 12345,
      event: {} as Context['event'],
      getAttribute: vi.fn().mockReturnValue(undefined),
      setAttribute: vi.fn(),
    }
    expect(await checker.check(ctx as Context)).toBe(true)
  })
})
