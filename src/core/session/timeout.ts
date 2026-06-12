/**
 * 会话超时配置。
 */

import { TimeoutMode } from './enums.js'

/** 会话超时配置。 */
export interface TimeoutConfig {
  /** 超时秒数，NEVER 模式下忽略，必须 > 0。 */
  duration: number
  /** 超时策略。 */
  mode: TimeoutMode
  /** NOTIFY 模式下提前多少秒提醒，必须 < duration。 */
  warningBefore: number
  /** 超时时发送的消息。 */
  timeoutMessage: string
  /** 超时前提醒消息，支持 {remaining} 占位符。 */
  warningMessage: string
}

/** 创建默认超时配置。 */
export function makeTimeoutConfig(overrides?: Partial<TimeoutConfig>): TimeoutConfig {
  return {
    duration: 300,
    mode: TimeoutMode.SILENT,
    warningBefore: 30,
    timeoutMessage: '操作已超时，会话已结束。',
    warningMessage: '操作即将超时，请在 {remaining} 秒内继续。',
    ...overrides,
  }
}

/** 将 number 或 TimeoutConfig 统一为 TimeoutConfig。 */
export function resolveTimeout(raw: TimeoutConfig | number): TimeoutConfig {
  if (typeof raw === 'number') {
    return makeTimeoutConfig({ duration: raw })
  }
  return raw
}
