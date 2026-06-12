/**
 * Handler 注册表 —— 统一管理类级元数据（HandlerMeta）与方法级元数据（MethodMeta[]）。
 *
 * 每个 handler 以唯一名称注册，包含类级元数据（HandlerMeta）和方法级元数据列表（MethodMeta[]）。
 */

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

/** 注册表中的完整条目。 */
export interface HandlerRegistryEntry {
  meta: HandlerMeta
  methods: MethodMeta[]
}

/** Handler 统一注册表。 */
export class HandlerRegistry {
  private readonly _entries = new Map<string, HandlerRegistryEntry>()

  /** 注册 handler，名称重复时抛出错误。 */
  register(name: string, entry: HandlerRegistryEntry): void {
    if (this._entries.has(name)) {
      throw new Error(`Handler "${name}" 已注册`)
    }
    this._entries.set(name, entry)
  }

  /** 按名称获取 handler 条目。 */
  get(name: string): HandlerRegistryEntry | undefined {
    return this._entries.get(name)
  }

  /** 判断是否已注册指定名称。 */
  has(name: string): boolean {
    return this._entries.has(name)
  }

  /** 迭代所有注册条目。 */
  values(): IterableIterator<HandlerRegistryEntry> {
    return this._entries.values()
  }

  /** 迭代所有 [name, entry] 键值对。 */
  entries(): IterableIterator<[string, HandlerRegistryEntry]> {
    return this._entries.entries()
  }

  /** 已注册的 handler 数量。 */
  get size(): number {
    return this._entries.size
  }

  /** 清空所有注册项（测试用）。 */
  clear(): void {
    this._entries.clear()
  }
}

/** 全局单例 Handler 注册表。 */
export const handlerRegistry = new HandlerRegistry()
