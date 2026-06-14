/** @Startup / @Shutdown 方法装饰器，标记服务的启动和关闭方法。 */

import { SERVICE_LIFECYCLE } from './symbols.js'
import type { LifecycleEntry } from './symbols.js'

/** 标记服务启动方法。每个类最多一个。 */
export function Startup(
  _target: (...args: unknown[]) => unknown,
  context: ClassMethodDecoratorContext,
) {
  const metadata = context.metadata
  if (!metadata) return
  const entry: LifecycleEntry = ((metadata[SERVICE_LIFECYCLE] as LifecycleEntry | undefined) ??= {
    startupMethod: null,
    shutdownMethod: null,
  })
  if (entry.startupMethod !== null) {
    throw new Error(`@Startup 只能标记一个方法，已标记: ${String(entry.startupMethod)}`)
  }
  entry.startupMethod = context.name
}

/** 标记服务关闭方法。每个类最多一个。 */
export function Shutdown(
  _target: (...args: unknown[]) => unknown,
  context: ClassMethodDecoratorContext,
) {
  const metadata = context.metadata
  if (!metadata) return
  const entry: LifecycleEntry = ((metadata[SERVICE_LIFECYCLE] as LifecycleEntry | undefined) ??= {
    startupMethod: null,
    shutdownMethod: null,
  })
  if (entry.shutdownMethod !== null) {
    throw new Error(`@Shutdown 只能标记一个方法，已标记: ${String(entry.shutdownMethod)}`)
  }
  entry.shutdownMethod = context.name
}
