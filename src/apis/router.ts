/**
 * API 路由注册器 —— 统一注册所有路由插件（业务 API + 核心领域 API）。
 */

import type { FastifyInstance } from 'fastify'

import { getLogger } from '../core/logging/setup.js'

import { botRoutes } from './bot.js'
import { chatRoutes } from './chat.js'
import { checkinRoutes } from './checkin.js'
import { driftBottleRoutes } from './drift-bottle.js'
import { feedbackRoutes } from './feedback.js'
import { handlerRoutes } from './handlers.js'
import { jrlpRoutes } from './jrlp.js'
import { likeRoutes } from './like.js'
import { logsRoutes } from './logs.js'
import { permissionRoutes } from './permission.js'
import { queueRoutes } from './queue.js'

const log = getLogger('router')

/**
 * 注册所有 API 路由到 Fastify 实例。
 *
 * 包含：
 * - 业务 API 路由（bot、chat、checkin、drift-bottle 等）
 * - 核心领域路由（llm、personnel，通过动态导入注册）
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── 业务 API 路由 ──
  await botRoutes(app)
  await chatRoutes(app)
  await checkinRoutes(app)
  await driftBottleRoutes(app)
  await feedbackRoutes(app)
  await jrlpRoutes(app)
  await likeRoutes(app)
  await permissionRoutes(app)
  await handlerRoutes(app)
  await logsRoutes(app)
  await queueRoutes(app)

  // ── 核心领域 API 路由 ──

  // LLM 路由
  try {
    const { llmRoutes } = await import('../core/llm/api.js')
    await app.register(
      async (fastify) => {
        await llmRoutes(fastify)
      },
      { prefix: '/api/llm' },
    )
  } catch (err) {
    log.warn({ err }, 'LLM 路由注册失败')
  }

  // 人员管理路由
  try {
    const { registerPersonnelRoutes } = await import('../core/personnel/api.js')
    await registerPersonnelRoutes(app)
  } catch (err) {
    log.warn({ err }, '人员管理路由注册失败')
  }
}
