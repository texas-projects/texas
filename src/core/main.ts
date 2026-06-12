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
import { createLogger, setLogger, logger, getLogger } from '@logger'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import type { Redis } from 'ioredis'

import pkg from '../../package.json' with { type: 'json' }

import { loadConfig } from './config.js'
import { createMainDb, createChatDb } from './db.js'
import { EventDispatcher } from './dispatch/dispatcher.js'
import { LoggingInterceptor } from './dispatch/interceptors/logging.js'
import { SessionInterceptor } from './dispatch/interceptors/session.js'
import { CompositeHandlerMapping } from './dispatch/mapping.js'
import type { HandlerMethod, FeatureChecker } from './dispatch/mapping.js'
import { handlerRegistry } from './dispatch/registry.js'
import type { EchoConfig } from './echo/config.js'
import { loadEchoConfig } from './echo/load-config.js'
import { EchoLoader } from './echo/loader.js'
import type { RouteEchoEntry, TaskEchoEntry } from './echo/loader.js'
import { LifecycleOrchestrator } from './lifecycle/orchestrator.js'
import { getAllStartups, getAllShutdowns } from './lifecycle/registry.js'
import { ServiceRegistry } from './lifecycle/service-registry.js'
import { metricsRegistry } from './monitoring/metrics.js'
import { authPlugin } from './plugins/auth.js'
import { corsPlugin } from './plugins/cors.js'
import { swaggerPlugin } from './plugins/swagger.js'
import { BotAPI } from './protocol/api.js'
import { createRedis, checkRedisReachable } from './redis/factory.js'
import { RedisStore } from './redis/store.js'
import { createBullMQConnection, getTaskQueue } from './tasks/broker.js'
import { TaskExecutor } from './tasks/executor.js'
import { setTaskDefinitions } from './tasks/scheduler.js'
import { ConnectionManager } from './ws/connection.js'
import { registerWsRoute } from './ws/server.js'
// 触发 PersonnelService 的 Startup 注册（EchoLoader 不扫描 src/core/，需手动引入）
import '@/core/personnel/index.js'

// ── 内部状态类型 ──

interface AppState {
  // 基础设施
  mainDb: ReturnType<typeof createMainDb>
  chatDb: ReturnType<typeof createChatDb>
  cacheRedis: Redis
  persistentRedis: Redis
  cacheStore: RedisStore
  persistentStore: RedisStore
  // 框架核心
  botApi: BotAPI
  connMgr: ConnectionManager
  dispatcher: EventDispatcher
  // 任务
  taskExecutor: TaskExecutor
  queue: ReturnType<typeof getTaskQueue>
  // 服务注册表（API 路由通过此访问业务服务）
  serviceRegistry: ServiceRegistry
  // 业务服务（由 orchestrator 填充）
  [key: string]: unknown
}

/** 获取 app.state（类型断言辅助函数）。 */
function getState(app: FastifyInstance): AppState {
  return (app as unknown as { state: AppState }).state
}

// ── EchoLoader 辅助函数 ──

/**
 * 通过 EchoLoader 加载 handler、service、task 类型的 echo，
 * 触发装饰器副作用（@Startup/@Shutdown 注册），
 * 并将 task definitions 传给 scheduler，最后将 handler 注册到 composite mapping。
 */
async function _loadEchoes(composite: CompositeHandlerMapping): Promise<EchoConfig> {
  const echoConfig = await loadEchoConfig()
  const baseDir = resolve(import.meta.dirname, '..', '..')
  const loader = new EchoLoader(echoConfig, baseDir)

  await loader.discoverByType('handler')
  await loader.discoverByType('service')

  const taskEntries = (await loader.discoverByType('task')) as TaskEchoEntry[]
  setTaskDefinitions(taskEntries.map((e) => e.taskDefinition))

  _registerHandlersToMapping(composite)
  return echoConfig
}

/** 遍历 HandlerRegistry，实例化所有组件并将处理器方法注册到 CompositeHandlerMapping。 */
function _registerHandlersToMapping(composite: CompositeHandlerMapping): void {
  const log = getLogger('main')
  for (const [componentName, entry] of handlerRegistry.entries()) {
    const instance = new (entry.meta.target as new () => object)()
    const defaultPriority = entry.meta.defaultPriority

    let handlerCount = 0
    for (const methodMeta of entry.methods) {
      const priority = methodMeta.priority ?? defaultPriority
      composite.register({
        instance,
        method: methodMeta.method,
        priority,
        componentName,
        meta: methodMeta as unknown as HandlerMethod['meta'],
      })
      handlerCount++
    }

    log.info(`组件已注册：${componentName}，handler 数量：${String(handlerCount)}`)
  }
}

