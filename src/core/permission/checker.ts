/**
 * 功能级权限检查器 —— 在 handler 循环中对每个 handler 执行完整权限检查（功能级 + 角色级）。
 *
 * 检查顺序：
 * 1. 系统级功能（system=True）零 IO 直接通过
 * 2. 超级管理员绕过所有权限（单次 IO，合并重复查询）
 * 3. ADMIN 权限要求：非管理员直接拒绝
 * 4. 群聊 → 群 bot 总开关 → 功能启用检查 → 角色检查（无 IO）
 * 5. 私聊 → 功能允许检查
 */

import type { FeaturePermissionService } from './main.js'

import type { Context } from '@/core/framework/context.js'
import { Permission } from '@/core/framework/decorators.js'
import type { FeatureChecker } from '@/core/framework/ports.js'
import type { PersonnelService } from '@/core/personnel/main.js'
import type { PermissionRegistry } from '@/core/registries/permission-registry.js'

/** 处理器方法元数据扩展（从 mapping 层获取）。 */
interface HandlerMethod {
  componentName: string
  methodName: string
  permission: number
}

/**
 * 统一权限检查器：功能级权限 + 角色级权限，单次 check() 完成全部校验。
 */
export class FeaturePermissionChecker implements FeatureChecker {
  constructor(
    private readonly permissionService: FeaturePermissionService,
    private readonly personnelService: PersonnelService,
    private readonly permRegistry?: PermissionRegistry,
  ) {}

  /** 返回 true 表示允许执行该 handler。 */
  async check(ctx: Context): Promise<boolean> {
    // 从 Context 属性获取 handler 方法元数据（由 dispatcher 注入）
    const handler = ctx.getAttribute('handlerMethod') as HandlerMethod | undefined
    if (handler == null) return true

    const ctrlFeature: string = handler.componentName
    const methodFeature = `${handler.componentName}.${handler.methodName}`
    const required: number = handler.permission

    // 零 IO 快速路径：系统级功能始终允许
    if (this.permRegistry?.isSystem(ctrlFeature) === true) {
      return true
    }

    // 超级管理员绕过所有权限
    const adminSet = await this.personnelService.getAdminQqSet()
    if (adminSet.has(BigInt(ctx.userId))) {
      return true
    }

    // ADMIN 权限：非管理员直接拒绝
    if (required === Permission.ADMIN) {
      return false
    }

    // 功能级权限检查
    if (ctx.groupId !== undefined) {
      return this._checkGroup(ctx, ctrlFeature, methodFeature, required)
    }
    return this._checkPrivate(ctx, ctrlFeature, methodFeature)
  }

  private async _checkGroup(
    ctx: Context,
    ctrlFeature: string,
    methodFeature: string,
    required: number,
  ): Promise<boolean> {
    const groupId = ctx.groupId
    if (groupId === undefined) return true

    // 群 bot 总开关
    if (!(await this.permissionService.isGroupEnabled(BigInt(groupId)))) {
      return false
    }

    // 功能启用检查
    if (
      !(await this.permissionService.isGroupFeatureEnabled(
        BigInt(groupId),
        ctrlFeature,
        methodFeature,
      ))
    ) {
      return false
    }

    return this._checkGroupRole(ctx, required)
  }

  private async _checkPrivate(
    ctx: Context,
    ctrlFeature: string,
    methodFeature: string,
  ): Promise<boolean> {
    return this.permissionService.isPrivateFeatureAllowed(
      ctrlFeature,
      methodFeature,
      BigInt(ctx.userId),
    )
  }

  /** 群聊角色级权限检查（无 IO，同步方法）。 */
  private _checkGroupRole(ctx: Context, required: number): boolean {
    if (required === Permission.ANYONE || required === Permission.GROUP_MEMBER) {
      return true
    }

    const event = ctx.event as Record<string, unknown>
    const sender = event.sender as Record<string, unknown> | undefined
    const role: string = typeof sender?.role === 'string' ? sender.role : 'member'

    if (required === Permission.GROUP_OWNER) {
      return role === 'owner'
    }
    if (required === Permission.GROUP_ADMIN) {
      return role === 'admin' || role === 'owner'
    }

    // 未知权限等级，保守拒绝
    return false
  }
}
