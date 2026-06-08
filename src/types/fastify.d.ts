/**
 * Fastify 类型扩展 —— 为 FastifyInstance 添加服务注册表访问。
 */

import type { ServiceRegistry } from '@/core/registries/service-registry.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** 运行时服务注册表（由生命周期编排器挂载）。 */
    state?: {
      serviceRegistry?: ServiceRegistry
      [key: string]: unknown
    }
  }
}
