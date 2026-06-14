/** @Inject 字段装饰器：声明依赖注入字段，编排器启动时自动赋值。 */

import { SERVICE_INJECTS, type InjectEntry } from './symbols.js'

/**
 * 声明依赖注入字段，编排器启动时自动从服务注册表中读取对应 key 并赋值。
 * @param serviceKey 服务注册表中的 key 名称
 */
export function Inject(serviceKey: string) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    const metadata = context.metadata
    if (!metadata) return
    const entries: InjectEntry[] = ((metadata[SERVICE_INJECTS] as InjectEntry[] | undefined) ??= [])
    entries.push({ propertyName: context.name, serviceKey })
  }
}
