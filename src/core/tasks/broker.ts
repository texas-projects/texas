/** BullMQ 队列工厂与连接配置。 */

import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'

export { createBullMQConnection } from '@/core/redis/factory.js'

/** 唯一队列名称。 */
export const QUEUE_NAME = 'aemeath-tasks' as const

const _queueCache = new Map<string, Queue>()

export function createQueue(name: string, connection: ConnectionOptions): Queue {
  return new Queue(name, { connection })
}

/** 获取（或懒创建）任务队列单例。 */
export function getTaskQueue(connection: ConnectionOptions): Queue {
  const cached = _queueCache.get(QUEUE_NAME)
  if (cached !== undefined) return cached
  const queue = createQueue(QUEUE_NAME, connection)
  _queueCache.set(QUEUE_NAME, queue)
  return queue
}
