export { LifecycleOrchestrator } from './orchestrator.js'
export { ServiceRegistry } from './service-registry.js'
// TC39 装饰器导出（@Service、@Inject、@Provide、@Startup、@Shutdown）
export {
  Inject,
  Provide,
  Startup,
  Shutdown,
  Service,
  serviceEntryRegistry,
} from './decorators/index.js'
export type {
  ServiceOptions,
  InjectEntry,
  ProvideEntry,
  LifecycleEntry,
} from './decorators/index.js'
export type { ServiceEntry } from './service-entry.js'
