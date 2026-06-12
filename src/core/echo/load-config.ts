// src/core/echo/load-config.ts
/** 加载 aemeath.config.ts 配置。 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { EchoConfig } from './config.js'

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
