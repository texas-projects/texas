/* eslint-disable @typescript-eslint/no-extraneous-class */
import { describe, it, expect, afterEach } from 'vitest'

import type { SettingNodeEntry } from '@/core/dispatch/decorators/symbols.js'
import { Inject } from '@/core/lifecycle/decorators/inject.js'
import { Startup, Shutdown } from '@/core/lifecycle/decorators/lifecycle.js'
import { Provide } from '@/core/lifecycle/decorators/provide.js'
import { Service, serviceEntryRegistry } from '@/core/lifecycle/decorators/service.js'
import {
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_LIFECYCLE,
  SERVICE_SETTINGS,
} from '@/core/lifecycle/decorators/symbols.js'
import type { LifecycleEntry } from '@/core/lifecycle/decorators/symbols.js'

// TC39 Stage 3 字段装饰器测试：通过手动模拟 ClassFieldDecoratorContext 调用装饰器工厂，
// 验证元数据正确写入 Symbol.metadata，无需依赖转换器支持 @decorator 语法。

/** 模拟 ClassFieldDecoratorContext 调用字段装饰器并返回填充好的 metadata 对象。 */
function applyFieldDecorators(
  decoratorCalls: {
    decorator: (serviceKey: string) => (_value: undefined, ctx: ClassFieldDecoratorContext) => void
    serviceKey: string
    propertyName: string
  }[],
): Record<symbol, unknown> {
  const metadata: Record<symbol, unknown> = {}

  for (const { decorator, serviceKey, propertyName } of decoratorCalls) {
    const ctx = {
      kind: 'field' as const,
      name: propertyName,
      metadata,
      static: false,
      private: false,
      access: { has: () => false, get: () => undefined, set: () => {} },
      addInitializer: () => {},
    } as unknown as ClassFieldDecoratorContext
    decorator(serviceKey)(undefined, ctx)
  }

  return metadata
}

describe('@Inject', () => {
  it('应将注入元数据写入 metadata 对象', () => {
    const metadata = applyFieldDecorators([
      { decorator: Inject, serviceKey: 'db', propertyName: 'db' },
      { decorator: Inject, serviceKey: 'cache', propertyName: 'cache' },
    ])

    const injects = metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]
    expect(injects).toHaveLength(2)
    expect(injects[0]).toEqual({ propertyName: 'db', serviceKey: 'db' })
    expect(injects[1]).toEqual({ propertyName: 'cache', serviceKey: 'cache' })
  })

  it('应支持单个注入字段', () => {
    const metadata = applyFieldDecorators([
      { decorator: Inject, serviceKey: 'queue', propertyName: 'queue' },
    ])

    const injects = metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]
    expect(injects).toHaveLength(1)
    expect(injects[0]).toEqual({ propertyName: 'queue', serviceKey: 'queue' })
  })

  it('serviceKey 可与属性名不同', () => {
    const metadata = applyFieldDecorators([
      { decorator: Inject, serviceKey: 'chat_service', propertyName: 'chatSvc' },
    ])

    const injects = metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]
    expect(injects[0]).toEqual({ propertyName: 'chatSvc', serviceKey: 'chat_service' })
  })

  it('多次调用应累积到同一数组（懒初始化 ??= 行为）', () => {
    const metadata = applyFieldDecorators([
      { decorator: Inject, serviceKey: 'a', propertyName: 'a' },
      { decorator: Inject, serviceKey: 'b', propertyName: 'b' },
      { decorator: Inject, serviceKey: 'c', propertyName: 'c' },
    ])

    const injects = metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]
    // 必须是同一个数组实例，长度为 3
    expect(injects).toHaveLength(3)
    expect(injects.map((e) => e.serviceKey)).toEqual(['a', 'b', 'c'])
  })
})

