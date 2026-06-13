/**
 * Pino 日志工厂 —— 支持 JSON（生产环境）或 pino-pretty（开发环境）格式输出。
 */

import pino from 'pino'
import type { Logger } from 'pino'
import pinoPretty from 'pino-pretty'

// ── 日志广播流写入器 ──

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

// ── 延迟绑定子 logger ──
// 解决模块加载时序问题：顶层 getLogger() 可能在 setLogger() 之前执行，
// 代理确保始终委托给当前 logger，而非绑定到初始临时实例。

const proxyCache = new Map<string, Logger>()
const childCache = new Map<string, { parent: Logger; child: Logger }>()

function resolveChild(name: string): Logger {
  let entry = childCache.get(name)
  if (entry?.parent !== logger) {
    entry = { parent: logger, child: logger.child({ name }) }
    childCache.set(name, entry)
  }
  return entry.child
}

/**
 * 创建具名子 logger，在结构化输出中绑定 name 字段。
 *
 * 控制台模式下自动显示 [name] 前缀；JSON 模式下输出 name 字段。
 * 返回代理对象，setLogger() 后自动切换到新 parent。
 *
 * @param name - 模块或类名，如 'scanner'、'RPCConsumer'
 */
export function getLogger(name: string): Logger {
  const cached = proxyCache.get(name)
  if (cached !== undefined) return cached

  const proxy = new Proxy({} as Logger, {
    get(_target, prop, receiver) {
      const real = resolveChild(name)
      const val: unknown = Reflect.get(real, prop, receiver)
      return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(real) : val
    },
  })

  proxyCache.set(name, proxy)
  return proxy
}

export type { Logger }

export { LogBroadcaster, logBroadcaster } from './broadcast.js'
