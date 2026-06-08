/**
 * Bearer Token 认证插件 —— 校验管理后台 API 的 Authorization 头。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { fail } from '@/core/utils/response.js'

/**
 * 注册 Bearer token 认证钩子。
 *
 * 当 ADMIN_TOKEN 环境变量有值时启用认证；
 * 以 /api/ 开头的路由（除公开白名单外）需要携带 Authorization: Bearer <token>。
 *
 * 注意：/api/bot/info 和 /api/bot/profile GET 请求为公开端点，不需要认证。
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  const adminToken = process.env.ADMIN_TOKEN

  if (!adminToken) {
    // 未配置 ADMIN_TOKEN 时跳过认证（开发环境）
    return
  }

  /** 不需要认证的公开端点前缀集合。 */
  const PUBLIC_PREFIXES = ['/docs', '/health', '/metrics']

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const url = request.url

    // 仅保护 /api/ 路径
    if (!url.startsWith('/api/')) {
      return
    }

    // 公开前缀白名单
    for (const prefix of PUBLIC_PREFIXES) {
      if (url.startsWith(prefix)) {
        return
      }
    }

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      await reply.status(401).send(fail('缺少认证令牌'))
      return
    }

    const token = authHeader.slice('Bearer '.length)
    if (token !== adminToken) {
      await reply.status(403).send(fail('认证令牌无效'))
      return
    }
  })
}
