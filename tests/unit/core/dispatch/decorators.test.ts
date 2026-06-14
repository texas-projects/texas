/* eslint-disable @typescript-eslint/no-extraneous-class */
import { describe, it, expect, afterEach } from 'vitest'

import { Handler } from '@/core/dispatch/decorators/handler.js'
import { Interceptor } from '@/core/dispatch/decorators/interceptor.js'
import { Permission, Scope, Priority } from '@/core/dispatch/decorators/method-options.js'
import {
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
  OnNotice,
  OnRequest,
  OnMessageSent,
  OnPoke,
  OnEssence,
  OnOffline,
} from '@/core/dispatch/decorators/routing.js'
import { SettingNode } from '@/core/dispatch/decorators/setting-node.js'
import {
  HANDLER_METHODS,
  type MethodMetaEntry,
  HANDLER_CLASS_INTERCEPTORS,
  type InterceptorEntry,
  HANDLER_SETTINGS,
  type SettingNodeEntry,
} from '@/core/dispatch/decorators/symbols.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'
import { Inject } from '@/core/lifecycle/decorators/inject.js'
import { SERVICE_SETTINGS } from '@/core/lifecycle/decorators/symbols.js'

// TC39 Stage 3 方法装饰器测试：通过手动模拟 ClassMethodDecoratorContext 调用装饰器工厂，
// 验证元数据正确写入 metadata 对象，无需依赖转换器支持 @decorator 语法。

/**
 * 模拟 ClassMethodDecoratorContext 调用方法装饰器，并返回填充好的 metadata 对象。
 * 支持在同一个 metadata 上多次调用（模拟多个装饰器作用于同一方法）。
 */
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

// ─── @OnCommand ──────────────────────────────────────────────────────────────

