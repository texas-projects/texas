/** Service 装饰器元数据 Symbol key 定义。 */

/** @Inject 字段列表 key */
export const SERVICE_INJECTS = Symbol('service:injects')

/** @Provide 字段列表 key */
export const SERVICE_PROVIDES = Symbol('service:provides')

/** @Startup/@Shutdown 方法名 key */
export const SERVICE_LIFECYCLE = Symbol('service:lifecycle')

/** SettingNode 列表 key（Service 上使用时） */
export const SERVICE_SETTINGS = Symbol('service:settings')

/** Inject 条目 */
export interface InjectEntry {
  propertyName: string | symbol
  serviceKey: string
}

/** Provide 条目 */
export interface ProvideEntry {
  propertyName: string | symbol
  serviceKey: string
}

/** Lifecycle 元数据 */
export interface LifecycleEntry {
  startupMethod: string | symbol | null
  shutdownMethod: string | symbol | null
}
