// src/core/personnel/cache-keys.ts
/** personnel 领域 cache key 自注册。 */
import { cacheKeyRegistry } from '@/core/registries.js'

cacheKeyRegistry.register({
  namespace: 'personnel',
  name: 'sync_status',
  build: () => 'aemeath:personnel:sync_status',
})

cacheKeyRegistry.register({
  namespace: 'personnel',
  name: 'sync_lock',
  build: () => 'aemeath:lock:personnel_sync',
})

cacheKeyRegistry.register({
  namespace: 'personnel',
  name: 'relation',
  build: (qq) => `aemeath:personnel:user:${qq}:relation`,
})

cacheKeyRegistry.register({
  namespace: 'personnel',
  name: 'admins',
  build: () => 'aemeath:personnel:admins',
})

/** 人员关系缓存 glob 模式。 */
export const USER_RELATION_GLOB = 'aemeath:personnel:user:*:relation'