// ── 路由注册辅助函数 ──

/** 通过 EchoLoader 发现并注册 src/apis/ 下所有业务路由插件。 */
async function _registerEchoRoutes(app: FastifyInstance): Promise<void> {
  const echoConfig = await loadEchoConfig()
  const baseDir = resolve(import.meta.dirname, '..', '..')
  const loader = new EchoLoader(echoConfig, baseDir)
  const routeEntries = await loader.discoverByType('route')
  for (const entry of routeEntries) {
    await app.register((entry as RouteEchoEntry).plugin as FastifyPluginAsync)
  }
}

/** 注册核心领域 API 路由（LLM、人员管理），这些路由未随 EchoLoader 发现，硬编码注册。 */
async function _registerCoreRoutes(app: FastifyInstance): Promise<void> {
  try {
    const { llmRoutes } = await import('@/core/llm/api.js')
    await app.register(
      async (fastify) => {
        await llmRoutes(fastify)
      },
      { prefix: '/api/llm' },
    )
  } catch (err) {
    app.log.warn({ err }, 'LLM 路由注册失败')
  }

  try {
    const { registerPersonnelRoutes } = await import('@/core/personnel/api.js')
    await registerPersonnelRoutes(app)
  } catch (err) {
    app.log.warn({ err }, '人员管理路由注册失败')
  }
}

// ── 启动逻辑 ──

async function _startup(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
  botApi: BotAPI,
  connMgr: ConnectionManager,
  dispatcherRef: { current: EventDispatcher | undefined },
): Promise<void> {
  app.log.info('Aemeath 正在启动...')

  // 1. 初始化 Prisma 客户端
  const mainDb = createMainDb(config.DATABASE_URL, config.DB_POOL_SIZE)
  const chatDb = createChatDb(config.CHAT_DATABASE_URL, config.CHAT_DB_POOL_SIZE)

  // 2. 初始化 Redis 客户端
  const cacheRedis = createRedis(config.CACHE_REDIS_URL, { lazyConnect: false })
  const persistentRedis = createRedis(config.PERSISTENT_REDIS_URL, {
    lazyConnect: false,
  })

  // 3. 创建 RedisStore 封装
  const cacheStore = new RedisStore(cacheRedis, config.CACHE_DEFAULT_TTL)
  const persistentStore = new RedisStore(persistentRedis, 0)

  // 4. 构建复合处理器映射
  const composite = new CompositeHandlerMapping()

  // 5. EchoLoader 发现并加载 handlers、services、tasks（触发 @Startup/@Shutdown 副作用）
  const echoConfig = await _loadEchoes(composite)

  // 6. 构建 Dispatcher 并连接到 connMgr（解决 setupLifecycle 阶段的前向引用）
  const dispatcher = new EventDispatcher(composite, [
    new LoggingInterceptor(),
    new SessionInterceptor(),
  ])
  dispatcherRef.current = dispatcher

  // 8.5. 预检所有 Redis 连接可达性（连接不可用时立即抛出，避免后续操作无声挂起）
  await checkRedisReachable(config.CACHE_REDIS_URL, 'Cache Redis')
  await checkRedisReachable(config.PERSISTENT_REDIS_URL, 'Persistent Redis')
  await checkRedisReachable(config.BULLMQ_REDIS_URL, 'BullMQ Redis')

  // 9. 创建 BullMQ 单队列
  const bullConn = createBullMQConnection(config.BULLMQ_REDIS_URL)
  const queue = getTaskQueue(bullConn)
  const queueName = echoConfig.app?.queueName ?? 'aemeath-tasks'

  // 10. 生命周期编排器：按拓扑顺序启动所有业务模块
  const orchestrator = new LifecycleOrchestrator()
  const infraServices: Record<string, unknown> = {
    db: mainDb,
    chat_db: chatDb,
    cache: cacheStore,
    persistent: persistentStore,
    cache_redis: cacheRedis,
    persistent_redis: persistentRedis,
    bot_api: botApi,
    conn_mgr: connMgr,
    dispatcher,
    queue,
  }

  const allServices = await orchestrator.startup(infraServices, getAllStartups())

  // 10.5. 注入 Settings 权限检查器到 Dispatcher（延迟绑定）
  const settingsChecker = allServices.settings_checker as FeatureChecker | undefined
  if (settingsChecker) {
    dispatcher.setFeatureChecker(settingsChecker)
  }

  // 11. 构建 ServiceRegistry（API 路由通过 app.state.serviceRegistry 访问业务服务）
  const serviceRegistry = new ServiceRegistry()
  for (const [key, value] of Object.entries(allServices)) {
    serviceRegistry.register(key, value)
  }
  serviceRegistry.freeze()

  // 13. 启动 TaskExecutor（监听 job completed 事件）
  const taskExecutor = new TaskExecutor(
    botApi,
    connMgr,
    cacheStore,
    bullConn,
    queueName,
    config.TASK_SEND_DELAY_MS,
  )
  taskExecutor.start()

  // 15. 将所有服务挂载到 app.state
  ;(app as unknown as { state: AppState }).state = {
    mainDb,
    chatDb,
    cacheRedis,
    persistentRedis,
    cacheStore,
    persistentStore,
    botApi,
    connMgr,
    dispatcher,
    taskExecutor,
    queue,
    serviceRegistry,
    ...allServices,
  }

  app.log.info(`Aemeath 已启动，等待 NapCat 连接 (host=${config.HOST} port=${String(config.PORT)})`)
}

