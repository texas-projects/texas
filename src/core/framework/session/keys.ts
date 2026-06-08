/**
 * 交互式会话模块的 Redis 缓存键。
 *
 * 注：key-registry.ts 已定义 sessionMetaKey / sessionDataKey，
 * 此文件提供模块内统一访问入口，避免在各处直接引用 key-registry.ts。
 */

export { sessionMetaKey as sessionKey, sessionDataKey } from '@/core/cache/key-registry.js'
