/**
 * Prisma 客户端工厂与扩展工具。
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient as ChatPrismaClient } from '#prisma/chat'
import { PrismaClient as MainPrismaClient, Prisma as MainPrisma } from '#prisma/main'

export type { ChatPrismaClient, MainPrismaClient }

// ────────────────────────────────────────────
//  BigInt JSON 序列化
// ────────────────────────────────────────────

/**
 * 全局注册 BigInt.prototype.toJSON，使 JSON.stringify 自动将 BigInt 转为 number。
 *
 * QQ 号最大值远小于 Number.MAX_SAFE_INTEGER (2^53 - 1)，直接转换安全可靠。
 * 放在模块顶层确保 import 即生效。
 */
declare global {
  interface BigInt {
    toJSON(): number
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (!BigInt.prototype.toJSON) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint): number {
      return Number(this)
    },
    writable: true,
    configurable: true,
  })
}

// ────────────────────────────────────────────
//  工厂函数
// ────────────────────────────────────────────

/**
 * 创建主库 Prisma Client 实例。
 *
 * @param url - PostgreSQL 连接字符串（DATABASE_URL）
 * @param poolSize - 可选，连接池最大连接数
 */
export function createMainDb(url: string, poolSize?: number): MainPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, max: poolSize })
  return new MainPrismaClient({ adapter })
}

/**
 * 创建聊天库 Prisma Client 实例。
 *
 * @param url - PostgreSQL 连接字符串（CHAT_DATABASE_URL）
 * @param poolSize - 可选，连接池最大连接数
 */
export function createChatDb(url: string, poolSize?: number): ChatPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, max: poolSize })
  return new ChatPrismaClient({ adapter })
}

// ────────────────────────────────────────────
//  Prisma 错误类型守卫
// ────────────────────────────────────────────

interface PrismaKnownError {
  code: string
  meta?: Record<string, unknown>
  message: string
}

/**
 * 判断 catch 到的 unknown 错误是否为 Prisma 已知请求错误。
 *
 * TypeScript 6 下 `export import` 别名无法用于 `instanceof` 类型收窄，
 * 故封装为类型谓词函数。
 */
export function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return err instanceof MainPrisma.PrismaClientKnownRequestError
}

/** 默认慢查询阈值（毫秒）。 */
const DEFAULT_THRESHOLD_MS = 200

/** 日志函数签名，兼容 Pino / console 等。 */
interface SlowQueryLogger {
  warn: (msg: string, ...args: unknown[]) => void
}

/**
 * 为 Prisma Client 添加慢查询日志扩展。
 *
 * 使用 `$extends` 的 `query.$allOperations` 拦截所有数据库操作，
 * 当执行时间超过阈值时通过 logger 输出警告。
 *
 * @param client - Prisma Client 实例（主库或聊天库均可）
 * @param logger - 日志对象，需实现 warn 方法（默认 console）
 * @param thresholdMs - 慢查询阈值，超过此值记录警告（默认 200ms）
 * @returns 包装后的 Prisma Client（类型与原始 client 一致）
 *
 * @example
 * ```ts
 * const db = createMainDb(config.DATABASE_URL)
 * const dbWithLogging = withSlowQueryLogging(db, console, 100)
 * ```
 */
export function withSlowQueryLogging<T extends { $extends: (extension: unknown) => unknown }>(
  client: T,
  logger: SlowQueryLogger = console,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): T {
  const extension = MainPrisma.defineExtension({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        const start = performance.now()
        const result: unknown = await query(args)
        const elapsed = performance.now() - start

        if (elapsed > thresholdMs) {
          logger.warn(
            `[SlowQuery] ${model ?? 'unknown'}.${operation} took ${elapsed.toFixed(1)}ms (threshold: ${String(thresholdMs)}ms)`,
          )
        }

        return result
      },
    },
  })

  return client.$extends(extension) as T
}
