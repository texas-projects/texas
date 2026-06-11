/** Settings Schema 树形工具函数单元测试：分组、过滤、displayName 映射、值合并。 */
import { describe, it, expect } from 'vitest'
import {
  groupSchemasByOwner,
  filterSchemasByCategory,
  buildOwnerDisplayNames,
  mergeSettingValues,
} from '@/utils/tree'
import type { SettingNodeSchema, SettingValue } from '@/apis/settings'

function makeSchema(
  key: string,
  owner: string,
  category: 'permission' | 'config',
  ownerDisplayName = owner,
): SettingNodeSchema {
  return {
    key,
    type: 'boolean',
    default: false,
    description: '',
    scope: 'all',
    owner,
    ownerDisplayName,
    category,
  }
}

describe('groupSchemasByOwner', () => {
  it('按 owner 分组', () => {
    const schemas = [makeSchema('a.enabled', 'mod-a', 'permission'), makeSchema('b.config', 'mod-b', 'config')]
    const result = groupSchemasByOwner(schemas)
    expect(result['mod-a']).toHaveLength(1)
    expect(result['mod-b']).toHaveLength(1)
  })

  it('同一 owner 的多项归入同一组', () => {
    const schemas = [
      makeSchema('a.enabled', 'mod-a', 'permission'),
      makeSchema('a.config', 'mod-a', 'config'),
    ]
    const result = groupSchemasByOwner(schemas)
    expect(result['mod-a']).toHaveLength(2)
  })

  it('空数组返回空对象', () => {
    expect(groupSchemasByOwner([])).toEqual({})
  })
})

describe('filterSchemasByCategory', () => {
  const schemas = [
    makeSchema('a.enabled', 'mod-a', 'permission'),
    makeSchema('b.config', 'mod-b', 'config'),
    makeSchema('c.permission', 'mod-c', 'permission'),
  ]

  it('过滤 permission 类', () => {
    const result = filterSchemasByCategory(schemas, 'permission')
    expect(result).toHaveLength(2)
    expect(result.every((s) => s.category === 'permission')).toBe(true)
  })

  it('过滤 config 类', () => {
    const result = filterSchemasByCategory(schemas, 'config')
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('b.config')
  })

  it('无匹配时返回空数组', () => {
    expect(filterSchemasByCategory([], 'config')).toEqual([])
  })
})

describe('buildOwnerDisplayNames', () => {
  it('提取 owner -> ownerDisplayName 映射', () => {
    const schemas = [
      makeSchema('a.enabled', 'mod-a', 'permission', '模块 A'),
      makeSchema('b.config', 'mod-b', 'config', '模块 B'),
    ]
    const result = buildOwnerDisplayNames(schemas)
    expect(result['mod-a']).toBe('模块 A')
    expect(result['mod-b']).toBe('模块 B')
  })

  it('同一 owner 多个 schema 时保留首次值', () => {
    const schemas = [
      makeSchema('a.enabled', 'mod-a', 'permission', '第一个'),
      makeSchema('a.config', 'mod-a', 'config', '第二个'),
    ]
    const result = buildOwnerDisplayNames(schemas)
    expect(result['mod-a']).toBe('第一个')
  })

  it('空数组返回空对象', () => {
    expect(buildOwnerDisplayNames([])).toEqual({})
  })
})

describe('mergeSettingValues', () => {
  it('无覆盖时所有项 overridden: false', () => {
    const defaults = { 'a.enabled': false, 'b.config': 10 }
    const result = mergeSettingValues(defaults, {})
    expect(result['a.enabled']).toEqual({ value: false, overridden: false })
    expect(result['b.config']).toEqual({ value: 10, overridden: false })
  })

  it('覆盖项标记 overridden: true 并使用覆盖值', () => {
    const defaults = { 'a.enabled': false }
    const overrides: Record<string, SettingValue> = { 'a.enabled': { value: true, overridden: true } }
    const result = mergeSettingValues(defaults, overrides)
    expect(result['a.enabled']).toEqual({ value: true, overridden: true })
  })

  it('覆盖中有 defaults 不存在的 key 时正常写入', () => {
    const overrides: Record<string, SettingValue> = { 'new.key': { value: 42, overridden: true } }
    const result = mergeSettingValues({}, overrides)
    expect(result['new.key']).toEqual({ value: 42, overridden: true })
  })

  it('defaults 和 overrides 均为空时返回空对象', () => {
    expect(mergeSettingValues({}, {})).toEqual({})
  })
})
