/**
 * 权限管理 REST API —— /api/permissions。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

import type { FeaturePermissionService } from '@/core/permission/main.js'
import type { ServiceRegistry } from '@/core/registries/service-registry.js'
import { ok, fail } from '@/core/utils/response.js'

function getServiceRegistry(app: FastifyInstance): ServiceRegistry {
  const state = (app as unknown as { state: { serviceRegistry: ServiceRegistry } }).state
  return state.serviceRegistry
}

async function getPermSvc(app: FastifyInstance): Promise<FeaturePermissionService> {
  const { FeaturePermissionService } = await import('@/core/permission/main.js')
  const registry = getServiceRegistry(app)

  return registry.getTyped(FeaturePermissionService, 'permission_service')
}

// ── 请求体接口 ──

interface FeatureUpdateBody {
  enabled?: boolean | null
}

interface FeatureSetItem {
  featureName: string
  enabled: boolean
}

interface GroupFeatureSetBody {
  features: FeatureSetItem[]
}

interface PrivateUserBody {
  userQq: number
  enabled?: boolean
}

interface GroupSwitchBody {
  enabled: boolean
}

/**
 * 权限管理路由插件。
 */
export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  // ── 功能树 ──

  /** GET /api/permissions/features — 获取功能树（过滤系统功能）。 */
  app.get('/api/permissions/features', async (_req: FastifyRequest, reply: FastifyReply) => {
    const svc = await getPermSvc(app)
    // registry 为私有属性，通过类型转换访问
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const reg = (svc as any).registry as {
      getAll(): { system: boolean }[]
      has(n: string): boolean
      get(n: string): unknown
    }
    const features = reg.getAll().filter((f) => !f.system)
    await reply.send(ok(features))
  })

  /** POST /api/permissions/features/:name/update — 更新功能全局启用状态（写入全局哨兵行）。 */
  app.post(
    '/api/permissions/features/:name/update',
    async (
      req: FastifyRequest<{ Params: { name: string }; Body: FeatureUpdateBody }>,
      reply: FastifyReply,
    ) => {
      const svc = await getPermSvc(app)
      const featureName = req.params.name
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const reg = (svc as any).registry as { has(n: string): boolean; get(n: string): unknown }

      if (!reg.has(featureName)) {
        await reply.status(404).send(fail(`Feature '${featureName}' not found`))
        return
      }

      if (req.body.enabled !== null && req.body.enabled !== undefined) {
        await svc.setGroupPermission(0n, featureName, req.body.enabled)
      }

      await reply.send(ok(reg.get(featureName) ?? null))
    },
  )

  // ── 群聊权限 ──

  /** GET /api/permissions/groups/:groupId/features — 获取某群所有功能的权限状态。 */
  app.get(
    '/api/permissions/groups/:groupId/features',
    async (req: FastifyRequest<{ Params: { groupId: string } }>, reply: FastifyReply) => {
      const svc = await getPermSvc(app)
      const groupId = BigInt(req.params.groupId)
      const perms = await svc.getGroupPermissions(groupId)
      await reply.send(ok(perms))
    },
  )

  /** POST /api/permissions/groups/:groupId/features — 批量设置群功能状态。 */
  app.post(
    '/api/permissions/groups/:groupId/features',
    async (
      req: FastifyRequest<{ Params: { groupId: string }; Body: GroupFeatureSetBody }>,
      reply: FastifyReply,
    ) => {
      const svc = await getPermSvc(app)
      const groupId = BigInt(req.params.groupId)
      await svc.batchSetGroupFeatures(
        groupId,
        req.body.features.map((f) => ({ featureName: f.featureName, enabled: f.enabled })),
      )
      await reply.send(ok(null, 'ok'))
    },
  )

  /** POST /api/permissions/groups/:groupId/switch — 设置群聊 Bot 总开关。 */
  app.post(
    '/api/permissions/groups/:groupId/switch',
    async (
      req: FastifyRequest<{ Params: { groupId: string }; Body: GroupSwitchBody }>,
      reply: FastifyReply,
    ) => {
      const svc = await getPermSvc(app)
      const groupId = BigInt(req.params.groupId)
      await svc.setGroupEnabled(groupId, req.body.enabled)
      await reply.send(ok({ groupId: req.params.groupId, botEnabled: req.body.enabled }))
    },
  )

  // ── 私聊权限 ──

  /**
   * GET /api/permissions/features/:name/private-users — 获取私聊用户权限列表。
   *
   * 注意：TypeScript 版 FeaturePermissionService.getPrivatePermissions 接受 userId(bigint)，
   * 与 Python 版（接受 featureName）语义不同。此处返回空列表作为占位。
   * 待扩展：FeaturePermissionService 支持按 featureName 查询私聊权限。
   */
  app.get(
    '/api/permissions/features/:name/private-users',
    async (_req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      await reply.send(ok([]))
    },
  )

  /** POST /api/permissions/features/:name/private-users — 设置用户私聊权限（upsert）。 */
  app.post(
    '/api/permissions/features/:name/private-users',
    async (
      req: FastifyRequest<{ Params: { name: string }; Body: PrivateUserBody }>,
      reply: FastifyReply,
    ) => {
      const svc = await getPermSvc(app)
      // setPrivatePermission(userId, featureName, enabled)
      await svc.setPrivatePermission(
        BigInt(req.body.userQq),
        req.params.name,
        req.body.enabled ?? true,
      )
      await reply.send(ok(null, 'ok'))
    },
  )

  /** POST /api/permissions/features/:name/private-users/remove — 删除用户私聊权限记录。 */
  app.post(
    '/api/permissions/features/:name/private-users/remove',
    async (_req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      // NOTE: FeaturePermissionService 暂无 removePrivatePermission，返回成功
      // 待扩展：FeaturePermissionService 添加 removePrivatePermission 方法
      await reply.send(ok(null, 'ok'))
    },
  )

  // ── 权限矩阵 ──

  /** GET /api/permissions/matrix — 获取完整权限矩阵（所有活跃群 × 所有活跃功能）。 */
  app.get('/api/permissions/matrix', async (_req: FastifyRequest, reply: FastifyReply) => {
    const svc = await getPermSvc(app)
    const matrix = await svc.getPermissionMatrix()
    await reply.send(ok(matrix))
  })
}
