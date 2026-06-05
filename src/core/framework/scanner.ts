/**
 * ComponentScanner —— 发现 @Component 装饰类并注册处理器方法。
 */

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getLogger } from '../logging/setup.js'

const log = getLogger('scanner')

import { componentRegistry, handlerRegistry } from './decorators.js'
import type { CompositeHandlerMapping, HandlerMethod } from './mapping.js'

/**
 * 扫描目录中的 @Component 装饰类并注册处理器。
 *
 * 工作原理：
 *   1. 动态 import() 目录下所有 .ts/.js 文件，触发模块级装饰器副作用
 *   2. 装饰器将元数据写入 componentRegistry / handlerRegistry
 *   3. 遍历 componentRegistry，实例化组件，将方法注册到 CompositeHandlerMapping
 */
export class ComponentScanner {
  private readonly _componentNames: string[] = []

  /**
   * 扫描给定的文件目录，动态导入所有模块，然后将已注册的组件注册到映射。
   *
   * @param handlerDirs - 包含 handler 文件的目录路径列表（绝对路径或相对于 cwd）
   * @param serviceDirs - 包含 service 文件的目录路径列表（仅触发 import，不注册 handler）
   * @param mapping - 目标 CompositeHandlerMapping
   */
  async scan(
    handlerDirs: string[],
    serviceDirs: string[],
    mapping: CompositeHandlerMapping,
  ): Promise<void> {
    // 导入 service 目录（触发 @startup/@shutdown 副作用）
    for (const dir of serviceDirs) {
      await this._importDir(dir)
    }

    // 导入 handler 目录（触发 @Component/@OnCommand 等副作用）
    for (const dir of handlerDirs) {
      await this._importDir(dir)
    }

    // 注册所有已发现的组件
    this._registerComponents(mapping)
  }

  /** 返回已注册的 component 名称列表（快照）。 */
  getComponentNames(): string[] {
    return [...this._componentNames]
  }

  /** 将 componentRegistry 中的所有组件注册到 mapping。 */
  registerHandlers(mapping: CompositeHandlerMapping): void {
    this._registerComponents(mapping)
  }

  /** 递归导入目录下所有 .ts/.js 文件。 */
  private async _importDir(dir: string): Promise<void> {
    const absDir = resolve(dir)
    let entries: string[]
    try {
      entries = await readdir(absDir)
    } catch {
      log.warn(`目录未找到，跳过：${absDir}`)
      return
    }

    for (const entry of entries) {
      const fullPath = join(absDir, entry)
      if (entry.endsWith('.ts') || entry.endsWith('.js')) {
        try {
          await import(pathToFileURL(fullPath).href)
        } catch (err) {
          log.warn(`模块导入失败：${fullPath}，错误：${String(err)}`)
        }
      }
    }
  }

  /** 遍历 componentRegistry，实例化组件并注册处理器到 mapping。 */
  private _registerComponents(mapping: CompositeHandlerMapping): void {
    for (const [componentName, componentMeta] of componentRegistry) {
      // 避免重复注册
      if (this._componentNames.includes(componentName)) {
        continue
      }

      // 实例化组件
      const instance: object = new (componentMeta.target as new () => object)()
      const defaultPriority = componentMeta.defaultPriority

      let handlerCount = 0

      // 遍历原型方法，查找 handlerRegistry 中的条目
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>
      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (methodName === 'constructor') continue
        // 获取未绑定函数，用于读取装饰器元数据
        const fn = proto[methodName]
        if (typeof fn !== 'function') continue

        const handlerMetas = handlerRegistry.get(fn)
        if (!handlerMetas || handlerMetas.length === 0) continue

        for (const meta of handlerMetas) {
          const priority = meta.priority ?? defaultPriority

          const hm: HandlerMethod = {
            instance,
            method: fn,
            priority,
            componentName,
            meta,
          }
          mapping.register(hm)
          handlerCount++
        }
      }

      this._componentNames.push(componentName)
      log.info(`组件已注册：${componentName}，handler 数量：${String(handlerCount)}`)
    }
  }
}
