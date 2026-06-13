/**
 * 漂流瓶管理 REST API —— /api/drift-bottle-pools。
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import type { ServiceRegistry } from '@/core/lifecycle/index.js'
import { ok, fail } from '@/core/response.js'
import type { DriftBottleService, PoolInfo } from '@/services/drift-bottle.js'

function getServiceRegistry(app: FastifyInstance): ServiceRegistry {
  const state = (app as unknown as { state: { serviceRegistry: ServiceRegistry } }).state
  return state.serviceRegistry
}

async function getDriftSvc(app: FastifyInstance): Promise<DriftBottleService> {
  const { DriftBottleService: Cls } = await import('@/services/drift-bottle.js')
  const registry = getServiceRegistry(app)

  return registry.getTyped(Cls, 'drift_bottle_service')
}

/**
 * 漂流瓶管理路由插件。
 */
const driftBottleRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/drift-bottle-pools — 列出所有漂流瓶池，含各池未捞取瓶数统计。 */
  app.get('/api/drift-bottle-pools', async (_req: FastifyRequest, reply: FastifyReply) => {
    const svc = await getDriftSvc(app)

    const pools: PoolInfo[] = await svc.listPools()
    await reply.send(
      ok(
        pools.map((p) => ({
          id: p.id,
          name: p.name,
          availableCount: p.availableCount,
        })),
      ),
    )
  })

  /** POST /api/drift-bottle-pools — 创建新漂流瓶池。 */
  app.post(
    '/api/drift-bottle-pools',
    async (req: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) => {
      const svc = await getDriftSvc(app)

      try {
        const pool = await svc.createPool(req.body.name)
        await reply.status(201).send(ok({ id: pool.id, name: pool.name }))
      } catch (err) {
        if (err instanceof Error) {
          await reply.status(409).send(fail(err.message))
        } else {
          await reply.status(409).send(fail('创建失败'))
        }
      }
    },
  )

  /** POST /api/drift-bottle-pools/:poolId/delete — 删除漂流瓶池（id=0 的默认池不可删除）。 */
  app.post(
    '/api/drift-bottle-pools/:poolId/delete',
    async (req: FastifyRequest<{ Params: { poolId: string } }>, reply: FastifyReply) => {
      const svc = await getDriftSvc(app)

      const poolId = parseInt(req.params.poolId, 10)
      try {
        await svc.deletePool(poolId)
        await reply.send(ok(null))
      } catch (err) {
        if (err instanceof Error) {
          const status = err.message.includes('默认') ? 400 : 409
          await reply.status(status).send(fail(err.message))
        } else {
          await reply.status(400).send(fail('删除失败'))
        }
      }
    },
  )

  /** GET /api/drift-bottle-pools/:poolId/groups — 列出指定池下所有群号。 */
  app.get(
    '/api/drift-bottle-pools/:poolId/groups',
    async (req: FastifyRequest<{ Params: { poolId: string } }>, reply: FastifyReply) => {
      const svc = await getDriftSvc(app)

      const poolId = parseInt(req.params.poolId, 10)
      const groupIds = await svc.listPoolGroups(poolId)
      await reply.send(ok({ poolId, groupIds }))
    },
  )

  /** POST /api/drift-bottle-pools/group-assign — 将群分配到指定池；poolId=0 表示移回默认池。 */
  app.post(
    '/api/drift-bottle-pools/group-assign',
    async (
      req: FastifyRequest<{ Body: { groupId: number; poolId: number } }>,
      reply: FastifyReply,
    ) => {
      const svc = await getDriftSvc(app)

      try {
        await svc.assignGroupPool({ groupId: BigInt(req.body.groupId), poolId: req.body.poolId })
        await reply.send(ok(null))
      } catch (err) {
        if (err instanceof Error) {
          await reply.status(400).send(fail(err.message))
        } else {
          await reply.status(400).send(fail('分配失败'))
        }
      }
    },
  )
}

export default driftBottleRoutes
export { driftBottleRoutes }
