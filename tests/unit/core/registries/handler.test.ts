// tests/unit/core/registries/handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

import { HandlerRegistry } from '@/core/dispatch/registry.js'
import type { HandlerRegistryEntry } from '@/core/dispatch/registry.js'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class Placeholder {}

describe('HandlerRegistry', () => {
  let registry: HandlerRegistry

  beforeEach(() => {
    registry = new HandlerRegistry()
  })

  it('注册 handler 元数据', () => {
    registry.register('echo', {
      meta: {
        name: 'echo',
        displayName: '回声',
        description: '复读',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    expect(registry.get('echo')).toBeDefined()
    expect(registry.get('echo')!.meta.displayName).toBe('回声')
  })

  it('重复注册同名抛出', () => {
    const entry: HandlerRegistryEntry = {
      meta: {
        name: 'x',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    }
    registry.register('x', entry)
    expect(() => {
      registry.register('x', entry)
    }).toThrow()
  })

  it('values 返回所有条目', () => {
    registry.register('a', {
      meta: {
        name: 'a',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    registry.register('b', {
      meta: {
        name: 'b',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    expect([...registry.values()]).toHaveLength(2)
  })

  it('has 返回正确布尔值', () => {
    expect(registry.has('z')).toBe(false)
    registry.register('z', {
      meta: {
        name: 'z',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    expect(registry.has('z')).toBe(true)
  })

  it('get 不存在的 handler 返回 undefined', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('size 返回正确数量', () => {
    expect(registry.size).toBe(0)
    registry.register('a', {
      meta: {
        name: 'a',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    expect(registry.size).toBe(1)
  })

  it('clear 清空所有条目', () => {
    registry.register('a', {
      meta: {
        name: 'a',
        displayName: '',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    registry.clear()
    expect(registry.size).toBe(0)
  })

  it('entries 返回 name → entry 迭代器', () => {
    registry.register('foo', {
      meta: {
        name: 'foo',
        displayName: 'Foo',
        description: '',
        tags: [],
        defaultPriority: 0,
        system: false,
        target: Placeholder,
      },
      methods: [],
    })
    const pairs = [...registry.entries()]
    expect(pairs).toHaveLength(1)
    expect(pairs[0]![0]).toBe('foo')
    expect(pairs[0]![1].meta.displayName).toBe('Foo')
  })
})
