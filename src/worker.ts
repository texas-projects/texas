/**
 * Texas BullMQ Worker 进程入口 —— 消费队列任务，通过 RPC 调用主进程业务服务。
 *
 * 启动方式：
 *   node dist/worker.js
 *   pnpm worker
 */

import { Worker } from 'bullmq'

import { loadConfig } from './core/config.js'
import { createLogger, setLogger, logger } from './core/logging/setup.js'
import { createBullMQConnection, QUEUE_NAMES } from './core/tasks/broker.js'
import { dailyCheckinProcessor } from './tasks/daily-checkin.js'
import { dailyLikeProcessor } from './tasks/daily-like.js'

// ── 初始化 ──

const config = loadConfig()

// Worker 进程独立初始化 logger
setLogger(createLogger({ level: config.LOG_LEVEL, format: config.LOG_FORMAT }))
const log = logger.child({ name: 'worker' })

const connection = createBullMQConnection(config.BULLMQ_REDIS_URL)

log.info('Texas Worker 正在启动...')

// ── 创建 Worker 实例 ──

const workers = [
  new Worker(QUEUE_NAMES.DAILY_CHECKIN, dailyCheckinProcessor, {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUE_NAMES.DAILY_LIKE, dailyLikeProcessor, {
    connection,
    concurrency: 1,
  }),
]

// ── 错误处理 ──

for (const worker of workers) {
  worker.on('completed', (job) => {
    log.info(`任务完成: queue=${worker.name} job=${job.id ?? ''}`)
  })

  worker.on('failed', (job, err) => {
    log.error({ err }, `任务失败: queue=${worker.name} job=${job?.id ?? ''}`)
  })

  worker.on('error', (err) => {
    log.error({ err }, `Worker 错误: queue=${worker.name}`)
  })
}

log.info(`Texas Worker 已启动，监听队列: ${workers.map((w) => w.name).join(', ')}`)

// ── 优雅关闭 ──

async function shutdown(): Promise<void> {
  log.info('收到停止信号，正在优雅关闭...')
  await Promise.all(workers.map((w) => w.close()))
  log.info('Texas Worker 已停止')
  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown()
})

process.on('SIGINT', () => {
  void shutdown()
})
