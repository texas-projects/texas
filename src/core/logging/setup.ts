/**
 * Pino 日志工厂 —— 支持 JSON（生产环境）或 pino-pretty（开发环境）格式输出。
 */

import pino from 'pino'
import type { Logger } from 'pino'
import pinoPretty from 'pino-pretty'

// ── 日志广播流写入器（Phase 6 接入）──

import { logBroadcaster } from './broadcast.js'

/** 广播写入器：将每条日志条目转发到 logBroadcaster。 */
const broadcastWritable = {
  write(msg: string): void {
    try {
      const entry = JSON.parse(msg) as Record<string, unknown>
      logBroadcaster.broadcast(entry)
    } catch {
      // 非 JSON 格式忽略
    }
  },
}

/**
 * 创建 Pino 日志实例。
 *
 * @param opts.level - 日志级别（'debug' | 'info' | 'warn' | 'error'）
 * @param opts.format - 输出格式（'json' 用于生产，'console' 用于开发）
 */
export function createLogger(opts: { level: string; format: 'json' | 'console' }): Logger {
  if (opts.format === 'console') {
    // stream 模式 + 显式 destination:process.stdout，确保通过 WriteConsoleW 输出
    // 避免 sonicBoom(fd=1) 使用 WriteFile + GBK 代码页导致中文乱码（Windows 特有问题）
    const prettyStream = pinoPretty({
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      // 若 child logger 携带 name 字段，控制台输出显示 [name] 前缀
      messageFormat: (log, messageKey) => {
        const name = log.name as string | undefined
        const msg = log[messageKey] as string
        return name ? `[${name}] ${msg}` : msg
      },
      ignore: 'pid,hostname,name',
      destination: process.stdout,
    })
    return pino({ level: opts.level }, prettyStream)
  }

  // JSON 模式：通过多目标写入同时输出到 stdout 和广播器
  return pino(
    { level: opts.level },
    pino.multistream([{ stream: process.stdout }, { stream: broadcastWritable }]),
  )
}

/** 模块级默认 logger（应用启动前的临时 logger）。 */
export let logger: Logger = pino({ level: 'info' })

/**
 * 替换模块级 logger。
 *
 * 应在 {@link createLogger} 创建正式 logger 后调用，
 * 使其他模块通过 `import { logger }` 获得最终配置的实例。
 */
export function setLogger(l: Logger): void {
  logger = l
}

/**
 * 创建具名子 logger，在结构化输出中绑定 name 字段。
 *
 * 控制台模式下自动显示 [name] 前缀；JSON 模式下输出 name 字段。
 *
 * @param name - 模块或类名，如 'scanner'、'RPCConsumer'
 */
export function getLogger(name: string): Logger {
  return logger.child({ name })
}

export type { Logger }
