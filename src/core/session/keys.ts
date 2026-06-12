/**
 * 交互式会话模块的 Redis 缓存键。
 *
 * 通过 cacheKeyRegistry 构建 session 命名空间的缓存键。
 */

import { cacheKeyRegistry } from '@/core/redis/registry.js'

export const sessionKey = (key: string): string => cacheKeyRegistry.buildKey('session', 'meta', key)
export const sessionDataKey = (key: string): string =>
  cacheKeyRegistry.buildKey('session', 'data', key)
