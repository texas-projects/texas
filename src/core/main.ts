/**
 * Fastify 应用入口 —— 组装并启动 Aemeath 框架。
 *
 * 开发环境运行: pnpm dev
 * 生产环境运行: node dist/core/main.js
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createLogger, setLogger, logger } from '@logger'
import Fastify, { type FastifyInstance } from 'fastify'

import { loadConfig } from './config.js'
import { setupLifecycle } from './lifespan.js'
import { metricsRegistry } from './monitoring/metrics.js'
import { VERSION, DESCRIPTION } from './version.js'

import { authPlugin } from '@/apis/plugins/auth.js'
import { corsPlugin } from '@/apis/plugins/cors.js'
import { swaggerPlugin } from '@/apis/plugins/swagger.js'
import { registerRoutes } from '@/apis/router.js'

// ── 主启动函数 ──

async function bootstrap(): Promise<void> {
  const config = loadConfig()

  // 初始化日志（须在 Fastify 实例创建前就绪）
  const appLogger = createLogger({
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
  })
  setLogger(appLogger)

  // 创建 Fastify 实例（使用 Pino 作为内置日志器）
  // pino.Logger 与 FastifyBaseLogger 运行时兼容但 TypeScript 泛型逆变不一致，用类型断言统一
  const app = Fastify({
    loggerInstance: appLogger,
    disableRequestLogging: false,
  }) as unknown as FastifyInstance

  // ── 注册插件 ──

  // WebSocket 支持（必须在路由注册之前）
  await app.register(fastifyWebsocket)

  // CORS
  await corsPlugin(app)

  // Swagger 文档（仅非生产环境）
  if (!config.isProduction) {
    await swaggerPlugin(app)
  }

  // Bearer token 认证
  await authPlugin(app)

  // ── 注册 API 路由 ──
  await registerRoutes(app)

  // ── 系统端点 ──

  // 健康检查
  app.get('/health', async () => {
    const state = (app as unknown as { state: Record<string, unknown> }).state
    const connMgr = state.connMgr as { isConnected?: boolean } | undefined
    return {
      status: 'healthy',
      version: VERSION,
      description: DESCRIPTION,
      ws_connected: connMgr?.isConnected ?? false,
    }
  })

  // Prometheus 指标
  app.get('/metrics', async (_req, reply) => {
    const metrics = await metricsRegistry.metrics()
    void reply.header('content-type', metricsRegistry.contentType)
    return reply.send(metrics)
  })

  // ── 前端静态文件（必须放最后，避免覆盖 API 路由）──
  const frontendDist = resolve(config.FRONTEND_DIST_DIR)
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      // SPA fallback：所有未匹配路由返回 index.html
      wildcard: false,
    })

    // SPA fallback（前端路由）
    app.setNotFoundHandler(async (_req, reply) => {
      const indexPath = resolve(frontendDist, 'index.html')
      if (existsSync(indexPath)) {
        return reply.sendFile('index.html', frontendDist)
      }
      await reply.status(404).send({ error: 'Not Found' })
    })
  }

  // ── 生命周期钩子（启动/关闭编排）──
  await setupLifecycle(app, config)

  // ── 启动监听 ──
  await app.listen({ host: config.HOST, port: config.PORT })
  app.log.info(`Aemeath bot started — http://${config.HOST}:${String(config.PORT)}`)
}

// ── 入口 ──

bootstrap().catch((err: unknown) => {
  logger.error({ err }, '启动失败')
  process.exit(1)
})
