/** @Provide 字段装饰器：声明额外暴露的服务 key，startup 完成后读取字段值注册到服务注册表。 */

import { SERVICE_PROVIDES, type ProvideEntry } from './symbols.js'

/**
 * 声明额外暴露的服务 key，编排器在 startup 完成后从字段读取实例并注册。
 * @param serviceKey 暴露到服务注册表的 key 名称
 */
export function Provide(serviceKey: string) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    const metadata = context.metadata
    if (!metadata) return
    const entries: ProvideEntry[] = ((metadata[SERVICE_PROVIDES] as ProvideEntry[] | undefined) ??=
      [])
    entries.push({ propertyName: context.name, serviceKey })
  }
}
