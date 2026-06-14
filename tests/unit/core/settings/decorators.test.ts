import { beforeEach, describe, expect, it } from 'vitest'

import { Permission } from '@/core/dispatch/constants.js'
import { SettingNode, settingNodeRegistry } from '@/core/settings/decorators.js'

beforeEach(() => {
  settingNodeRegistry.clear()
})

class TestHandler {
  handle(): void {}
}

describe('SettingNode 装饰器', () => {
  it('注册 boolean 类型配置项', () => {
    SettingNode('feature.enabled', { type: 'boolean', default: true, description: '开关' })(
      TestHandler,
    )

    const nodes = settingNodeRegistry.get(TestHandler)
    expect(nodes).toHaveLength(1)
    expect(nodes![0]).toMatchObject({
      key: 'feature.enabled',
      type: 'boolean',
      default: true,
      description: '开关',
      scope: 'all',
    })
  })

  it('注册 enum 类型配置项（含 enumOptions）', () => {
    SettingNode('feature.permission', {
      type: 'enum',
      default: 'ANYONE',
      enumOptions: Permission,
      description: '权限等级',
    })(TestHandler)

    const nodes = settingNodeRegistry.get(TestHandler)
    expect(nodes![0]!.enumOptions).toEqual(Permission)
    expect(nodes![0]!.default).toBe('ANYONE')
  })

  it('同一类可叠加多个 SettingNode', () => {
    SettingNode('feature.enabled', { type: 'boolean', default: true })(TestHandler)
    SettingNode('feature.permission', { type: 'enum', default: 'ANYONE', enumOptions: Permission })(
      TestHandler,
    )

    expect(settingNodeRegistry.get(TestHandler)).toHaveLength(2)
  })

  it('scope 默认值为 all', () => {
    SettingNode('feature.enabled', { type: 'boolean', default: false })(TestHandler)
    expect(settingNodeRegistry.get(TestHandler)![0]!.scope).toBe('all')
  })

  it('scope 可指定为 group', () => {
    SettingNode('bot.enabled', { type: 'boolean', default: true, scope: 'group' })(TestHandler)
    expect(settingNodeRegistry.get(TestHandler)![0]!.scope).toBe('group')
  })
})
