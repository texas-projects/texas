/**
 * 状态机单元测试。
 */

import { describe, expect, it, vi } from 'vitest'

import type { SessionContext } from '@/core/session/context.js'
import {
  InvalidTransitionError,
  StateMachine,
  StateMachineError,
} from '@/core/session/state-machine.js'
import { makeState } from '@/core/session/state.js'

// ── 测试辅助：伪 SessionContext ──

function makeContext(input: string | null = null): SessionContext {
  return {
    input,
    currentState: '',
    reply: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    getPlaintext: vi.fn().mockReturnValue(input ?? ''),
    popConfirmConfig: vi.fn().mockReturnValue(null),
    confirmTransition: vi.fn().mockReturnValue('__confirm___target'),
  } as unknown as SessionContext
}

// ── 基础状态机创建 ──

describe('StateMachine 创建', () => {
  it('应正确设置初始状态', () => {
    const states = [
      makeState('step1', {}, { isFinal: false }),
      makeState('step2', {}, { isFinal: false }),
    ]
    const sm = new StateMachine(states, 'step1')
    expect(sm.initialState).toBe('step1')
    expect(sm.currentState).toBeNull()
    expect(sm.isFinished).toBe(false)
  })

  it('未指定初始状态时应取第一个状态', () => {
    const states = [makeState('first'), makeState('second')]
    const sm = new StateMachine(states)
    expect(sm.initialState).toBe('first')
  })

  it('空状态列表时 initialState 应为 null', () => {
    const sm = new StateMachine([])
    expect(sm.initialState).toBeNull()
  })
})

// ── start ──

describe('StateMachine.start', () => {
  it('应进入初始状态并调用 onEnter', async () => {
    const onEnter = vi.fn().mockResolvedValue(undefined)
    const states = [makeState('init', { onEnter })]
    const sm = new StateMachine(states, 'init')
    const ctx = makeContext()
    await sm.start(ctx)
    expect(sm.currentState).toBe('init')
    expect(onEnter).toHaveBeenCalledOnce()
    expect(onEnter).toHaveBeenCalledWith(ctx)
    expect(ctx.currentState).toBe('init')
  })

  it('初始状态未设置时应抛出 StateMachineError', async () => {
    const sm = new StateMachine([])
    const ctx = makeContext()
    await expect(sm.start(ctx)).rejects.toBeInstanceOf(StateMachineError)
  })

  it('初始状态为 final 时不应继续进入子状态', async () => {
    const onEnter = vi.fn().mockResolvedValue(undefined)
    const states = [makeState('done', { onEnter }, { isFinal: true })]
    const sm = new StateMachine(states, 'done')
    const ctx = makeContext()
    await sm.start(ctx)
    expect(sm.currentState).toBe('done')
    expect(sm.isFinished).toBe(true)
  })
})

// ── 状态转换 ──

describe('StateMachine.transitionTo', () => {
  it('应转换到目标状态并调用 onExit 和 onEnter', async () => {
    const onExit = vi.fn().mockResolvedValue(undefined)
    const onEnterB = vi.fn().mockResolvedValue(undefined)
    const states = [makeState('a', { onExit }), makeState('b', { onEnter: onEnterB })]
    const sm = new StateMachine(states, 'a')
    const ctx = makeContext()
    await sm.start(ctx)
    await sm.transitionTo('b', ctx)
    expect(sm.currentState).toBe('b')
    expect(onExit).toHaveBeenCalledOnce()
    expect(onEnterB).toHaveBeenCalledOnce()
  })

  it('目标状态不存在时应抛出 InvalidTransitionError', async () => {
    const states = [makeState('a')]
    const sm = new StateMachine(states, 'a')
    const ctx = makeContext()
    await sm.start(ctx)
    await expect(sm.transitionTo('nonexistent', ctx)).rejects.toBeInstanceOf(InvalidTransitionError)
  })
})

// ── processInput ──

