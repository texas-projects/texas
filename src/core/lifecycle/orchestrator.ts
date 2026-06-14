/**
 * 生命周期编排器 —— 读取 serviceEntryRegistry，拓扑排序后按序实例化、注入、启动/关闭。
 */

import { logger } from '@logger'

import { serviceEntryRegistry } from './decorators/service.js'
import type { ServiceEntry } from './service-entry.js'

/**
 * 管理业务模块的启动与关闭。
 *
 * 典型用法：
 * ```ts
 * const orchestrator = new LifecycleOrchestrator()
 * const services = await orchestrator.startup(infraServices)
 * // ...
 * await orchestrator.shutdown()
 * ```
 */
export class LifecycleOrchestrator {
  private _services: Record<string, unknown> = {}
  private _instances: { entry: ServiceEntry; instance: Record<string | symbol, unknown> }[] = []

  /** 已启动的所有服务（含基础设施），返回副本。 */
  get services(): Record<string, unknown> {
    return { ...this._services }
  }

  /**
   * 按拓扑顺序实例化并启动所有已注册业务模块。
   *
   * @param infraServices - 基础设施提供的初始服务字典（db、cache 等）
   * @returns 合并后的完整服务字典（含基础设施 + 所有业务服务）
   */
  async startup(infraServices: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this._instances.length > 0) {
      throw new Error('LifecycleOrchestrator.startup() 已被调用，不可重复启动')
    }
    this._services = { ...infraServices }
    this._instances = []

    const entries = Array.from(serviceEntryRegistry.values())
    const sorted = this._topoSort(entries, new Set(Object.keys(infraServices)))

    for (const entry of sorted) {
      // 1. 实例化服务类
      const instance = new entry.serviceClass() as Record<string | symbol, unknown>

      // 2. 注入 @Inject 字段
      for (const inject of entry.injects) {
        if (!(inject.serviceKey in this._services)) {
          throw new Error(`[${entry.name}] @Inject('${inject.serviceKey}') 未满足：服务不存在`)
        }
        instance[inject.propertyName] = this._services[inject.serviceKey]
      }

      // 3. 调用 @Startup 方法
      if (entry.startupMethod !== null) {
        const method = instance[entry.startupMethod]
        if (typeof method !== 'function') {
          throw new Error(`[${entry.name}] @Startup 方法 '${String(entry.startupMethod)}' 不是函数`)
        }
        await (method as () => Promise<void>).call(instance)
      }

      // 4. 注册服务自身（按 name key）
      this._services[entry.name] = instance

      // 5. 注册 @Provide 声明的额外 key（读取字段值）
      for (const provide of entry.provides) {
        this._services[provide.serviceKey] = instance[provide.propertyName]
      }

      this._instances.push({ entry, instance })
      logger.info({ name: entry.name }, '业务模块已启动')
    }

    return { ...this._services }
  }

  /**
   * 按启动逆序关闭所有已注册 @Shutdown 方法的模块。
   */
  async shutdown(): Promise<void> {
    for (const { entry, instance } of [...this._instances].reverse()) {
      if (entry.shutdownMethod === null) continue

      try {
        const method = instance[entry.shutdownMethod]
        if (typeof method !== 'function') {
          logger.warn(
            { name: entry.name, method: String(entry.shutdownMethod) },
            '@Shutdown 方法不是函数，跳过',
          )
          continue
        }
        await (method as () => Promise<void>).call(instance)
        logger.info({ name: entry.name }, '业务模块已关闭')
      } catch (err) {
        logger.error({ name: entry.name, err }, '业务模块关闭失败')
      }
    }
  }

  /**
   * Kahn 算法拓扑排序。
   *
   * @param entries - 待排序的服务条目列表
   * @param resolved - 初始已可用的 key 集合（基础设施 provides）
   * @returns 按依赖顺序排列的条目列表
   * @throws {Error} 存在循环依赖或未满足的 @Inject 依赖时抛出
   */
  private _topoSort(entries: ServiceEntry[], resolved: Set<string>): ServiceEntry[] {
    const graph = new Map<string, { entry: ServiceEntry; deps: Set<string> }>()

    for (const entry of entries) {
      const requires = new Set(entry.injects.map((i) => i.serviceKey))
      graph.set(entry.name, { entry, deps: requires })
    }

    const sorted: ServiceEntry[] = []
    const available = new Set(resolved)

    while (graph.size > 0) {
      let progress = false

      for (const [name, node] of graph) {
        const unmet = [...node.deps].filter((d) => !available.has(d))
        if (unmet.length === 0) {
          sorted.push(node.entry)
          available.add(name)
          // @Provide 的额外 key 也加入可用集合
          for (const p of node.entry.provides) {
            available.add(p.serviceKey)
          }
          graph.delete(name)
          progress = true
        }
      }

      if (!progress) {
        const remaining = [...graph.entries()]
          .map(([name, node]) => {
            const unmet = [...node.deps].filter((d) => !available.has(d))
            return `${name}（缺少: ${unmet.join(', ')}）`
          })
          .join('; ')
        throw new Error(`循环依赖或未满足依赖: ${remaining}`)
      }
    }

    return sorted
  }
}
