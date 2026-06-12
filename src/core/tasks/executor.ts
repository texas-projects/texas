/** TaskExecutor —— 监听 BullMQ QueueEvents，按 job result 执行 Bot API。 */

import { getLogger } from '@logger'
import { Job, Queue, QueueEvents } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'

import type { BotAPI } from '@/core/protocol/api.js'
import type { RedisStore } from '@/core/redis/store.js'
import { isBotActionResult, isSelfContainedResult } from '@/core/tasks/models.js'
import type { BotActionJobResult } from '@/core/tasks/models.js'
import type { ConnectionManager } from '@/core/ws/connection.js'

const log = getLogger('TaskExecutor')

/** 允许执行的 Bot API 方法白名单。 */
const ALLOWED_BOT_METHODS = new Set(['sendGroupSign', 'sendLike', 'sendMsg', 'sendGroupMsg'])

export class TaskExecutor {
  private readonly events: QueueEvents
  private readonly queue: Queue

  constructor(
    private readonly botApi: BotAPI,
    private readonly connMgr: ConnectionManager,
    private readonly cache: RedisStore,
    connection: ConnectionOptions,
    queueName: string,
    private readonly sendDelayMs = 500,
  ) {
    this.events = new QueueEvents(queueName, { connection })
    this.queue = new Queue(queueName, { connection })
  }

  /** 启动监听，订阅 QueueEvents 的 completed 事件。 */
  start(): void {
    this.events.on(
      'completed',
      ({ jobId, returnvalue }: { jobId: string; returnvalue: string }) => {
        void this._onCompleted(jobId, returnvalue)
      },
    )
    log.info('TaskExecutor 已启动')
  }

  /** 关闭 QueueEvents 连接。 */
  async close(): Promise<void> {
    await Promise.all([this.events.close(), this.queue.close()])
  }

  private async _onCompleted(jobId: string, returnvalue: string): Promise<void> {
    const job = await Job.fromId(this.queue, jobId)
    const jobName = job?.name ?? 'unknown'

    let result: unknown
    try {
      result = JSON.parse(returnvalue) as unknown
    } catch {
      log.error({ jobId, jobName }, 'job result 解析失败')
      return
    }

    if (isSelfContainedResult(result)) {
      log.info({ jobName, summary: result.summary }, '自闭环任务完成')
      return
    }

    if (isBotActionResult(result)) {
      await this._executeBotActions(result, jobName)
      return
    }

    log.warn({ jobName, result }, '未知的 job result 类型')
  }

  private async _executeBotActions(result: BotActionJobResult, jobName: string): Promise<void> {
    if (!this.connMgr.isConnected) {
      log.warn({ jobName }, 'WS 未连接，跳过 Bot API 调用')
      return
    }

    for (const call of result.calls) {
      if (!ALLOWED_BOT_METHODS.has(call.method)) {
        log.warn({ jobName, method: call.method }, 'Bot API 方法不在白名单，已拒绝')
        continue
      }

      try {
        const botApiRecord = this.botApi as unknown as Record<
          string,
          ((...args: unknown[]) => Promise<unknown>) | undefined
        >
        const fn = botApiRecord[call.method]
        // 已通过白名单检查，方法必然存在；若实现未提供该方法则跳过
        if (fn == null) continue
        await fn(...call.args)
      } catch (err) {
        log.error({ jobName, method: call.method, err }, 'Bot API 调用失败')
      }

      if (result.calls.length > 1) {
        await new Promise<void>((r) => setTimeout(r, this.sendDelayMs))
      }
    }

    // 执行声明式 post-cache 操作
    if (result.postCacheOps && result.postCacheOps.length > 0) {
      for (const op of result.postCacheOps) {
        try {
          if (op.action === 'set') {
            await this.cache.set(op.key, op.value ?? '1', op.ttl ?? 0)
          } else {
            await this.cache.del(op.key)
          }
        } catch (err) {
          log.error({ jobName, op, err }, 'postCacheOp 执行失败')
        }
      }
    }
  }
}
