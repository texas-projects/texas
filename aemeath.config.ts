import { defineConfig } from '@/core/echo/config.js'

export default defineConfig({
  app: {
    /** Redis cache key 命名空间前缀 */
    cacheKeyPrefix: 'aemeath:',
    /** BullMQ 主任务队列名 */
    queueName: 'aemeath-tasks',
    /** Worker 心跳 Redis key 前缀 */
    heartbeatKeyPrefix: 'aemeath:worker:heartbeat',
    /** 命令触发前缀 */
    commandPrefix: '/',
    /** 定时任务默认时区 */
    defaultTimezone: 'Asia/Shanghai',
    /** 交互式会话默认超时（秒） */
    sessionTimeout: 300,
  },
  echoes: {
    handler: ['src/handlers'],
    service: ['src/services'],
    task: ['src/tasks'],
    route: {
      dirs: ['src/apis'],
      exclude: ['**/schemas/**', '**/plugins/**'],
    },
  },
})
