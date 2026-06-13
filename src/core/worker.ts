/**
 * Aemeath BullMQ Worker 进程入口 —— 通过 EchoLoader 动态发现任务，按 job.name 路由。
 *
 * 启动方式：
 *   node dist/core/worker.js
 *   pnpm worker
 */

import { resolve } from 'node:path'

import { createLogger, setLogger, logger } from '@logger'
import { Worker } from 'bullmq'

import { loadConfig } from './config.js'
import { createMainDb, createChatDb } from './db.js'
import { loadEchoConfig } from './echo/config.js'
import { EchoLoader } from './echo/loader.js'
import type { TaskEchoEntry } from './echo/loader.js'
import { createOssClient } from './oss/client.js'
import type { OssBuckets } from './oss/client.js'
import { createRedis, createBullMQConnection } from './redis/factory.js'
import { RedisStore } from './redis/store.js'
import { WorkerHeartbeatMiddleware } from './tasks/middleware.js'
import type { TaskDefinition, MinimalSettingSchema } from './tasks/types.js'

// ── 初始化 ──

const config = loadConfig()

// Worker 进程独立初始化 logger
setLogger(createLogger({ level: config.LOG_LEVEL, format: config.LOG_FORMAT }))
const log = logger.child({ name: 'worker' })

// ── 主函数 ──

async function main(): Promise<void> {
  // ── 基础设施初始化 ──

  const bullConn = createBullMQConnection(config.BULLMQ_REDIS_URL)
  const db = createMainDb(config.DATABASE_URL)
  const chatDb = createChatDb(config.CHAT_DATABASE_URL)
  const cacheRedis = createRedis(config.CACHE_REDIS_URL)
  const cacheStore = new RedisStore(cacheRedis, config.CACHE_DEFAULT_TTL)

  const ossClient = createOssClient({
    endpointUrl: config.S3_ENDPOINT_URL,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    region: config.S3_REGION,
  })
  const ossBuckets: OssBuckets = {
    archive: config.S3_ARCHIVE_BUCKET,
    media: config.S3_MEDIA_BUCKET,
    render: config.S3_RENDER_BUCKET,
  }

  const infraDeps: Record<string, unknown> = {
    db,
    chat_db: chatDb,
    cache: cacheStore,
    oss: { client: ossClient, buckets: ossBuckets },
  }

  // ── EchoLoader 动态发现任务 ──

  const echoConfig = await loadEchoConfig()
  const baseDir = resolve(import.meta.dirname, '..', '..')
  const loader = new EchoLoader(echoConfig, baseDir)
  const taskEntries = await loader.discoverByType('task')

  // ── 从 echoConfig 读取队列名 ──
  const queueName = echoConfig.app?.queueName ?? 'aemeath-tasks'

  // ── 心跳中间件 ──

  const heartbeatKeyPrefix = echoConfig.app?.heartbeatKeyPrefix ?? 'aemeath:worker:heartbeat'
  const heartbeat = new WorkerHeartbeatMiddleware(
    cacheRedis,
    'worker-main',
    heartbeatKeyPrefix,
    config.WORKER_HEARTBEAT_TTL_MS,
  )

  // ── 构建路由表 + 聚合 schemaMap ──

  const processorMap = new Map<string, TaskDefinition>()
  const schemaMap = new Map<string, MinimalSettingSchema>()

  for (const entry of taskEntries) {
    const { taskDefinition: def } = entry as TaskEchoEntry
    processorMap.set(def.jobName, def)
    if (def.settings) {
      for (const [k, v] of Object.entries(def.settings)) {
        schemaMap.set(k, v)
      }
    }
  }

  infraDeps.schemaMap = schemaMap

  log.info({ tasks: [...processorMap.keys()] }, 'Aemeath Worker 正在启动...')

  // ── 单 Worker 实例，按 job.name 路由 ──

  const worker = new Worker(
    queueName,
    async (job) => {
      const def = processorMap.get(job.name)
      if (!def) throw new Error(`未知的 job name: ${job.name}`)

      const deps: Record<string, unknown> = Object.fromEntries(
        (def.requires ?? []).map((key) => [key, infraDeps[key]]),
      )
      // schemaMap 始终传入
      deps.schemaMap = infraDeps.schemaMap

      return def.processor(job, deps)
    },
    { connection: bullConn, concurrency: config.WORKER_CONCURRENCY },
  )

  // ── 事件处理 ──

  worker.on('completed', (job) => {
    log.info(`任务完成: job=${job.id ?? ''} name=${job.name}`)
    void heartbeat.recordHeartbeat(queueName)
  })

  worker.on('failed', (job, err) => {
    log.error({ err }, `任务失败: job=${job?.id ?? ''} name=${job?.name ?? ''}`)
    void heartbeat.recordHeartbeat(queueName)
  })

  worker.on('error', (err) => {
    log.error({ err }, 'Worker 错误')
  })

  log.info(`Aemeath Worker 已启动，监听队列: ${queueName}`)

  // ── 优雅关闭 ──

  async function shutdown(): Promise<void> {
    log.info('收到停止信号，正在优雅关闭...')
    await worker.close()
    await db.$disconnect()
    await chatDb.$disconnect()
    await cacheRedis.quit()
    log.info('Aemeath Worker 已停止')
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })

  process.on('SIGINT', () => {
    void shutdown()
  })
}

main().catch((err: unknown) => {
  console.error('Worker 启动失败:', err)
  process.exit(1)
})