// ── 关闭逻辑 ──

async function _shutdown(app: FastifyInstance): Promise<void> {
  app.log.info('Aemeath 正在关闭...')

  const state = getState(app)

  // 停止 TaskExecutor
  await state.taskExecutor.close()

  // 关闭业务模块（@Shutdown 按启动逆序）
  const orchestrator = new LifecycleOrchestrator()
  try {
    await orchestrator.shutdown(getAllShutdowns())
  } catch (err) {
    app.log.error({ err }, '业务模块关闭时发生错误')
  }

  // 关闭数据库连接
  await state.mainDb.$disconnect()
  await state.chatDb.$disconnect()

  // 关闭 Redis 连接
  state.cacheRedis.disconnect()
  state.persistentRedis.disconnect()

  // 关闭 BullMQ 队列
  await (state.queue as { close(): Promise<void> }).close()

  app.log.info('Aemeath 已停止')
}

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
  await _registerEchoRoutes(app)
  await _registerCoreRoutes(app)

  // ── 系统端点 ──

  // 健康检查
  app.get('/health', async () => {
    const state = (app as unknown as { state: Record<string, unknown> }).state
    const connMgr = state.connMgr as { isConnected?: boolean } | undefined
    return {
      status: 'healthy',
      version: pkg.version,
      description: pkg.description,
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

  // ── 生命周期钩子（内联启动/关闭编排）──

  // BotAPI 和 ConnectionManager 必须在 onReady 之前创建，以便在 Fastify 启动阶段注册 WS 路由。
  // onReady 触发时插件引导已完成（FST_ERR_ROOT_PLG_BOOTED），此后无法再注册路由。
  const connMgrRef: { current: ConnectionManager | undefined } = { current: undefined }
  const botApi = new BotAPI((data: string) => {
    connMgrRef.current?.send(data)
  })

  const dispatcherRef: { current: EventDispatcher | undefined } = { current: undefined }
  const connMgr = new ConnectionManager(botApi, (event) => {
    void dispatcherRef.current?.dispatch(event, botApi)
  })
  connMgrRef.current = connMgr

  // 注册 WebSocket 路由（必须在 app.listen() 之前完成，即插件引导阶段）
  registerWsRoute(app, connMgr, config.NAPCAT_ACCESS_TOKEN)

  app.addHook('onReady', async () => {
    await _startup(app, config, botApi, connMgr, dispatcherRef)
  })

  app.addHook('onClose', async () => {
    await _shutdown(app)
  })

  // ── 启动监听 ──
  await app.listen({ host: config.HOST, port: config.PORT })
}

// ── 入口 ──

bootstrap().catch((err: unknown) => {
  logger.error({ err }, '启动失败')
  process.exit(1)
})
