/** enqueueRender —— 向 BullMQ 队列投递渲染发图任务的通用入口函数。 */

import type { Queue } from 'bullmq'

export type RenderTarget = { groupId: number; userId?: never } | { userId: number; groupId?: never }

export interface EnqueueRenderOptions {
  template: string
  data: unknown
  sendTo: RenderTarget
  width?: number
  height?: number
  /** 跳过缓存读写，适用于高度个性化的动态渲染。 */
  skipCache?: boolean
  /** 覆盖全局 RENDER_CACHE_TTL（秒）。 */
  cacheTtl?: number
}

/**
 * 将渲染任务投入 BullMQ 队列，fire-and-forget。
 * @returns BullMQ job id，可用于追踪（通常可忽略）。
 */
export async function enqueueRender(queue: Queue, opts: EnqueueRenderOptions): Promise<string> {
  const job = await queue.add('render', opts)
  if (job.id == null) throw new Error('BullMQ 未返回 job id')
  return job.id
}
