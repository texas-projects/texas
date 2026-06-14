/** @SettingNode 装饰器：声明 Handler 或 Service 上的可配置项。 */

import { SERVICE_SETTINGS } from '../../lifecycle/decorators/symbols.js'

import { HANDLER_SETTINGS, type SettingNodeEntry, type SettingNodeOptions } from './symbols.js'

export type { SettingNodeOptions }

/**
 * 声明可配置项。可叠加多个。
 * key 为原始 key（不含前缀），前缀由 @Handler/@Service 在注册阶段拼接。
 */
export function SettingNode(key: string, options: SettingNodeOptions) {
  return function (_target: unknown, context: ClassDecoratorContext) {
    const metadata = context.metadata
    if (!metadata) return

    const entry: SettingNodeEntry = { key, options }

    // 写入 HANDLER_SETTINGS（@Handler 会读取）
    const handlerSettings: SettingNodeEntry[] = ((metadata[HANDLER_SETTINGS] as
      | SettingNodeEntry[]
      | undefined) ??= [])
    handlerSettings.push(entry)

    // 同时写入 SERVICE_SETTINGS（@Service 会读取）
    const serviceSettings: SettingNodeEntry[] = ((metadata[SERVICE_SETTINGS] as
      | SettingNodeEntry[]
      | undefined) ??= [])
    serviceSettings.push(entry)
  }
}
