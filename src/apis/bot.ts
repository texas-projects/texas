/**
 * Bot 信息 API 端点 —— 获取和修改 Bot 登录信息。
 */

import { getLogger } from '@logger'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

import { ok, fail } from '@/core/response.js'

const log = getLogger('bot')

// ── 内部工具 ──

function getState(app: FastifyInstance): Record<string, unknown> {
  return (app as unknown as { state: Record<string, unknown> }).state
}

// ── 请求类型 ──

interface BotProfileUpdateBody {
  nickname?: string | null
  personalNote?: string | null
}

// ── 路由插件 ──

/**
 * Bot 信息管理路由插件。
 */
const botRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/bot/info — 获取 Bot 登录信息（昵称、QQ 号、头像）。 */
  app.get('/api/bot/info', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const connMgr = state.connectionManager as { connected: boolean } | undefined
    const botApi = state.botApi as
      | { getLoginInfo(): Promise<{ ok: boolean; data?: Record<string, unknown> }> }
      | undefined

    let nickname: string | null = null
    let userId: number | null = null
    let avatarUrl: string | null = null

    if (connMgr?.connected === true && botApi !== undefined) {
      try {
        const resp = await botApi.getLoginInfo()
        if (resp.ok && resp.data !== undefined) {
          nickname = (resp.data.nickname as string | null | undefined) ?? null
          userId = (resp.data.user_id as number | null | undefined) ?? null
          if (userId !== null) {
            avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${String(userId)}&s=640`
          }
        }
      } catch (err) {
        log.warn({ err }, '获取 Bot 登录信息失败')
      }
    }

    await reply.send(ok({ nickname, userId, avatarUrl }))
  })

  /** GET /api/bot/profile — 获取 Bot 完整信息（含在线状态和版本）。 */
  app.get('/api/bot/profile', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = getState(app)
    const connMgr = state.connectionManager as { connected: boolean } | undefined
    const botApi = state.botApi as
      | {
          getLoginInfo(): Promise<{ ok: boolean; data?: Record<string, unknown> }>
          getVersionInfo(): Promise<{ ok: boolean; data?: Record<string, unknown> }>
        }
      | undefined

    let nickname: string | null = null
    let userId: number | null = null
    let avatarUrl: string | null = null
    const online = connMgr?.connected === true
    let version: Record<string, string> = {}

    if (online && botApi !== undefined) {
      try {
        const loginResp = await botApi.getLoginInfo()
        if (loginResp.ok && loginResp.data !== undefined) {
          nickname = (loginResp.data.nickname as string | null | undefined) ?? null
          userId = (loginResp.data.user_id as number | null | undefined) ?? null
          if (userId !== null) {
            avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${String(userId)}&s=640`
          }
        }
      } catch (err) {
        log.warn({ err }, '获取登录信息失败')
      }

      try {
        const verResp = await botApi.getVersionInfo()
        if (verResp.ok && verResp.data !== undefined) {
          version = {
            appName: (verResp.data.app_name as string | undefined) ?? '',
            appVersion: (verResp.data.app_version as string | undefined) ?? '',
            protocolVersion: (verResp.data.protocol_version as string | undefined) ?? '',
          }
        }
      } catch (err) {
        log.warn({ err }, '获取版本信息失败')
      }
    }

    await reply.send(ok({ nickname, userId, avatarUrl, online, version }))
  })

  /** PUT /api/bot/profile — 修改 Bot 昵称和个性签名。 */
  app.put(
    '/api/bot/profile',
    async (req: FastifyRequest<{ Body: BotProfileUpdateBody }>, reply: FastifyReply) => {
      const state = getState(app)
      const connMgr = state.connectionManager as { connected: boolean } | undefined
      const botApi = state.botApi as
        | {
            getLoginInfo(): Promise<{ ok: boolean; data?: Record<string, unknown> }>
            setQqProfile(opts: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>
          }
        | undefined

      if (connMgr?.connected !== true) {
        await reply.status(400).send(fail('Bot 未连接，无法修改资料'))
        return
      }

      const body = req.body
      if (body.nickname === undefined && body.personalNote === undefined) {
        await reply.status(400).send(fail('至少需要提供一个修改字段'))
        return
      }

      if (botApi === undefined) {
        await reply.status(500).send(fail('Bot API 未就绪'))
        return
      }

      try {
        let nickname = body.nickname
        if (nickname === undefined) {
          const loginResp = await botApi.getLoginInfo()
          if (loginResp.ok && loginResp.data !== undefined) {
            nickname = (loginResp.data.nickname as string | undefined) ?? ''
          } else {
            await reply.status(500).send(fail('获取当前昵称失败，无法执行修改'))
            return
          }
        }

        const kwargs: Record<string, unknown> = { nickname }
        if (body.personalNote !== undefined) {
          kwargs.personal_note = body.personalNote
        }

        const resp = await botApi.setQqProfile(kwargs)
        if (!resp.ok) {
          await reply.status(500).send(fail(`修改失败：${resp.message ?? '未知错误'}`))
          return
        }
      } catch (err) {
        log.warn({ err }, '修改 Bot 资料失败')
        await reply.status(500).send(fail('修改失败，请稍后重试'))
        return
      }

      await reply.send(ok({}))
    },
  )
}

export default botRoutes
export { botRoutes }
