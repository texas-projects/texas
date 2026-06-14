/** Handler 装饰器元数据 Symbol key 定义。 */

/** 方法路由元数据数组 key */
export const HANDLER_METHODS = Symbol('handler:methods')

/** 类级别拦截器数组 key */
export const HANDLER_CLASS_INTERCEPTORS = Symbol('handler:class-interceptors')

/** SettingNode 列表 key */
export const HANDLER_SETTINGS = Symbol('handler:settings')

/** 方法元数据条目类型 */
export interface MethodMetaEntry {
  methodName: string | symbol
  mappingType:
    | 'command'
    | 'regex'
    | 'keyword'
    | 'startswith'
    | 'endswith'
    | 'fullmatch'
    | 'event_type'
  trigger: Record<string, unknown> // mappingType 对应的触发配置
  permission: number // Permission 枚举值，默认 0 (ANYONE)
  scope: string // MessageScope，默认 'all'
  priority: number | null // null 表示使用 Handler.defaultPriority
  interceptors: readonly InterceptorEntry[] // 方法级拦截器
}

/** 拦截器条目 */
export interface InterceptorEntry {
  interceptorClass: new (options?: unknown) => unknown
  options?: unknown
}

/** SettingNode 配置项选项 */
export interface SettingNodeOptions {
  readonly type: 'boolean' | 'number' | 'string' | 'enum'
  readonly default: unknown
  readonly description?: string
  readonly enumOptions?: Record<string, unknown>
  readonly scope?: 'global' | 'group'
  readonly category?: string
}

/** SettingNode 条目 */
export interface SettingNodeEntry {
  readonly key: string // 原始 key（不含前缀）
  readonly options: SettingNodeOptions
}
