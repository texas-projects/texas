/** 生命周期装饰器 barrel 导出。 */

export { Inject } from './inject.js'
export { Provide } from './provide.js'
export { Startup, Shutdown } from './lifecycle.js'
export { Service, serviceEntryRegistry, type ServiceOptions } from './service.js'
export {
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_LIFECYCLE,
  SERVICE_SETTINGS,
  type InjectEntry,
  type ProvideEntry,
  type LifecycleEntry,
} from './symbols.js'
