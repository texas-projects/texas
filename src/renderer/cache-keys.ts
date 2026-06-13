/** render 命名空间 cache key 自注册。 */

import { cacheKeyRegistry } from '@/core/registries.js'

cacheKeyRegistry.register({
  namespace: 'render',
  name: 'result',
  build: (hash: string) => `aemeath:render:result:${hash}`,
  description: 'S3 key of cached render result',
})

cacheKeyRegistry.register({
  namespace: 'render',
  name: 'temp',
  build: (jobId: string) => `aemeath:render:temp:${jobId}`,
  description: '渲染结果短 TTL 临时 key，供 TaskExecutor 取图发送',
})