describe('StateMachine.processInput', () => {
  it('使用 onInput 处理输入并转换状态', async () => {
    const onEnterB = vi.fn().mockResolvedValue(undefined)
    const states = [
      makeState('a', {
        onInput: async (_ctx) => 'b',
      }),
      makeState('b', { onEnter: onEnterB }),
    ]
    const sm = new StateMachine(states, 'a')
    const ctx = makeContext('hello')
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBe('b')
    expect(sm.currentState).toBe('b')
    expect(onEnterB).toHaveBeenCalledOnce()
  })

  it('onInput 返回 null 时应停留当前状态', async () => {
    const states = [
      makeState('a', {
        onInput: async (_ctx) => null,
      }),
    ]
    const sm = new StateMachine(states, 'a')
    const ctx = makeContext('anything')
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBeNull()
    expect(sm.currentState).toBe('a')
  })

  it('final 状态调用 processInput 应返回 null', async () => {
    const states = [makeState('done', {}, { isFinal: true })]
    const sm = new StateMachine(states, 'done')
    const ctx = makeContext()
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBeNull()
  })

  it('状态机未启动时应抛出 StateMachineError', async () => {
    const states = [makeState('a')]
    const sm = new StateMachine(states, 'a')
    const ctx = makeContext()
    await expect(sm.processInput(ctx)).rejects.toBeInstanceOf(StateMachineError)
  })
})

// ── addState / getState ──

describe('StateMachine.addState / getState', () => {
  it('addState 后应可用 getState 取到', () => {
    const sm = new StateMachine([])
    const s = makeState('test')
    sm.addState(s)
    expect(sm.getState('test')).toBe(s)
  })

  it('不存在的状态 getState 应返回 undefined', () => {
    const sm = new StateMachine([])
    expect(sm.getState('missing')).toBeUndefined()
  })
})

// ── addTransition ──

describe('StateMachine.addTransition', () => {
  it('为存在的状态添加转换后，processInput 应可触发', async () => {
    const onEnterB = vi.fn().mockResolvedValue(undefined)
    const states = [makeState('a'), makeState('b', { onEnter: onEnterB })]
    const sm = new StateMachine(states, 'a')
    sm.addTransition('a', { target: 'b', event: 'go' })
    const ctx = makeContext('go')
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBe('b')
    expect(sm.currentState).toBe('b')
  })

  it('向不存在的状态添加转换应抛出 StateMachineError', () => {
    const sm = new StateMachine([])
    expect(() => {
      sm.addTransition('nonexistent', { target: 'x' })
    }).toThrow(StateMachineError)
  })
})

// ── isFinished ──

describe('StateMachine.isFinished', () => {
  it('到达 final 状态后 isFinished 应为 true', async () => {
    const states = [
      makeState('start', {
        onInput: async (_ctx) => 'done',
      }),
      makeState('done', {}, { isFinal: true }),
    ]
    const sm = new StateMachine(states, 'start')
    const ctx = makeContext('anything')
    await sm.start(ctx)
    expect(sm.isFinished).toBe(false)
    await sm.processInput(ctx)
    expect(sm.isFinished).toBe(true)
  })

  it('初始状态非 final 时 isFinished 应为 false', async () => {
    const states = [makeState('start')]
    const sm = new StateMachine(states, 'start')
    const ctx = makeContext()
    await sm.start(ctx)
    expect(sm.isFinished).toBe(false)
  })
})

// ── iterStates ──

describe('StateMachine.iterStates', () => {
  it('应遍历所有已注册的状态', () => {
    const states = [makeState('a'), makeState('b'), makeState('c')]
    const sm = new StateMachine(states)
    const names = [...sm.iterStates()].map((s) => s.name)
    expect(names).toEqual(['a', 'b', 'c'])
  })
})

// ── 守卫条件 ──

describe('StateMachine 守卫条件', () => {
  it('guard 返回 false 时不应执行转换', async () => {
    const states = [makeState('a'), makeState('b')]
    const sm = new StateMachine(states, 'a')
    sm.addTransition('a', {
      target: 'b',
      event: 'go',
      guard: async (_ctx) => false,
    })
    const ctx = makeContext('go')
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBeNull()
    expect(sm.currentState).toBe('a')
  })

  it('guard 返回 true 时应执行转换', async () => {
    const states = [makeState('a'), makeState('b')]
    const sm = new StateMachine(states, 'a')
    sm.addTransition('a', {
      target: 'b',
      event: 'go',
      guard: async (_ctx) => true,
    })
    const ctx = makeContext('go')
    await sm.start(ctx)
    const result = await sm.processInput(ctx)
    expect(result).toBe('b')
  })
})
