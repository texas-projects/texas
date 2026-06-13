/** render TaskDefinition —— 渲染模板并将图片写入 Redis temp key，由 TaskExecutor 取图发送。 */

import { createHash } from 'node:crypto'

import { getLogger } from '@logger'
import { UnrecoverableError } from 'bullmq'
import type { Client } from 'minio'

import { loadConfig } from '@/core/config.js'
import type { OssBuckets } from '@/core/oss/client.js'
import { downloadBuffer, uploadBuffer } from '@/core/oss/utils.js'
import type { RedisStore } from '@/core/redis/index.js'
import { cacheKeyRegistry } from '@/core/registries.js'
import type { RenderSendJobResult, TaskDefinition } from '@/core/tasks/index.js'
import { RenderService, TemplateNotFoundError, loadTemplates } from '@/renderer/index.js'

import '@/renderer/cache-keys.js'

const log = getLogger('tasks:render')

// Worker 模块级单例（顶层 await，文件被 import 时执行）
const renderService = new RenderService()
await renderService.initialize()
await loadTemplates()

function computeHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32)
}

export const taskDefinition: TaskDefinition = {
  jobName: 'render',
  requires: ['cache', 'oss'],
  concurrency: 2,

  processor: async (job, deps) => {
    const { cache } = deps as { cache: RedisStore }
    const { client: ossClient, buckets } = deps.oss as { client: Client; buckets: OssBuckets }
    const renderBucket = buckets.render

    const { template, data, sendTo, width, height, skipCache, cacheTtl } = job.data as {
      template: string
      data: unknown
      sendTo: { groupId: number } | { userId: number }
      width?: number
      height?: number
      skipCache?: boolean
      cacheTtl?: number
    }

    // 1. 缓存命中检查：Redis 存的是 S3 key 字符串
    let pngBuffer: Buffer | null = null
    let resultCacheKey: string | null = null
    let hash: string | null = null

    if (!skipCache) {
      hash = computeHash({ template, data, width, height })
      resultCacheKey = cacheKeyRegistry.buildKey('render', 'result', hash)
      const cachedS3Key = await cache.get<string>(resultCacheKey)
      if (cachedS3Key !== null) {
        try {
          pngBuffer = await downloadBuffer(ossClient, renderBucket, cachedS3Key)
          log.debug({ template, hash }, '渲染缓存命中')
        } catch {
          // S3 对象不存在（被 lifecycle rule 删除）→ 降级重新渲染
          log.debug({ hash, s3Key: cachedS3Key }, '缓存 S3 对象不存在，重新渲染')
          pngBuffer = null
        }
      }
    }

    // 2. 缓存未命中，执行渲染
    if (pngBuffer === null) {
      try {
        pngBuffer = await renderService.render(template, data, { width, height })
      } catch (err) {
        if (err instanceof TemplateNotFoundError) {
          throw new UnrecoverableError(`模板 "${template}" 不存在，不可重试`)
        }
        throw err
      }

      // 3. 写渲染结果缓存：上传 S3 + Redis 存 key
      if (!skipCache && resultCacheKey && hash) {
        try {
          const s3Key = `render/${hash}.png`
          await uploadBuffer(ossClient, renderBucket, s3Key, pngBuffer)
          const ttl = cacheTtl ?? loadConfig().RENDER_CACHE_TTL
          await cache.set(resultCacheKey, s3Key, ttl)
        } catch (err) {
          log.warn({ template, err }, '渲染结果缓存写入失败，跳过')
        }
      }
    }

    // 4. 写短 TTL temp key（60s，供 TaskExecutor 取图）
    const jobId = job.id ?? 'unknown'
    const tempKey = cacheKeyRegistry.buildKey('render', 'temp', jobId)
    await cache.set(tempKey, pngBuffer.toString('base64'), 60)

    // 5. 返回 RenderSendJobResult（不含图片数据，避免 BullMQ Redis 内存积压）
    return { type: 'render-send', tempKey, sendTo } satisfies RenderSendJobResult
  },
}
