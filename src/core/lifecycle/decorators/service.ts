/** @Service 类装饰器：将类注册为可被编排器管理的服务。 */

import type { SettingNodeEntry } from '../../dispatch/decorators/symbols.js'
import type { ServiceEntry } from '../service-entry.js'

import {
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_LIFECYCLE,
  SERVICE_SETTINGS,
  type InjectEntry,
  type ProvideEntry,
  type LifecycleEntry,
} from './symbols.js'

/** 全局服务注册表，由 @Service 装饰器在 import 副作用阶段写入。 */
export const serviceEntryRegistry = new Map<string, ServiceEntry>()

export interface ServiceOptions {
  name: string
}

/** 声明一个可被编排器管理的服务类。 */
export function Service(opts: ServiceOptions) {
  return function (target: new (...args: unknown[]) => unknown, context: ClassDecoratorContext) {
    const metadata = context.metadata
    if (!metadata) throw new Error(`@Service: Symbol.metadata 不可用`)

    const injects = (
      Object.hasOwn(metadata, SERVICE_INJECTS) ? metadata[SERVICE_INJECTS] : []
    ) as InjectEntry[]

    const provides = (
      Object.hasOwn(metadata, SERVICE_PROVIDES) ? metadata[SERVICE_PROVIDES] : []
    ) as ProvideEntry[]

    const lifecycle = (
      Object.hasOwn(metadata, SERVICE_LIFECYCLE)
        ? metadata[SERVICE_LIFECYCLE]
        : { startupMethod: null, shutdownMethod: null }
    ) as LifecycleEntry

    const settingNodes = (
      Object.hasOwn(metadata, SERVICE_SETTINGS) ? metadata[SERVICE_SETTINGS] : []
    ) as SettingNodeEntry[]

    const entry: ServiceEntry = {
      name: opts.name,
      serviceClass: target,
      injects,
      provides,
      startupMethod: lifecycle.startupMethod,
      shutdownMethod: lifecycle.shutdownMethod,
      settingNodes: settingNodes.map((node) => ({
        ...node,
        key: `${opts.name}.${node.key}`,
      })),
    }

    if (serviceEntryRegistry.has(opts.name)) {
      throw new Error(`@Service 名称冲突: "${opts.name}" 已注册`)
    }
    serviceEntryRegistry.set(opts.name, entry)
  }
}
