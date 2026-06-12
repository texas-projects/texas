/**
 * SessionManager 单元测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Context } from '@/core/dispatch/context.js'
import type { RedisStore } from '@/core/redis/store.js'
import { InteractiveSession } from '@/core/session/base.js'
import type { SessionData } from '@/core/session/base.js'
import type { SessionContext } from '@/core/session/context.js'
import { SessionManager } from '@/core/session/manager.js'
import { makeState } from '@/core/session/state.js'
import type { State } from '@/core/session/state.js'

// ── Mock CacheClient ──

function makeMockCache() {
  const cache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(undefined),
    getOrSet: vi.fn().mockResolvedValue(null),
    deleteByPattern: vi.fn().mockResolvedValue(0),
  }
  return cache as unknown as RedisStore & typeof cache
}

// ── Mock Context ──

function makeMockContext(userId = 12345, groupId?: number) {
  const ctx = {
    userId,
    groupId,
    messageId: 1,
    event: {},
    bot: {},
    isGroupEvent: () => groupId !== undefined,
    isPrivateEvent: () => groupId === undefined,
    getPlaintext: vi.fn().mockReturnValue(''),
    reply: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn(),
    recall: vi.fn(),
    getService: vi.fn(),
    hasService: vi.fn().mockReturnValue(false),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
    setRegexMatch: vi.fn(),
    getRegexMatch: vi.fn().mockReturnValue(null),
    getArgs: vi.fn().mockReturnValue([]),
    getArgStr: vi.fn().mockReturnValue(''),
  }
  return ctx as unknown as Context & typeof ctx
}

// ── 简单的测试会话 ──

interface SimpleData extends SessionData {
  step: string
}

class SimpleSession extends InteractiveSession<SimpleData> {
  override data: SimpleData = { step: '' }

  override async buildStates(): Promise<State[]> {
    return [
      makeState('ask', {
        onEnter: async (ctx: SessionContext): Promise<void> => {
          await ctx.reply('请输入内容')
        },
        onInput: async (_ctx: SessionContext): Promise<string | null> => {
          this.data.step = 'done'
          return 'finish'
        },
      }),
      makeState('finish', {}, { isFinal: true }),
    ]
  }
}

// ── SessionManager 基础测试 ──

describe('SessionManager._buildSessionKey', () => {
  it('私聊应生成 private 后缀的 key', () => {
    const key = SessionManager._buildSessionKey(12345)
    expect(key).toBe('user:12345:source:private')
  })

  it('群聊应包含 group_id', () => {
    const key = SessionManager._buildSessionKey(12345, 99999)
    expect(key).toBe('user:12345:source:99999')
  })
})

describe('SessionManager.isCancelCommand', () => {
  it('/取消 应被识别为取消命令', () => {
    expect(SessionManager.isCancelCommand('/取消')).toBe(true)
  })

  it('/cancel 应被识别为取消命令', () => {
    expect(SessionManager.isCancelCommand('/cancel')).toBe(true)
  })

  it('普通文本不应被识别为取消命令', () => {
    expect(SessionManager.isCancelCommand('hello')).toBe(false)
  })

  it('带空格的取消命令应被正确处理', () => {
    expect(SessionManager.isCancelCommand('  /取消  ')).toBe(true)
  })
})

// ── startSession ──

describe('SessionManager.startSession', () => {
  let cache: ReturnType<typeof makeMockCache>
  let manager: SessionManager

  beforeEach(() => {
    cache = makeMockCache()
    manager = new SessionManager(cache)
  })

  it('应成功启动会话并写入 Redis', async () => {
    const ctx = makeMockContext(12345, 99999)
    const result = await manager.startSession(SimpleSession, ctx)
    expect(result).toBe(true)
    expect(manager.getActiveSessionCount()).toBe(1)
    expect(cache.set).toHaveBeenCalled()
  })

  it('同一用户同一来源重复启动应返回 false 并提示', async () => {
    const ctx = makeMockContext(12345, 99999)
    const first = await manager.startSession(SimpleSession, ctx)
    expect(first).toBe(true)
    const second = await manager.startSession(SimpleSession, ctx)
    expect(second).toBe(false)
    expect(ctx.reply).toHaveBeenCalled()
  })

  it('不同群的同一用户应允许各自的会话', async () => {
    const ctx1 = makeMockContext(12345, 11111)
    const ctx2 = makeMockContext(12345, 22222)
    const r1 = await manager.startSession(SimpleSession, ctx1)
    const r2 = await manager.startSession(SimpleSession, ctx2)
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(manager.getActiveSessionCount()).toBe(2)
  })

  it('Redis 有残留时应先清理', async () => {
    cache.exists.mockResolvedValue(true)
    const ctx = makeMockContext(12345)
    await manager.startSession(SimpleSession, ctx)
    expect(cache.del).toHaveBeenCalled()
  })
})

// ── getActiveSessionKey ──

describe('SessionManager.getActiveSessionKey', () => {
  it('无活跃会话时应返回 null', () => {
    const manager = new SessionManager(makeMockCache())
    expect(manager.getActiveSessionKey(12345)).toBeNull()
  })

  it('有活跃会话时应返回 key', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    const ctx = makeMockContext(12345, 99999)
    await manager.startSession(SimpleSession, ctx)
    const key = manager.getActiveSessionKey(12345, 99999)
    expect(key).toBe('user:12345:source:99999')
  })
})

// ── cancelSession ──

describe('SessionManager.cancelSession', () => {
  it('应取消会话并清理 Redis', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    const ctx = makeMockContext(12345, 99999)
    await manager.startSession(SimpleSession, ctx)
    const key = manager.getActiveSessionKey(12345, 99999)
    expect(key).not.toBeNull()

    const result = await manager.cancelSession(key!)
    expect(result).toBe(true)
    expect(manager.getActiveSessionCount()).toBe(0)
    expect(cache.del).toHaveBeenCalled()
  })

  it('不存在的 key 取消应返回 false', async () => {
    const manager = new SessionManager(makeMockCache())
    const result = await manager.cancelSession('nonexistent')
    expect(result).toBe(false)
  })
})

// ── dispatchInput ──

describe('SessionManager.dispatchInput', () => {
  it('应将输入路由到活跃会话', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    const ctx = makeMockContext(12345, 99999)
    await manager.startSession(SimpleSession, ctx)
    const key = manager.getActiveSessionKey(12345, 99999)
    expect(key).not.toBeNull()
    // 模拟用户输入
    ctx.getPlaintext.mockReturnValue('hello')

    const dispatched = await manager.dispatchInput(key!, ctx)
    expect(dispatched).toBe(true)
  })

  it('不存在的 key 应返回 false', async () => {
    const manager = new SessionManager(makeMockCache())
    const ctx = makeMockContext()
    const result = await manager.dispatchInput('nonexistent', ctx)
    expect(result).toBe(false)
  })

  it('会话完成后应自动清理', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    const ctx = makeMockContext(12345, 99999)
    await manager.startSession(SimpleSession, ctx)
    const key = manager.getActiveSessionKey(12345, 99999)
    expect(key).not.toBeNull()
    ctx.getPlaintext.mockReturnValue('anything')

    await manager.dispatchInput(key!, ctx)
    // 到达 final 状态后，会话应被清理
    expect(manager.getActiveSessionCount()).toBe(0)
  })
})

// ── cancelAllSessions ──

describe('SessionManager.cancelAllSessions', () => {
  it('应取消所有活跃会话', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    await manager.startSession(SimpleSession, makeMockContext(1, 1))
    await manager.startSession(SimpleSession, makeMockContext(2, 2))
    expect(manager.getActiveSessionCount()).toBe(2)
    const count = await manager.cancelAllSessions()
    expect(count).toBe(2)
    expect(manager.getActiveSessionCount()).toBe(0)
  })
})

// ── close ──

describe('SessionManager.close', () => {
  it('close 后活跃会话数应为 0', async () => {
    const cache = makeMockCache()
    const manager = new SessionManager(cache)
    await manager.startSession(SimpleSession, makeMockContext(99, 1))
    await manager.close()
    expect(manager.getActiveSessionCount()).toBe(0)
  })
})
