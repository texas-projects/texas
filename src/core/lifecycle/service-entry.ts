import type { SettingNodeEntry } from '../dispatch/decorators/symbols.js'

import type { InjectEntry, ProvideEntry } from './decorators/symbols.js'

/** 编排器使用的服务注册条目。 */
export interface ServiceEntry {
  name: string // 服务标识，自动以此 key 注册实例自身
  serviceClass: new (...args: unknown[]) => unknown
  injects: readonly InjectEntry[]
  provides: readonly ProvideEntry[] // 额外暴露的 key（不含自身，自身通过 name 自动注册）
  startupMethod: string | symbol | null
  shutdownMethod: string | symbol | null
  settingNodes: readonly SettingNodeEntry[]
}
