/**
 * 注册表统一入口。
 * 所有领域级注册表在此汇聚，便于发现和集中访问。
 */
export { handlerRegistry } from './dispatch/registry.js'
export { metricRegistry } from './monitoring/registry.js'
export { cacheKeyRegistry } from './redis/registry.js'
export { ServiceRegistry } from './lifecycle/service-registry.js'
