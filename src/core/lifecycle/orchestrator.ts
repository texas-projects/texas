/**
 * 生命周期编排器 —— 拓扑排序 + 按序启动/关闭业务模块。
 */

import { logger } from '../logging/setup.js'

import type { ShutdownEntry, StartupEntry } from './registry.js'

/**
 * Kahn 算法拓扑排序。
 *
 * @param entries - 待排序的启动入口列表
 * @param available - 初始已有的 key 集合（基础设施 provides）
 * @returns 按依赖顺序排列的入口列表
 * @throws {Error} 存在无法满足的依赖（循环依赖或缺失的 requires）
 */
function topoSort(entries: StartupEntry[], available: Set<string>): StartupEntry[] {
  const remaining = [...entries]
  const ordered: StartupEntry[] = []
  const resolved = new Set(available)

  while (remaining.length > 0) {
    const ready = remaining.filter((e) => e.requires.every((r) => resolved.has(r)))
    if (ready.length === 0) {
      const unresolved = Object.fromEntries(
        remaining.map((e) => [e.name, e.requires.filter((r) => !resolved.has(r))]),
      )
      throw new Error(`无法解析模块依赖，未满足的 requires: ${JSON.stringify(unresolved)}`)
    }
    for (const entry of ready) {
      ordered.push(entry)
      for (const key of entry.provides) {
        resolved.add(key)
      }
      remaining.splice(remaining.indexOf(entry), 1)
    }
  }

  return ordered
}

/**
 * 管理业务模块的启动与关闭。
 *
 * 典型用法：
 * ```ts
 * const orchestrator = new LifecycleOrchestrator()
 * const services = await orchestrator.startup(infraServices, startupEntries)
 * // ...
 * await orchestrator.shutdown(shutdownEntries)
 * ```
 */
export class LifecycleOrchestrator {
  private _services: Record<string, unknown> = {}
  private _startupOrder: StartupEntry[] = []

  /** 已启动的所有服务（含基础设施）。 */
  get services(): Record<string, unknown> {
    return { ...this._services }
  }

  /**
   * 按拓扑顺序启动所有已注册业务模块。
   *
   * @param infraServices - 基础设施提供的初始服务 dict
   * @param startupEntries - 所有已注册的 @Startup 入口
   * @returns 合并后的完整服务字典
   */
  async startup(
    infraServices: Record<string, unknown>,
    startupEntries: StartupEntry[],
  ): Promise<Record<string, unknown>> {
    this._services = { ...infraServices }

    if (startupEntries.length === 0) {
      return { ...this._services }
    }

    this._startupOrder = topoSort(startupEntries, new Set(Object.keys(infraServices)))

    for (const entry of this._startupOrder) {
      const deps = Object.fromEntries(entry.requires.map((k) => [k, this._services[k]]))
      const provided = await entry.fn(deps)
      Object.assign(this._services, provided)
      logger.info({ name: entry.name, provides: entry.provides }, '业务模块已启动')
    }

    return { ...this._services }
  }

  /**
   * 按启动逆序关闭所有模块（仅执行声明了 @Shutdown 的模块）。
   *
   * @param shutdownEntries - 所有已注册的 @Shutdown 入口
   */
  async shutdown(shutdownEntries: ShutdownEntry[]): Promise<void> {
    const shutdownMap = new Map(shutdownEntries.map((e) => [e.name, e]))

    for (const entry of [...this._startupOrder].reverse()) {
      const hookEntry = shutdownMap.get(entry.name)
      if (hookEntry === undefined) continue

      try {
        const svcDict = Object.fromEntries(
          entry.provides.filter((k) => k in this._services).map((k) => [k, this._services[k]]),
        )
        await hookEntry.fn(svcDict)
        logger.info({ name: entry.name }, '业务模块已关闭')
      } catch (err) {
        logger.error({ name: entry.name, err }, '业务模块关闭失败')
      }
    }
  }
}
