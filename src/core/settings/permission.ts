/**
 * Settings 权限检查器 —— 替代 FeaturePermissionChecker，基于 SettingsService 读取配置。
 */

import type { SettingNodeSchema } from './schema.js'
import type { SettingsService } from './service.js'

import { Permission } from '@/core/dispatch/constants.js'
import type { Context } from '@/core/dispatch/context.js'
import type { FeatureChecker } from '@/core/dispatch/mapping.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'
import type { PersonnelService } from '@/core/personnel/index.js'

/** dispatcher 注入到 Context 的 handler 方法元数据。 */
interface HandlerMethod {
  componentName: string
  methodName: string
  permission: number
}

/**
 * 统一权限检查器：功能开关 + 角色权限，通过 SettingsService 读取配置。
 *
 * 检查链路：
 * 1. system 功能 → 直通
 * 2. 超级管理员 → 绕过
 * 3. ADMIN 权限 → 非管理员拒绝
 * 4. 群聊: bot.enabled → <feature>.enabled → <feature>.permission → 角色比对
 * 5. 私聊: <feature>.enabled（user scope）
 */
export class SettingsPermissionChecker implements FeatureChecker {
  constructor(
    private readonly settings: SettingsService,
    private readonly personnelService: PersonnelService,
    private readonly schemaMap: ReadonlyMap<string, SettingNodeSchema>,
  ) {}

  async check(ctx: Context): Promise<boolean> {
    const handler = ctx.getAttribute('handlerMethod') as HandlerMethod | undefined
    if (handler == null) return true

    const featureName = handler.componentName
    const required: number = handler.permission

    // system 功能零 IO 直通（纯内存判断）
    if (this._isSystem(featureName)) return true

    // 超级管理员绕过
    const adminSet = await this.personnelService.getAdminQqSet()
    if (adminSet.has(BigInt(ctx.userId))) return true

    // ADMIN 权限硬编码，非管理员直接拒绝
    if (required === Permission.ADMIN) return false

    if (ctx.groupId !== undefined) {
      return this._checkGroup(ctx, ctx.groupId, featureName, required)
    }
    return this._checkPrivate(ctx, featureName)
  }

  private async _checkGroup(
    ctx: Context,
    groupId: number,
    featureName: string,
    required: number,
  ): Promise<boolean> {
    const gid = BigInt(groupId)

    // bot 总开关
    const botEnabled = await this.settings.get<boolean>('bot.enabled', { group: gid })
    if (!botEnabled) return false

    // 功能开关
    const enabled = await this.settings.get<boolean>(`${featureName}.enabled`, { group: gid })
    if (!enabled) return false

    // 配置树中的 permission（enum 标签），如果存在则覆盖装饰器静态权限
    const permissionKey = `${featureName}.permission`
    if (this.schemaMap.has(permissionKey)) {
      const label = await this.settings.get<string>(permissionKey, { group: gid })
      const minLevel = this.settings.resolveEnum(permissionKey, label)
      return this._checkGroupRole(ctx, minLevel)
    }

    // 无 permission 配置项时，回退到装饰器声明的静态权限
    return this._checkGroupRole(ctx, required)
  }

  private async _checkPrivate(ctx: Context, featureName: string): Promise<boolean> {
    const userId = BigInt(ctx.userId)
    const enabled = await this.settings.get<boolean>(`${featureName}.enabled`, { user: userId })
    return enabled
  }

  /** 群聊角色级权限检查（无 IO）。 */
  private _checkGroupRole(ctx: Context, required: number): boolean {
    if (required === Permission.ANYONE || required === Permission.GROUP_MEMBER) return true

    const event = ctx.event as Record<string, unknown>
    const sender = event.sender as Record<string, unknown> | undefined
    const role: string = typeof sender?.role === 'string' ? sender.role : 'member'

    if (required === Permission.GROUP_OWNER) return role === 'owner'
    if (required === Permission.GROUP_ADMIN) return role === 'admin' || role === 'owner'

    return false
  }

  /** 检查功能是否为 system（从 HandlerRegistry 判断）。 */
  private _isSystem(featureName: string): boolean {
    const entry = handlerRegistry.get(featureName)
    return entry?.meta.system === true
  }
}
