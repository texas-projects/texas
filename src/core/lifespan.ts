/**
 * 应用生命周期 —— 启动与关闭逻辑编排（对标 Python 侧的 lifespan.py）。
 */

import { resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'

import { CacheClient } from './cache/client.js'
import type { Config } from './config.js'
import { createMainDb, createChatDb } from './db/client.js'
import { EventDispatcher } from './framework/dispatcher.js'
import { LoggingInterceptor } from './framework/interceptors/logging.js'
import { SessionInterceptor } from './framework/interceptors/session.js'
import { CompositeHandlerMapping } from './framework/mapping.js'
import { ComponentScanner } from './framework/scanner.js'
import { LifecycleOrchestrator } from './lifecycle/orchestrator.js'
import { getAllStartups, getAllShutdowns } from './lifecycle/registry.js'
import { BotAPI } from './protocol/api.js'
import { ServiceRegistry } from './registries/service-registry.js'
import { RPCConsumer } from './rpc/consumer.js'
import { createBullMQConnection, getQueue, QUEUE_NAMES } from './tasks/broker.js'
import { createRedis, checkRedisReachable } from './utils/redis-factory.js'
import { ConnectionManager } from './ws/connection.js'
import { registerWsRoute } from './ws/server.js'

import type { DailyCheckinService } from '@/services/daily-checkin.js'

/**
 * 应用生命周期编排。
 *
 * 在 Fastify 的 `onReady` 和 `onClose` 钩子中执行启动/关闭逻辑，
 * 所有服务实例挂载到 `app.state`（通过 `(app as StateApp).state` 访问）。
 *
 * @param app - Fastify 应用实例
 * @param config - 已验证的应用配置
 */
export async function setupLifecycle(app: FastifyInstance, config: Config): Promise<void> {
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

  // ── 启动钩子 ──
  app.addHook('onReady', async () => {
    await _startup(app, config, botApi, connMgr, dispatcherRef)
  })

  // ── 关闭钩子 ──
  app.addHook('onClose', async () => {
    await _shutdown(app)
  })
}

// ── 内部状态类型 ──

interface AppState {
  // 基础设施
  mainDb: ReturnType<typeof createMainDb>
  chatDb: ReturnType<typeof createChatDb>
  cacheRedis: Redis
  persistentRedis: Redis
  cacheClient: CacheClient
  persistentClient: CacheClient
  // 框架核心
  botApi: BotAPI
  connMgr: ConnectionManager
  dispatcher: EventDispatcher
  scanner: ComponentScanner
  // 任务
  rpcConsumer: RPCConsumer
  queues: Record<string, ReturnType<typeof getQueue>>
  // 服务注册表（API 路由通过此访问业务服务）
  serviceRegistry: ServiceRegistry
  // 业务服务（由 orchestrator 填充）
  [key: string]: unknown
}

/** 获取 app.state（类型断言辅助函数）。 */
function getState(app: FastifyInstance): AppState {
  return (app as unknown as { state: AppState }).state
}

// ── 启动逻辑 ──

async function _startup(
  app: FastifyInstance,
  config: Config,
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

  // 3. 创建 CacheClient 封装
  const cacheClient = new CacheClient(cacheRedis, config.CACHE_DEFAULT_TTL)
  const persistentClient = new CacheClient(persistentRedis, 0)

  // 4. 构建复合处理器映射
  const composite = new CompositeHandlerMapping()

  // 5. ComponentScanner 扫描 handlers 和 services（触发 @Startup/@Shutdown 副作用）
  const scanner = new ComponentScanner()
  const srcRoot = resolve('src')
  await scanner.scan(
    [resolve(srcRoot, 'handlers')],
    [
      resolve(srcRoot, 'services'),
      resolve(srcRoot, 'core', 'browser'),
      resolve(srcRoot, 'core', 'permission'),
    ],
    composite,
  )

  // 6. 构建 Dispatcher 并连接到 connMgr（解决 setupLifecycle 阶段的前向引用）
  const dispatcher = new EventDispatcher(composite, [
    new LoggingInterceptor(),
    new SessionInterceptor(),
  ])
  dispatcherRef.current = dispatcher

  // 7. RPC Consumer（主进程端）
  const rpcConsumer = new RPCConsumer(config.PERSISTENT_REDIS_URL)

  // 8.5. 预检所有 Redis 连接可达性（连接不可用时立即抛出，避免后续操作无声挂起）
  await checkRedisReachable(config.CACHE_REDIS_URL, 'Cache Redis')
  await checkRedisReachable(config.PERSISTENT_REDIS_URL, 'Persistent Redis')
  await checkRedisReachable(config.BULLMQ_REDIS_URL, 'BullMQ Redis')

  // 9. 创建 BullMQ 队列
  const bullConn = createBullMQConnection(config.BULLMQ_REDIS_URL)
  const queues = {
    [QUEUE_NAMES.DAILY_CHECKIN]: getQueue(QUEUE_NAMES.DAILY_CHECKIN, bullConn),
    [QUEUE_NAMES.DAILY_LIKE]: getQueue(QUEUE_NAMES.DAILY_LIKE, bullConn),
    [QUEUE_NAMES.CHAT_ARCHIVE]: getQueue(QUEUE_NAMES.CHAT_ARCHIVE, bullConn),
    [QUEUE_NAMES.ENSURE_PARTITIONS]: getQueue(QUEUE_NAMES.ENSURE_PARTITIONS, bullConn),
  }

  // 10. 生命周期编排器：按拓扑顺序启动所有业务模块
  const orchestrator = new LifecycleOrchestrator()
  const infraServices: Record<string, unknown> = {
    db: mainDb,
    chat_db: chatDb,
    cache: cacheClient,
    persistent: persistentClient,
    cache_redis: cacheRedis,
    persistent_redis: persistentRedis,
    bot_api: botApi,
    conn_mgr: connMgr,
    dispatcher,
    scanner,
    rpc_consumer: rpcConsumer,
    queues,
  }

  const allServices = await orchestrator.startup(infraServices, getAllStartups())

  // 11. 构建 ServiceRegistry（API 路由通过 app.state.serviceRegistry 访问业务服务）
  const serviceRegistry = new ServiceRegistry()
  for (const [key, value] of Object.entries(allServices)) {
    serviceRegistry.register(key, value)
  }
  serviceRegistry.freeze()

  // 13. 注册 RPC handler（打卡服务在 @Startup 注册完毕后才能访问）
  const dailyCheckinSvc = allServices.daily_checkin_service as DailyCheckinService | undefined
  if (dailyCheckinSvc !== undefined) {
    rpcConsumer.registerHandler('request_checkin', async (params) => {
      const source = (params.source as string | undefined) ?? 'scheduled'
      dailyCheckinSvc.requestCheckin(source === 'ws_connect' ? 'ws_connect' : 'scheduled')
      return { triggered: true }
    })
  }

  // 点赞 RPC handler
  const likeSvc = allServices.like_service as { runScheduledLikes(): boolean } | undefined
  if (likeSvc !== undefined) {
    rpcConsumer.registerHandler('request_like', async (_params) => {
      likeSvc.runScheduledLikes()
      return { triggered: true }
    })
  }

  // 14. 启动 RPC Consumer
  await rpcConsumer.start()

  // 15. 将所有服务挂载到 app.state
  const state = getState(app)
  Object.assign(state, {
    mainDb,
    chatDb,
    cacheRedis,
    persistentRedis,
    cacheClient,
    persistentClient,
    botApi,
    connMgr,
    dispatcher,
    scanner,
    rpcConsumer,
    queues,
    serviceRegistry,
    ...allServices,
  })

  app.log.info(`Aemeath 已启动，等待 NapCat 连接 (host=${config.HOST} port=${String(config.PORT)})`)
}

// ── 关闭逻辑 ──

async function _shutdown(app: FastifyInstance): Promise<void> {
  app.log.info('Aemeath 正在关闭...')

  const state = getState(app)

  // 停止 RPC Consumer
  await state.rpcConsumer.stop()

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
  const queues = state.queues as Record<string, { close(): Promise<void> }>
  await Promise.all(Object.values(queues).map((q) => q.close()))

  app.log.info('Aemeath 已停止')
}