describe('@OnCommand', () => {
  it('应将 mappingType 设为 command 并记录 cmd', () => {
    const metadata = applyMethodDecorator(OnCommand('ping'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods).toHaveLength(1)
    expect(methods[0]!.mappingType).toBe('command')
    expect((methods[0]!.trigger as { cmd: string }).cmd).toBe('ping')
  })

  it('无 aliases 时 trigger.aliases 应为 undefined', () => {
    const metadata = applyMethodDecorator(OnCommand('ping'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect((methods[0]!.trigger as { aliases: unknown }).aliases).toBeUndefined()
  })

  it('传入 aliases 时应转为 Set', () => {
    const metadata = applyMethodDecorator(OnCommand('ping', { aliases: ['p', 'pong'] }), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const aliases = (methods[0]!.trigger as { aliases: Set<string> }).aliases
    expect(aliases).toBeInstanceOf(Set)
    expect(aliases.has('p')).toBe(true)
    expect(aliases.has('pong')).toBe(true)
  })
})

// ─── @OnKeyword ──────────────────────────────────────────────────────────────

describe('@OnKeyword', () => {
  it('应将 string[] 转为 Set 并写入 trigger.keywords', () => {
    const metadata = applyMethodDecorator(OnKeyword(['hello', 'hi']), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('keyword')
    const keywords = (methods[0]!.trigger as { keywords: Set<string> }).keywords
    expect(keywords).toBeInstanceOf(Set)
    expect(keywords.has('hello')).toBe(true)
    expect(keywords.has('hi')).toBe(true)
  })
})

// ─── @OnRegex ────────────────────────────────────────────────────────────────

describe('@OnRegex', () => {
  it('应记录 pattern 并编译为 RegExp', () => {
    const metadata = applyMethodDecorator(OnRegex('\\d+'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('regex')
    const trigger = methods[0]!.trigger as { pattern: string; compiledPattern: RegExp }
    expect(trigger.pattern).toBe('\\d+')
    expect(trigger.compiledPattern).toBeInstanceOf(RegExp)
    expect(trigger.compiledPattern.test('123')).toBe(true)
  })

  it('应支持 flags 参数', () => {
    const metadata = applyMethodDecorator(OnRegex('foo', 'i'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const { compiledPattern } = methods[0]!.trigger as { compiledPattern: RegExp }
    expect(compiledPattern.flags).toContain('i')
  })
})

// ─── @OnStartsWith / @OnEndsWith / @OnFullMatch ───────────────────────────────

describe('@OnStartsWith', () => {
  it('应记录 prefix', () => {
    const metadata = applyMethodDecorator(OnStartsWith('#'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('startswith')
    expect((methods[0]!.trigger as { prefix: string }).prefix).toBe('#')
  })
})

describe('@OnEndsWith', () => {
  it('应记录 suffix', () => {
    const metadata = applyMethodDecorator(OnEndsWith('?'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('endswith')
    expect((methods[0]!.trigger as { suffix: string }).suffix).toBe('?')
  })
})

describe('@OnFullMatch', () => {
  it('应记录 text', () => {
    const metadata = applyMethodDecorator(OnFullMatch('你好'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('fullmatch')
    expect((methods[0]!.trigger as { text: string }).text).toBe('你好')
  })
})

// ─── 事件类型装饰器 ────────────────────────────────────────────────────────────

describe('@OnEvent', () => {
  it('应记录 eventType', () => {
    const metadata = applyMethodDecorator(OnEvent('meta_event'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.mappingType).toBe('event_type')
    expect((methods[0]!.trigger as { eventType: string }).eventType).toBe('meta_event')
  })
})

describe('@OnNotice', () => {
  it('应记录 eventType=notice 及 noticeType/subType', () => {
    const metadata = applyMethodDecorator(OnNotice('group_increase', 'invite'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const trigger = methods[0]!.trigger as {
      eventType: string
      noticeType?: string
      subType?: string
    }
    expect(trigger.eventType).toBe('notice')
    expect(trigger.noticeType).toBe('group_increase')
    expect(trigger.subType).toBe('invite')
  })
})

describe('@OnRequest', () => {
  it('应记录 eventType=request 及 requestType', () => {
    const metadata = applyMethodDecorator(OnRequest('friend'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const trigger = methods[0]!.trigger as { eventType: string; requestType?: string }
    expect(trigger.eventType).toBe('request')
    expect(trigger.requestType).toBe('friend')
  })
})

describe('@OnMessageSent', () => {
  it('应记录 eventType=message_sent', () => {
    const metadata = applyMethodDecorator(OnMessageSent(), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect((methods[0]!.trigger as { eventType: string }).eventType).toBe('message_sent')
  })
})

describe('@OnPoke', () => {
  it('应记录 noticeType=notify subType=poke', () => {
    const metadata = applyMethodDecorator(OnPoke(), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const trigger = methods[0]!.trigger as {
      eventType: string
      noticeType: string
      subType: string
    }
    expect(trigger.eventType).toBe('notice')
    expect(trigger.noticeType).toBe('notify')
    expect(trigger.subType).toBe('poke')
  })
})

describe('@OnEssence', () => {
  it('应记录 noticeType=essence', () => {
    const metadata = applyMethodDecorator(OnEssence('add'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const trigger = methods[0]!.trigger as {
      eventType: string
      noticeType: string
      subType?: string
    }
    expect(trigger.eventType).toBe('notice')
    expect(trigger.noticeType).toBe('essence')
    expect(trigger.subType).toBe('add')
  })
})

describe('@OnOffline', () => {
  it('应记录 noticeType=bot_offline', () => {
    const metadata = applyMethodDecorator(OnOffline(), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    const trigger = methods[0]!.trigger as { eventType: string; noticeType: string }
    expect(trigger.eventType).toBe('notice')
    expect(trigger.noticeType).toBe('bot_offline')
  })
})

// ─── @Interceptor ─────────────────────────────────────────────────────────────

/** 测试用假拦截器类 */
class FakeInterceptor {
  constructor(public opts?: unknown) {}
}

/**
 * 模拟 ClassDecoratorContext 调用类装饰器，返回填充好的 metadata 对象。
 */
function applyClassDecorator(
  decorator: (target: unknown, ctx: ClassDecoratorContext) => void,
  existingMetadata?: Record<symbol, unknown>,
): Record<symbol, unknown> {
  const metadata: Record<symbol, unknown> = existingMetadata ?? {}
  const ctx = {
    kind: 'class' as const,
    name: 'TestClass',
    metadata,
    addInitializer: () => {},
  } as unknown as ClassDecoratorContext
  decorator(class {}, ctx)
  return metadata
}

describe('@Interceptor', () => {
  it('作用于类时应将拦截器条目写入 HANDLER_CLASS_INTERCEPTORS', () => {
    const opts = { level: 1 }
    const metadata = applyClassDecorator(Interceptor(FakeInterceptor, opts))
    const list = metadata[HANDLER_CLASS_INTERCEPTORS] as InterceptorEntry[]
    expect(list).toHaveLength(1)
    expect(list[0]!.interceptorClass).toBe(FakeInterceptor)
    expect(list[0]!.options).toBe(opts)
  })

  it('多次作用于类时应追加到 HANDLER_CLASS_INTERCEPTORS 数组', () => {
    class AnotherInterceptor {}
    let metadata = applyClassDecorator(Interceptor(FakeInterceptor))
    metadata = applyClassDecorator(Interceptor(AnotherInterceptor), metadata)
    const list = metadata[HANDLER_CLASS_INTERCEPTORS] as InterceptorEntry[]
    expect(list).toHaveLength(2)
    expect(list[0]!.interceptorClass).toBe(FakeInterceptor)
    expect(list[1]!.interceptorClass).toBe(AnotherInterceptor)
  })

  it('作用于方法时应将拦截器条目写入对应 MethodMetaEntry.interceptors[]', () => {
    const opts = { timeout: 3000 }
    // 先通过 @OnCommand 创建方法 entry，再通过 @Interceptor 追加拦截器
    let metadata = applyMethodDecorator(OnCommand('ping'), 'handle')
    metadata = applyMethodDecorator(
      Interceptor(FakeInterceptor, opts) as Parameters<typeof applyMethodDecorator>[0],
      'handle',
      metadata,
    )

    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods).toHaveLength(1)
    const interceptors = methods[0]!.interceptors as InterceptorEntry[]
    expect(interceptors).toHaveLength(1)
    expect(interceptors[0]!.interceptorClass).toBe(FakeInterceptor)
    expect(interceptors[0]!.options).toBe(opts)
  })

  it('作用于方法时若 entry 不存在应自动创建 entry 并追加拦截器', () => {
    // 只应用 @Interceptor，不预先应用路由装饰器
    const metadata = applyMethodDecorator(
      Interceptor(FakeInterceptor) as Parameters<typeof applyMethodDecorator>[0],
      'handle',
    )

    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods).toHaveLength(1)
    expect(methods[0]!.methodName).toBe('handle')
    const interceptors = methods[0]!.interceptors as InterceptorEntry[]
    expect(interceptors).toHaveLength(1)
    expect(interceptors[0]!.interceptorClass).toBe(FakeInterceptor)
  })

  it('方法级拦截器不应影响类级别 HANDLER_CLASS_INTERCEPTORS', () => {
    const metadata = applyMethodDecorator(
      Interceptor(FakeInterceptor) as Parameters<typeof applyMethodDecorator>[0],
      'handle',
    )
    expect(metadata[HANDLER_CLASS_INTERCEPTORS]).toBeUndefined()
  })
})

// ─── @SettingNode ─────────────────────────────────────────────────────────────

describe('@SettingNode', () => {
  it('单个 @SettingNode 应向 HANDLER_SETTINGS 写入一条条目', () => {
    const metadata = applyClassDecorator(SettingNode('enabled', { type: 'boolean', default: true }))
    const settings = metadata[HANDLER_SETTINGS] as SettingNodeEntry[]
    expect(settings).toHaveLength(1)
    expect(settings[0]!.key).toBe('enabled')
    expect(settings[0]!.options.type).toBe('boolean')
    expect(settings[0]!.options.default).toBe(true)
  })

  it('单个 @SettingNode 应同时向 SERVICE_SETTINGS 写入相同条目', () => {
    const metadata = applyClassDecorator(
      SettingNode('enabled', { type: 'boolean', default: false }),
    )
    const settings = metadata[SERVICE_SETTINGS] as SettingNodeEntry[]
    expect(settings).toHaveLength(1)
    expect(settings[0]!.key).toBe('enabled')
    expect(settings[0]!.options.default).toBe(false)
  })

  it('多个 @SettingNode 应在 HANDLER_SETTINGS 中累积（顺序：先调用先入）', () => {
    // 手动模拟多次调用（内层先执行：先 maxRetries，再 enabled）
    let metadata = applyClassDecorator(SettingNode('maxRetries', { type: 'number', default: 3 }))
    metadata = applyClassDecorator(
      SettingNode('enabled', { type: 'boolean', default: true }),
      metadata,
    )

    const settings = metadata[HANDLER_SETTINGS] as SettingNodeEntry[]
    expect(settings).toHaveLength(2)
    expect(settings[0]!.key).toBe('maxRetries')
    expect(settings[0]!.options.type).toBe('number')
    expect(settings[0]!.options.default).toBe(3)
    expect(settings[1]!.key).toBe('enabled')
    expect(settings[1]!.options.type).toBe('boolean')
    expect(settings[1]!.options.default).toBe(true)
  })

  it('多个 @SettingNode 应在 SERVICE_SETTINGS 中同样累积', () => {
    let metadata = applyClassDecorator(SettingNode('maxRetries', { type: 'number', default: 3 }))
    metadata = applyClassDecorator(
      SettingNode('enabled', { type: 'boolean', default: true }),
      metadata,
    )

    const settings = metadata[SERVICE_SETTINGS] as SettingNodeEntry[]
    expect(settings).toHaveLength(2)
    expect(settings[0]!.key).toBe('maxRetries')
    expect(settings[1]!.key).toBe('enabled')
  })

  it('应正确保存可选字段 description、enumOptions、scope、category', () => {
    const metadata = applyClassDecorator(
      SettingNode('mode', {
        type: 'enum',
        default: 'fast',
        description: '运行模式',
        enumOptions: { fast: 'fast', slow: 'slow' },
        scope: 'group',
        category: 'advanced',
      }),
    )
    const settings = metadata[HANDLER_SETTINGS] as SettingNodeEntry[]
    const opts = settings[0]!.options
    expect(opts.description).toBe('运行模式')
    expect(opts.enumOptions).toEqual({ fast: 'fast', slow: 'slow' })
    expect(opts.scope).toBe('group')
    expect(opts.category).toBe('advanced')
  })
})

// ─── @Permission / @Scope / @Priority ────────────────────────────────────────

describe('@Permission', () => {
  it('应将 permission 写入方法 entry', () => {
    const metadata = applyMethodDecorator(Permission(20), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.permission).toBe(20)
  })
})

describe('@Scope', () => {
  it('应将 scope 写入方法 entry', () => {
    const metadata = applyMethodDecorator(Scope('group'), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.scope).toBe('group')
  })
})

describe('@Priority', () => {
  it('应将 priority 写入方法 entry', () => {
    const metadata = applyMethodDecorator(Priority(10), 'handle')
    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods[0]!.priority).toBe(10)
  })
})

// ─── 多个装饰器共享同一个 entry ───────────────────────────────────────────────

describe('多装饰器共享 entry', () => {
  it('@OnCommand + @Permission + @Scope 应共享同一 MethodMetaEntry', () => {
    // 装饰器执行顺序：底层先执行（@Priority → @Scope → @Permission → @OnCommand）
    let metadata = applyMethodDecorator(Priority(5), 'handle')
    metadata = applyMethodDecorator(Scope('group'), 'handle', metadata)
    metadata = applyMethodDecorator(Permission(10), 'handle', metadata)
    metadata = applyMethodDecorator(OnCommand('test'), 'handle', metadata)

    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    // 应只有一个 entry（所有装饰器共享）
    expect(methods).toHaveLength(1)
    const entry = methods[0]!
    expect(entry.mappingType).toBe('command')
    expect((entry.trigger as { cmd: string }).cmd).toBe('test')
    expect(entry.permission).toBe(10)
    expect(entry.scope).toBe('group')
    expect(entry.priority).toBe(5)
  })

  it('不同方法名应生成各自独立的 entry', () => {
    let metadata = applyMethodDecorator(OnCommand('foo'), 'methodA')
    metadata = applyMethodDecorator(OnCommand('bar'), 'methodB', metadata)

    const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
    expect(methods).toHaveLength(2)
    expect((methods[0]!.trigger as { cmd: string }).cmd).toBe('foo')
    expect((methods[1]!.trigger as { cmd: string }).cmd).toBe('bar')
  })
})

// ─── @Handler ─────────────────────────────────────────────────────────────────

/**
 * 通过手动模拟装饰器上下文来应用 @Handler 类装饰器，避免依赖运行时 @ 语法。
 * metadata 可预先注入方法/字段元数据，模拟其他装饰器已经执行的状态。
 */
function applyHandlerDecorator(
  opts: Parameters<typeof Handler>[0],
  targetClass: new (...args: unknown[]) => unknown,
  existingMetadata?: Record<symbol, unknown>,
): Record<symbol, unknown> {
  const metadata: Record<symbol, unknown> = existingMetadata ?? {}
  const ctx = {
    kind: 'class' as const,
    name: targetClass.name,
    metadata,
    addInitializer: () => {},
  } as unknown as ClassDecoratorContext
  Handler(opts)(targetClass, ctx)
  return metadata
}

/** 模拟 ClassFieldDecoratorContext 调用 @Inject 字段装饰器。 */
function applyFieldDecorator(
  decorator: (serviceKey: string) => (_value: undefined, ctx: ClassFieldDecoratorContext) => void,
  serviceKey: string,
  propertyName: string,
  existingMetadata?: Record<symbol, unknown>,
): Record<symbol, unknown> {
  const metadata: Record<symbol, unknown> = existingMetadata ?? {}
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
  return metadata
}

describe('@Handler', () => {
  afterEach(() => {
    handlerRegistry.unregister('test_handler')
    handlerRegistry.unregister('inject_test')
  })

  it('should collect all method metadata and register', () => {
    // 模拟：@OnCommand('test') + @Permission(20) + @Scope('group') 作用于方法
    let metadata = applyMethodDecorator(Permission(20), 'handle')
    metadata = applyMethodDecorator(Scope('group'), 'handle', metadata)
    metadata = applyMethodDecorator(OnCommand('test'), 'handle', metadata)
    // 模拟：@SettingNode('enabled') 作用于类
    metadata = applyClassDecorator(
      SettingNode('enabled', { type: 'boolean', default: true }),
      metadata,
    )
    // 模拟：@Handler 作用于类（最外层，最后执行）
    applyHandlerDecorator(
      { name: 'test_handler', displayName: 'Test' },
      class TestHandler {},
      metadata,
    )

    const entry = handlerRegistry.getDecoratorEntry('test_handler')
    expect(entry).toBeDefined()
    expect(entry!.methods).toHaveLength(1)
    expect(entry!.methods[0]!.mappingType).toBe('command')
    expect(entry!.methods[0]!.permission).toBe(20)
    expect(entry!.settingNodes[0]!.key).toBe('test_handler.enabled')
  })

  it('should collect @Inject fields into handler entry injects', () => {
    // 模拟 @Inject('some_service') 字段装饰器 + @OnCommand('test') 方法装饰器
    let metadata = applyFieldDecorator(Inject, 'some_service', 'svc')
    metadata = applyMethodDecorator(OnCommand('test'), 'handle', metadata)
    // 模拟 @Handler 类装饰器
    applyHandlerDecorator({ name: 'inject_test' }, class InjectTestHandler {}, metadata)

    const entry = handlerRegistry.getDecoratorEntry('inject_test')
    expect(entry).toBeDefined()
    expect(entry!.injects).toHaveLength(1)
    expect(entry!.injects[0]).toEqual({ propertyName: 'svc', serviceKey: 'some_service' })
  })
})
