/**
 * 每日打卡 BullMQ 处理器 —— 由 BullMQ Worker 触发，通过 Redis RPC 调用主进程执行打卡。
 */

import { getLogger } from '@logger'
import type { Job } from 'bullmq'

import { loadConfig } from '@/core/config.js'
import { getRpcBridge } from '@/core/rpc/bridge.js'

const log = getLogger('dailyCheckin')

/**
 * BullMQ 每日打卡任务处理器。
 *
 * 通过 RPCBridge 调用主进程注册的 request_checkin handler，
 * 返回打卡结果字典。
 */
export async function dailyCheckinProcessor(_job: Job): Promise<Record<string, unknown>> {
  const config = loadConfig()
  const bridge = getRpcBridge(config.PERSISTENT_REDIS_URL)

  const resp = await bridge.call('request_checkin', { source: 'scheduled' }, 10_000)

  if (resp.success) {
    log.info({ data: resp.data }, '每日打卡 RPC 调用成功')
    return resp.data ?? {}
  }

  log.error({ error: resp.error }, '每日打卡 RPC 调用失败')
  throw new Error(`打卡 RPC 失败: ${resp.error ?? 'unknown'}`)
}