describe('@Provide', () => {
  it('应将暴露元数据写入 metadata 对象', () => {
    const metadata = applyFieldDecorators([
      { decorator: Provide, serviceKey: 'archive', propertyName: 'archiveService' },
    ])

    const provides = metadata[SERVICE_PROVIDES] as { propertyName: string; serviceKey: string }[]
    expect(provides).toHaveLength(1)
    expect(provides[0]).toEqual({ propertyName: 'archiveService', serviceKey: 'archive' })
  })

  it('应支持多个 Provide 字段', () => {
    const metadata = applyFieldDecorators([
      { decorator: Provide, serviceKey: 'foo', propertyName: 'fooInstance' },
      { decorator: Provide, serviceKey: 'bar', propertyName: 'barInstance' },
    ])

    const provides = metadata[SERVICE_PROVIDES] as { propertyName: string; serviceKey: string }[]
    expect(provides).toHaveLength(2)
    expect(provides[0]).toEqual({ propertyName: 'fooInstance', serviceKey: 'foo' })
    expect(provides[1]).toEqual({ propertyName: 'barInstance', serviceKey: 'bar' })
  })
})

describe('@Inject 与 @Provide 在同一 metadata 上共存', () => {
  it('两者使用不同 Symbol key，互不干扰', () => {
    const metadata = applyFieldDecorators([
      { decorator: Inject, serviceKey: 'db', propertyName: 'db' },
      { decorator: Provide, serviceKey: 'myService', propertyName: 'myService' },
    ])

    const injects = metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]
    const provides = metadata[SERVICE_PROVIDES] as { propertyName: string; serviceKey: string }[]

    expect(injects).toHaveLength(1)
    expect(provides).toHaveLength(1)
    expect(injects[0]!.serviceKey).toBe('db')
    expect(provides[0]!.serviceKey).toBe('myService')
  })
})

// TC39 Stage 3 方法装饰器测试：通过手动模拟 ClassMethodDecoratorContext 调用装饰器，
// 验证元数据正确写入 metadata 对象，无需依赖转换器支持 @decorator 语法。

/** 模拟 ClassMethodDecoratorContext 调用方法装饰器并返回填充好的 metadata 对象。 */
function applyMethodDecorator(
  decorator: (target: (...args: unknown[]) => unknown, ctx: ClassMethodDecoratorContext) => void,
  methodName: string,
  existingMetadata?: Record<symbol, unknown>,
): Record<symbol, unknown> {
  const metadata: Record<symbol, unknown> = existingMetadata ?? {}
  const ctx = {
    kind: 'method' as const,
    name: methodName,
    metadata,
    static: false,
    private: false,
    access: { has: () => false, get: () => () => {} },
    addInitializer: () => {},
  } as unknown as ClassMethodDecoratorContext
  decorator(() => {}, ctx)
  return metadata
}

describe('@Startup / @Shutdown', () => {
  it('应将启动方法名写入 metadata', () => {
    const metadata = applyMethodDecorator(Startup, 'start')
    const lifecycle = metadata[SERVICE_LIFECYCLE] as LifecycleEntry
    expect(lifecycle.startupMethod).toBe('start')
    expect(lifecycle.shutdownMethod).toBe(null)
  })

  it('应将关闭方法名写入 metadata', () => {
    const metadata = applyMethodDecorator(Shutdown, 'stop')
    const lifecycle = metadata[SERVICE_LIFECYCLE] as LifecycleEntry
    expect(lifecycle.startupMethod).toBe(null)
    expect(lifecycle.shutdownMethod).toBe('stop')
  })

  it('应同时记录启动和关闭方法名（共享同一 metadata）', () => {
    const metadata = applyMethodDecorator(Startup, 'start')
    applyMethodDecorator(Shutdown, 'stop', metadata)
    const lifecycle = metadata[SERVICE_LIFECYCLE] as LifecycleEntry
    expect(lifecycle.startupMethod).toBe('start')
    expect(lifecycle.shutdownMethod).toBe('stop')
  })

  it('重复标记 @Startup 应抛出错误', () => {
    expect(() => {
      const metadata = applyMethodDecorator(Startup, 'start1')
      applyMethodDecorator(Startup, 'start2', metadata)
    }).toThrow('@Startup 只能标记一个方法')
  })

  it('重复标记 @Shutdown 应抛出错误', () => {
    expect(() => {
      const metadata = applyMethodDecorator(Shutdown, 'stop1')
      applyMethodDecorator(Shutdown, 'stop2', metadata)
    }).toThrow('@Shutdown 只能标记一个方法')
  })
})

// ─── @Service 集成测试 ───────────────────────────────────────────────────────
// 手动构造共享 metadata，模拟 TC39 Stage 3 装饰器在类上的执行顺序：
// 字段/方法装饰器先运行（写入 metadata），类装饰器最后运行（读取 metadata）。

