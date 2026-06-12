/** BullMQ Job Result 类型契约 —— Worker 返回，主进程 QueueEvents 消费。 */

export interface BotApiCall {
  method: string
  args: unknown[]
}

export interface PostCacheOp {
  action: 'set' | 'del'
  key: string
  value?: string
  /** TTL（秒），仅 action=set 时有效。0 表示不过期。 */
  ttl?: number
}

export interface BotActionJobResult {
  type: 'bot-action'
  calls: BotApiCall[]
  /** Bot API 调用全部成功后执行的 cache 操作（可选）。 */
  postCacheOps?: PostCacheOp[]
}

export interface SelfContainedJobResult {
  type: 'self-contained'
  summary: Record<string, unknown>
}

export type JobResult = BotActionJobResult | SelfContainedJobResult | RenderSendJobResult

export function isBotActionResult(v: unknown): v is BotActionJobResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as Record<string, unknown>).type === 'bot-action'
  )
}

export function isSelfContainedResult(v: unknown): v is SelfContainedJobResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as Record<string, unknown>).type === 'self-contained'
  )
}

/** 渲染发图 job result —— processor 写图到 Redis temp key，主进程取图后调用 BotAPI。 */
export interface RenderSendJobResult {
  type: 'render-send'
  /** Redis temp key，存储渲染后的 base64 PNG，60s TTL。 */
  tempKey: string
  sendTo: { groupId: number } | { userId: number }
}

export function isRenderSendResult(v: unknown): v is RenderSendJobResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as Record<string, unknown>).type === 'render-send'
  )
}
