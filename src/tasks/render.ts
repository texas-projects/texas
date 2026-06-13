/** render TaskDefinition —— 渲染模板并将图片写入 Redis temp key，由 TaskExecutor 取图发送。 */

import { createHash } from 'node:crypto'

import { getLogger } from '@logger'
import { compress, decompress } from '@mongodb-js/zstd'
import { UnrecoverableError } from 'bullmq'

import { loadConfig } from '@/core/config.js'
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
  requires: ['cache'],
  concurrency: 2,

  processor: async (job, deps) => {
    const { cache } = deps as { cache: RedisStore }
    const { template, data, sendTo, width, height, skipCache, cacheTtl } = job.data as {
      template: string
      data: unknown
      sendTo: { groupId: number } | { userId: number }
      width?: number
      height?: number
      skipCache?: boolean
      cacheTtl?: number
    }

    // 1. 缓存命中检查
    let pngBuffer: Buffer | null = null
    let resultCacheKey: string | null = null

    if (!skipCache) {
      const hash = computeHash({ template, data, width, height })
      resultCacheKey = cacheKeyRegistry.buildKey('render', 'result', hash)
      const cached = await cache.get<string>(resultCacheKey)
      if (cached !== null) {
        try {
          pngBuffer = Buffer.from(await decompress(Buffer.from(cached, 'base64')))
          log.debug({ template, hash }, '渲染缓存命中')
        } catch (err) {
          log.warn({ hash, err }, '渲染缓存解压失败，重新渲染')
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

      // 3. Size guard + 写渲染结果缓存
      if (
        !skipCache &&
        resultCacheKey &&
        pngBuffer.byteLength <= loadConfig().RENDER_CACHE_MAX_BYTES
      ) {
        try {
          const compressed = await compress(pngBuffer)
          const ttl = cacheTtl ?? loadConfig().RENDER_CACHE_TTL
          await cache.set(resultCacheKey, compressed.toString('base64'), ttl)
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
