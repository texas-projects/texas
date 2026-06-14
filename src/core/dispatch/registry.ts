/**
 * Handler 注册表 —— 统一管理类级元数据（HandlerMeta）与方法级元数据（MethodMeta[]）。
 *
 * 每个 handler 以唯一名称注册，包含类级元数据（HandlerMeta）和方法级元数据列表（MethodMeta[]）。
 * 同时支持 TC39 Stage 3 装饰器收集的 HandlerRegistryData 格式注册。
 */

import type { InjectEntry } from '../lifecycle/decorators/symbols.js'

import type { MethodMetaEntry, InterceptorEntry, SettingNodeEntry } from './decorators/symbols.js'

/** @Handler 类装饰器选项。 */
export interface HandlerOptions {
  name: string
  displayName?: string
  description?: string
  tags?: string[]
  defaultPriority?: number
  system?: boolean
}

/** Handler 注册表条目（TC39 Stage 3 装饰器新格式，含注入信息，用于实例化和依赖注入）。 */
export interface HandlerRegistryData {
  options: HandlerOptions
  handlerClass: new () => unknown
  methods: MethodMetaEntry[]
  classInterceptors: InterceptorEntry[]
  settingNodes: SettingNodeEntry[]
  injects: InjectEntry[]
}

/** 类级元数据（原 ComponentMeta）。 */
export interface HandlerMeta {
  name: string
  displayName: string
  description: string
  tags: string[]
  defaultPriority: number
  system: boolean
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  target: Function
}

/** 方法级元数据（原 decorators.ts 中的 HandlerMeta）。 */
export interface MethodMeta {
  mappingType:
    | 'command'
    | 'regex'
    | 'keyword'
    | 'startswith'
    | 'endswith'
    | 'fullmatch'
    | 'event_type'
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  method: Function
  permission: number
  messageScope: string
  priority: number | null
  displayName: string
  description: string
  [key: string]: unknown
}

/** 注册表中的旧格式完整条目（兼容保留）。 */
export interface HandlerRegistryEntry {
  meta: HandlerMeta
  methods: MethodMeta[]
}

/** Handler 统一注册表。 */
export class HandlerRegistry {
  private readonly _entries = new Map<string, HandlerRegistryEntry>()
  /** TC39 Stage 3 装饰器格式条目（新格式）。 */
  private readonly _decoratorEntries = new Map<string, HandlerRegistryData>()
  /** 已实例化的 handler 实例（由 instantiateAll 填充）。 */
  private readonly _instances = new Map<string, unknown>()

  /**
   * 注册 handler（旧格式），名称重复时抛出错误。
   * @deprecated 请改用 register(data: HandlerRegistryData)
   */
  register(name: string, entry: HandlerRegistryEntry): void
  /** 注册 handler（TC39 Stage 3 装饰器新格式），名称重复时覆盖。 */
  register(data: HandlerRegistryData): void
  register(nameOrData: string | HandlerRegistryData, entry?: HandlerRegistryEntry): void {
    if (typeof nameOrData === 'string') {
      // 旧格式：register(name, entry)
      if (this._entries.has(nameOrData)) {
        throw new Error(`Handler "${nameOrData}" 已注册`)
      }
      if (!entry) throw new Error(`register(name) 必须提供 entry 参数`)
      this._entries.set(nameOrData, entry)
    } else {
      // 新格式：register(data)
      const name = nameOrData.options.name
      this._decoratorEntries.set(name, nameOrData)
    }
  }

  /**
   * 获取旧格式 handler 条目（兼容已有代码）。
   * @param name handler 名称
   */
  get(name: string): HandlerRegistryEntry | undefined {
    return this._entries.get(name)
  }

  /**
   * 获取 TC39 装饰器格式的 handler 注册数据（新格式）。
   * @param name handler 名称
   */
  getDecoratorEntry(name: string): HandlerRegistryData | undefined {
    return this._decoratorEntries.get(name)
  }

  /**
   * 获取旧格式 handler 条目。
   * @param name handler 名称
   */
  getLegacy(name: string): HandlerRegistryEntry | undefined {
    return this._entries.get(name)
  }

  /** 注销 TC39 装饰器格式的 handler（测试用）。 */
  unregister(name: string): void {
    this._decoratorEntries.delete(name)
  }

  /** 判断是否已注册指定名称（旧格式）。 */
  has(name: string): boolean {
    return this._entries.has(name) || this._decoratorEntries.has(name)
  }

  /** 迭代所有旧格式注册条目（兼容保留）。 */
  values(): IterableIterator<HandlerRegistryEntry> {
    return this._entries.values()
  }

  /** 迭代所有新格式（TC39 装饰器）注册数据。 */
  decoratorValues(): IterableIterator<HandlerRegistryData> {
    return this._decoratorEntries.values()
  }

  /** 迭代所有旧格式 [name, entry] 键值对。 */
  entries(): IterableIterator<[string, HandlerRegistryEntry]> {
    return this._entries.entries()
  }

  /** 已注册的 handler 数量（旧格式）。 */
  get size(): number {
    return this._entries.size
  }

  /**
   * 启动阶段：实例化所有新格式 handler 并注入依赖。
   * @param services - 已初始化的服务实例映射（key 为 Startup 注册的服务键名）
   */
  instantiateAll(services: Record<string, unknown>): void {
    for (const [name, data] of this._decoratorEntries) {
      const instance = new data.handlerClass()
      for (const inject of data.injects) {
        ;(instance as Record<string | symbol, unknown>)[inject.propertyName] =
          services[inject.serviceKey]
      }
      this._instances.set(name, instance)
    }
  }

  /**
   * 获取已实例化的 handler 实例（需先调用 instantiateAll）。
   * @param name handler 名称
   */
  getInstance(name: string): unknown {
    return this._instances.get(name)
  }

  /** 清空所有注册项（测试用）。 */
  clear(): void {
    this._entries.clear()
    this._decoratorEntries.clear()
    this._instances.clear()
  }
}

/** 全局单例 Handler 注册表。 */
export const handlerRegistry = new HandlerRegistry()
