// src/services/checkin-cache-keys.ts
/** 签到领域 cache key 自注册。 */
import { cacheKeyRegistry } from '@/core/registries.js'

cacheKeyRegistry.register({
  namespace: 'checkin',
  name: 'daily',
  build: (groupId, dateStr) => `aemeath:checkin:${groupId}:${dateStr}`,
})

cacheKeyRegistry.register({
  namespace: 'checkin',
  name: 'stats',
  build: (groupId, userId) => `aemeath:checkin:stats:${groupId}:${userId}`,
})