/** 手动触发 @Service 类装饰器，传入预先填充好的 metadata。 */
function applyServiceDecorator(
  name: string,
  metadata: Record<symbol, unknown>,

  targetClass: new (...args: any[]) => unknown,
): void {
  const ctx = {
    kind: 'class' as const,
    name: targetClass.name,
    metadata,
    addInitializer: () => {},
  } as unknown as ClassDecoratorContext
  // Service 返回 void（无返回值替换），直接调用
  const decorate = Service({ name })
  decorate(targetClass, ctx)
}

describe('@Service', () => {
  afterEach(() => {
    // 确保每个测试后清理注册表，避免测试间污染
    serviceEntryRegistry.clear()
  })

  it('应将 @Inject、@Provide、@Startup、@Shutdown 元数据聚合为 ServiceEntry', () => {
    // 1. 构造共享 metadata（模拟类的 Symbol.metadata）
    const metadata: Record<symbol, unknown> = {}

    // 2. 手动应用字段装饰器（@Inject、@Provide）
    const fieldCtxBase = {
      kind: 'field' as const,
      metadata,
      static: false,
      private: false,
      access: { has: () => false, get: () => undefined, set: () => {} },
      addInitializer: () => {},
    }
    Inject('db')(undefined, { ...fieldCtxBase, name: 'db' })
    Provide('extra')(undefined, { ...fieldCtxBase, name: 'extra' })

    // 3. 手动应用方法装饰器（@Startup、@Shutdown）
    const methodCtxBase = {
      kind: 'method' as const,
      metadata,
      static: false,
      private: false,
      access: { has: () => false, get: () => () => {} },
      addInitializer: () => {},
    }
    Startup(() => {}, { ...methodCtxBase, name: 'start' })
    Shutdown(() => {}, { ...methodCtxBase, name: 'stop' })

    // 4. 应用 @Service 类装饰器
    class TestSvc {}
    applyServiceDecorator('test_svc', metadata, TestSvc)

    // 5. 断言
    const entry = serviceEntryRegistry.get('test_svc')!
    expect(entry).toBeDefined()
    expect(entry.name).toBe('test_svc')
    expect(entry.injects).toEqual([{ propertyName: 'db', serviceKey: 'db' }])
    expect(entry.provides).toEqual([{ propertyName: 'extra', serviceKey: 'extra' }])
    expect(entry.startupMethod).toBe('start')
    expect(entry.shutdownMethod).toBe('stop')
    expect(entry.settingNodes).toEqual([])
  })

  it('无任何子装饰器时应生成空 injects/provides 并无 startupMethod/shutdownMethod', () => {
    const metadata: Record<symbol, unknown> = {}
    class EmptySvc {}
    applyServiceDecorator('empty_svc', metadata, EmptySvc)

    const entry = serviceEntryRegistry.get('empty_svc')!
    expect(entry).toBeDefined()
    expect(entry.injects).toEqual([])
    expect(entry.provides).toEqual([])
    expect(entry.startupMethod).toBeNull()
    expect(entry.shutdownMethod).toBeNull()
  })

  it('重复注册相同名称时应抛出包含"名称冲突"的错误', () => {
    const metadata: Record<symbol, unknown> = {}
    class A {}
    applyServiceDecorator('dup', metadata, A)

    expect(() => {
      class B {}
      applyServiceDecorator('dup', {}, B)
    }).toThrow('名称冲突')
  })

  it('settingNodes 的 key 应以服务名称作前缀', () => {
    const metadata: Record<symbol, unknown> = {}
    const settingEntry: SettingNodeEntry = {
      key: 'enabled',
      options: { type: 'boolean', default: true },
    }
    metadata[SERVICE_SETTINGS] = [settingEntry]
    metadata[SERVICE_LIFECYCLE] = { startupMethod: null, shutdownMethod: null }

    class WithSettings {}
    applyServiceDecorator('my_svc', metadata, WithSettings)

    const entry = serviceEntryRegistry.get('my_svc')!
    expect(entry.settingNodes).toHaveLength(1)
    expect(entry.settingNodes[0]!.key).toBe('my_svc.enabled')
  })
})
