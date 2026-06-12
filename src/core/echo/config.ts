// src/core/echo/config.ts
/** Echo 配置定义与工具函数。 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type EchoType = 'handler' | 'service' | 'task' | 'route'

export type EchoDirConfig = string[] | { dirs: string[]; exclude?: string[] }

/** 应用级静态常量配置。 */
export interface AppConfig {
  /** Redis cache key 命名空间前缀。 */
  readonly cacheKeyPrefix: string
  /** BullMQ 主任务队列名。 */
  readonly queueName: string
  /** Worker 心跳 Redis key 前缀。 */
  readonly heartbeatKeyPrefix: string
  /** 命令触发前缀。 */
  readonly commandPrefix: string
  /** 定时任务默认时区。 */
  readonly defaultTimezone: string
  /** 交互式会话默认超时（秒）。 */
  readonly sessionTimeout: number
}

export interface EchoConfig {
  app?: AppConfig
  echoes: Record<EchoType, EchoDirConfig>
}

export interface NormalizedEchoDirConfig {
  dirs: string[]
  exclude: string[]
}

export function defineConfig(config: EchoConfig): EchoConfig {
  return config
}

export function normalizeEchoDirConfig(config: EchoDirConfig): NormalizedEchoDirConfig {
  if (Array.isArray(config)) {
    return { dirs: config, exclude: [] }
  }
  return { dirs: config.dirs, exclude: config.exclude ?? [] }
}

export async function loadEchoConfig(baseDir?: string): Promise<EchoConfig> {
  const root = baseDir ?? resolve(import.meta.dirname, '..', '..', '..')
  const configPath = resolve(root, 'aemeath.config.ts')
  const configUrl = pathToFileURL(configPath).href
  try {
    const mod = (await import(configUrl)) as { default: EchoConfig }
    return mod.default
  } catch (err) {
    throw new Error(`无法加载 Echo 配置文件 ${configPath}`, { cause: err })
  }
}
