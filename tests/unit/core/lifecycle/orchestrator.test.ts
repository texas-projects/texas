import { beforeEach, describe, expect, it } from 'vitest'

import { serviceEntryRegistry } from '@/core/lifecycle/decorators/service.js'
import { LifecycleOrchestrator } from '@/core/lifecycle/orchestrator.js'
import type { ServiceEntry } from '@/core/lifecycle/service-entry.js'

/**
 * 向 serviceEntryRegistry 注册一个最小化的 ServiceEntry，用于测试编排器逻辑。
 * 绕过 @Service 装饰器，直接操作注册表，避免依赖 TC39 Stage 3 装饰器语法的运行时支持。
 */
function registerEntry(entry: ServiceEntry): void {
  serviceEntryRegistry.set(entry.name, entry)
}

/** 创建一个只有 @Startup 方法的简单服务类。 */
function makeServiceClass(
  startupFn?: () => Promise<void>,
  shutdownFn?: () => Promise<void>,
): new () => unknown {
  return class {
    async start(): Promise<void> {
      if (startupFn) await startupFn()
    }
    async stop(): Promise<void> {
      if (shutdownFn) await shutdownFn()
    }
  }
}

beforeEach(() => {
  serviceEntryRegistry.clear()
})

describe('LifecycleOrchestrator', () => {
  it('空注册表应直接返回基础设施服务', async () => {
    const infra = { db: 'database', cache: 'redis' }
    const orchestrator = new LifecycleOrchestrator()
    const result = await orchestrator.startup(infra)

    expect(result.db).toBe('database')
    expect(result.cache).toBe('redis')
  })

  it('应实例化服务并调用 @Startup 方法', async () => {
    const callOrder: string[] = []

    registerEntry({
      name: 'svc_a',
      serviceClass: makeServiceClass(async () => {
        callOrder.push('a:start')
      }),
      injects: [],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    const services = await orchestrator.startup({})

    expect(callOrder).toEqual(['a:start'])
    expect(services.svc_a).toBeDefined()
  })

  it('应按拓扑顺序启动（@Inject 依赖优先）', async () => {
    const callOrder: string[] = []

    registerEntry({
      name: 'svc_a',
      serviceClass: makeServiceClass(async () => {
        callOrder.push('a')
      }),
      injects: [],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    registerEntry({
      name: 'svc_b',
      serviceClass: makeServiceClass(async () => {
        callOrder.push('b')
      }),
      injects: [{ propertyName: 'a', serviceKey: 'svc_a' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await orchestrator.startup({})

    // a 必须在 b 之前启动
    expect(callOrder).toEqual(['a', 'b'])
  })

  it('应将 @Inject 字段值正确赋给目标属性', async () => {
    const dbInstance = { query: () => 'result' }

    class SvcWithInject {
      db!: typeof dbInstance
      async start() {
        /* noop */
      }
    }

    registerEntry({
      name: 'svc_consumer',
      serviceClass: SvcWithInject,
      injects: [{ propertyName: 'db', serviceKey: 'db' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    const services = await orchestrator.startup({ db: dbInstance })

    expect((services.svc_consumer as SvcWithInject).db).toBe(dbInstance)
  })

  it('应在 startup 后读取 @Provide 字段并注册到服务注册表', async () => {
    class SvcWithProvide {
      child: object = {}
      async start() {
        this.child = { id: 42 }
      }
    }

    registerEntry({
      name: 'svc_with_provide',
      serviceClass: SvcWithProvide,
      injects: [],
      provides: [{ propertyName: 'child', serviceKey: 'child_svc' }],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    const services = await orchestrator.startup({})

    expect(services.child_svc).toEqual({ id: 42 })
    expect(services.svc_with_provide).toBeInstanceOf(SvcWithProvide)
  })

  it('@Inject 依赖由基础设施提供时应正确解析', async () => {
    registerEntry({
      name: 'svc_b',
      serviceClass: makeServiceClass(),
      injects: [{ propertyName: 'db', serviceKey: 'db' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    const result = await orchestrator.startup({ db: 'db-instance' })

    expect(result.svc_b).toBeDefined()
    expect(result.db).toBe('db-instance')
  })

  it('@Inject 依赖不满足时应抛出含服务名的错误', async () => {
    registerEntry({
      name: 'svc_bad',
      serviceClass: makeServiceClass(),
      injects: [{ propertyName: 'missing', serviceKey: 'nonexistent' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await expect(orchestrator.startup({})).rejects.toThrow('svc_bad')
  })

  it('循环依赖应抛出错误', async () => {
    registerEntry({
      name: 'svc_x',
      serviceClass: makeServiceClass(),
      injects: [{ propertyName: 'y', serviceKey: 'svc_y' }],
      provides: [],
      startupMethod: null,
      shutdownMethod: null,
      settingNodes: [],
    })

    registerEntry({
      name: 'svc_y',
      serviceClass: makeServiceClass(),
      injects: [{ propertyName: 'x', serviceKey: 'svc_x' }],
      provides: [],
      startupMethod: null,
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await expect(orchestrator.startup({})).rejects.toThrow()
  })

  it('shutdown 应按启动逆序调用 @Shutdown 方法', async () => {
    const callOrder: string[] = []

    registerEntry({
      name: 'x',
      serviceClass: makeServiceClass(undefined, async () => {
        callOrder.push('x')
      }),
      injects: [],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: 'stop',
      settingNodes: [],
    })

    registerEntry({
      name: 'y',
      serviceClass: makeServiceClass(undefined, async () => {
        callOrder.push('y')
      }),
      injects: [{ propertyName: 'x', serviceKey: 'x' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: 'stop',
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await orchestrator.startup({})
    await orchestrator.shutdown()

    // 启动顺序 x→y，关闭顺序 y→x
    expect(callOrder).toEqual(['y', 'x'])
  })

  it('无 @Shutdown 方法的模块在 shutdown 时应被跳过', async () => {
    const stoppedY = { called: false }

    registerEntry({
      name: 'svc_no_shutdown',
      serviceClass: makeServiceClass(),
      injects: [],
      provides: [],
      startupMethod: null,
      shutdownMethod: null,
      settingNodes: [],
    })

    registerEntry({
      name: 'svc_has_shutdown',
      serviceClass: makeServiceClass(undefined, async () => {
        stoppedY.called = true
      }),
      injects: [{ propertyName: 'svc_no_shutdown', serviceKey: 'svc_no_shutdown' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: 'stop',
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await orchestrator.startup({})
    await orchestrator.shutdown()

    expect(stoppedY.called).toBe(true)
  })

  it('services getter 应返回当前所有服务的副本', async () => {
    registerEntry({
      name: 'svc_q',
      serviceClass: makeServiceClass(),
      injects: [],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    await orchestrator.startup({ infra: 'infra-value' })

    const svcs = orchestrator.services
    expect(svcs.infra).toBe('infra-value')
    expect(svcs.svc_q).toBeDefined()
  })

  it('@Provide 的 key 可作为下游服务的 @Inject 来源', async () => {
    // svc_parent 在 startup 后 @Provide 出 child_key
    class SvcParent {
      child: object = {}
      async start() {
        this.child = { value: 'from-parent' }
      }
    }

    class SvcChild {
      injected!: object
      async start() {
        /* noop */
      }
    }

    registerEntry({
      name: 'svc_parent',
      serviceClass: SvcParent,
      injects: [],
      provides: [{ propertyName: 'child', serviceKey: 'child_key' }],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    registerEntry({
      name: 'svc_child',
      serviceClass: SvcChild,
      injects: [{ propertyName: 'injected', serviceKey: 'child_key' }],
      provides: [],
      startupMethod: 'start',
      shutdownMethod: null,
      settingNodes: [],
    })

    const orchestrator = new LifecycleOrchestrator()
    const services = await orchestrator.startup({})

    expect((services.svc_child as SvcChild).injected).toEqual({ value: 'from-parent' })
  })
})
