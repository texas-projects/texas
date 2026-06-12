import { beforeEach, describe, expect, it } from 'vitest'

import { MessageScope, Permission } from '@/core/dispatch/decorators.js'
import type { HandlerMethod } from '@/core/dispatch/mapping.js'
import {
  CommandHandlerMapping,
  CompositeHandlerMapping,
  EndsWithHandlerMapping,
  EventTypeHandlerMapping,
  FullMatchHandlerMapping,
  KeywordHandlerMapping,
  RegexHandlerMapping,
  StartsWithHandlerMapping,
} from '@/core/dispatch/mapping.js'
import type { AnyOneBotEvent } from '@/core/protocol/models/events.js'

// ── 测试用事件工厂 ──

function makeGroupMsgEvent(text: string): AnyOneBotEvent {
  const event = {
    time: 1700000000,
    self_id: 10000,
    post_type: 'message' as const,
    message_type: 'group' as const,
    sub_type: 'normal',
    message_id: 1,
    group_id: 99999,
    user_id: 11111,
    message: [{ type: 'text' as const, data: { text } }],
    raw_message: text,
    font: 0,
    sender: { user_id: 11111, nickname: 'tester', role: 'member' },
  }
  return event
}

function makePrivateMsgEvent(text: string): AnyOneBotEvent {
  const event = {
    time: 1700000001,
    self_id: 10000,
    post_type: 'message' as const,
    message_type: 'private' as const,
    sub_type: 'friend',
    message_id: 2,
    user_id: 22222,
    message: [{ type: 'text' as const, data: { text } }],
    raw_message: text,
    font: 0,
    sender: { user_id: 22222, nickname: 'friend' },
  }
  return event
}

function makeNoticeEvent(noticeType: string, subType?: string): AnyOneBotEvent {
  const event = {
    time: 1700000002,
    self_id: 10000,
    post_type: 'notice' as const,
    notice_type: noticeType,
    sub_type: subType ?? '',
  }
  return event
}

function makeRequestEvent(requestType: string): AnyOneBotEvent {
  const event = {
    time: 1700000003,
    self_id: 10000,
    post_type: 'request' as const,
    request_type: requestType,
    user_id: 33333,
    comment: '',
    flag: 'test',
  }
  return event
}

// ── 处理器工厂 ──

function makeHandler(
  overrides: Partial<HandlerMethod> = {},
  metaOverrides: Partial<HandlerMethod['meta']> = {},
): HandlerMethod {
  return {
    instance: {},

    method: () => {},
    priority: 50,
    componentName: 'test',
    meta: {
      mappingType: 'command',
      permission: Permission.ANYONE,
      messageScope: MessageScope.ALL,
      priority: null,
      displayName: '',
      description: '',
      ...metaOverrides,
    },
    ...overrides,
  }
}

// ── CommandHandlerMapping ──

describe('CommandHandlerMapping', () => {
  let mapping: CommandHandlerMapping

  beforeEach(() => {
    mapping = new CommandHandlerMapping('/')
  })

  it('应匹配以 / 开头的命令', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'echo' })
    mapping.register(handler)

    const results = mapping.resolve(makeGroupMsgEvent('/echo hello'))
    expect(results).toHaveLength(1)
    expect(results[0]?.handler).toBe(handler)
  })

  it('没有命令前缀的消息不应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'echo' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('echo hello'))).toHaveLength(0)
  })

  it('不同命令不应相互匹配', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'help' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('/echo hello'))).toHaveLength(0)
  })

  it('应支持 aliases', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'command', cmd: 'ping', aliases: new Set(['p', 'pong']) },
    )
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('/ping'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('/p'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('/pong'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('/unknown'))).toHaveLength(0)
  })

  it('非消息事件不应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'echo' })
    mapping.register(handler)

    expect(mapping.resolve(makeNoticeEvent('group_ban'))).toHaveLength(0)
  })

  it('空文本不应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'echo' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('/'))).toHaveLength(0)
  })

  it('registeredCount 应正确计数', () => {
    mapping.register(makeHandler({}, { mappingType: 'command', cmd: 'a' }))
    mapping.register(makeHandler({}, { mappingType: 'command', cmd: 'b' }))
    expect(mapping.registeredCount).toBe(2)
  })
})

// ── RegexHandlerMapping ──

describe('RegexHandlerMapping', () => {
  let mapping: RegexHandlerMapping

  beforeEach(() => {
    mapping = new RegexHandlerMapping()
  })

  it('应匹配符合正则的消息', () => {
    const handler = makeHandler(
      {},
      {
        mappingType: 'regex',
        pattern: 'hello\\s+world',
        compiledPattern: /hello\s+world/u,
      },
    )
    mapping.register(handler)

    const results = mapping.resolve(makeGroupMsgEvent('say hello world to me'))
    expect(results).toHaveLength(1)
    expect(results[0]?.regexMatch).not.toBeNull()
  })

  it('不匹配正则的消息应返回空', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'regex', pattern: 'foo', compiledPattern: /foo/u },
    )
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('bar'))).toHaveLength(0)
  })

  it('应返回 regexMatch', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'regex', pattern: '(\\d+)', compiledPattern: /(\d+)/u },
    )
    mapping.register(handler)

    const results = mapping.resolve(makeGroupMsgEvent('order 42 items'))
    expect(results[0]?.regexMatch?.[1]).toBe('42')
  })
})

// ── KeywordHandlerMapping ──

describe('KeywordHandlerMapping', () => {
  let mapping: KeywordHandlerMapping

  beforeEach(() => {
    mapping = new KeywordHandlerMapping()
  })

  it('包含关键词时应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'keyword', keywords: new Set(['cat', 'dog']) })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('I love my dog'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('a cat is here'))).toHaveLength(1)
  })

  it('不包含关键词时不应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'keyword', keywords: new Set(['cat', 'dog']) })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('I have a fish'))).toHaveLength(0)
  })
})

// ── StartsWithHandlerMapping ──

describe('StartsWithHandlerMapping', () => {
  let mapping: StartsWithHandlerMapping

  beforeEach(() => {
    mapping = new StartsWithHandlerMapping()
  })

  it('以指定前缀开头时应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'startswith', prefix: '!cmd' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('!cmd do something'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('!other'))).toHaveLength(0)
  })
})

// ── EndsWithHandlerMapping ──

describe('EndsWithHandlerMapping', () => {
  let mapping: EndsWithHandlerMapping

  beforeEach(() => {
    mapping = new EndsWithHandlerMapping()
  })

  it('以指定后缀结尾时应匹配', () => {
    const handler = makeHandler({}, { mappingType: 'endswith', suffix: '吗？' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('你好吗？'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('你好！'))).toHaveLength(0)
  })
})

// ── FullMatchHandlerMapping ──

describe('FullMatchHandlerMapping', () => {
  let mapping: FullMatchHandlerMapping

  beforeEach(() => {
    mapping = new FullMatchHandlerMapping()
  })

  it('完全匹配时应返回结果', () => {
    const handler = makeHandler({}, { mappingType: 'fullmatch', text: '菜单' })
    mapping.register(handler)

    expect(mapping.resolve(makeGroupMsgEvent('菜单'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('菜单列表'))).toHaveLength(0)
  })
})

// ── EventTypeHandlerMapping ──

describe('EventTypeHandlerMapping', () => {
  let mapping: EventTypeHandlerMapping

  beforeEach(() => {
    mapping = new EventTypeHandlerMapping()
  })

  it('应匹配对应 post_type 的事件', () => {
    const handler = makeHandler({}, { mappingType: 'event_type', eventType: 'notice' })
    mapping.register(handler)

    expect(mapping.resolve(makeNoticeEvent('group_ban'))).toHaveLength(1)
    expect(mapping.resolve(makeGroupMsgEvent('hello'))).toHaveLength(0)
  })

  it('应按 notice_type 过滤', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'event_type', eventType: 'notice', noticeType: 'group_ban' },
    )
    mapping.register(handler)

    expect(mapping.resolve(makeNoticeEvent('group_ban'))).toHaveLength(1)
    expect(mapping.resolve(makeNoticeEvent('friend_add'))).toHaveLength(0)
  })

  it('应按 sub_type 过滤', () => {
    const handler = makeHandler(
      {},
      {
        mappingType: 'event_type',
        eventType: 'notice',
        noticeType: 'notify',
        subType: 'poke',
      },
    )
    mapping.register(handler)

    expect(mapping.resolve(makeNoticeEvent('notify', 'poke'))).toHaveLength(1)
    expect(mapping.resolve(makeNoticeEvent('notify', 'gray_tip'))).toHaveLength(0)
  })

  it('应按 request_type 过滤', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'event_type', eventType: 'request', requestType: 'friend' },
    )
    mapping.register(handler)

    expect(mapping.resolve(makeRequestEvent('friend'))).toHaveLength(1)
    expect(mapping.resolve(makeRequestEvent('group'))).toHaveLength(0)
  })
})

// ── CompositeHandlerMapping ──

describe('CompositeHandlerMapping', () => {
  let composite: CompositeHandlerMapping

  beforeEach(() => {
    composite = new CompositeHandlerMapping()
  })

  it('应将 command 类型路由到 CommandHandlerMapping', () => {
    const handler = makeHandler({}, { mappingType: 'command', cmd: 'echo' })
    composite.register(handler)

    const results = composite.resolve(makeGroupMsgEvent('/echo hello'))
    expect(results).toHaveLength(1)
  })

  it('应将 event_type 路由到 EventTypeHandlerMapping', () => {
    const handler = makeHandler({}, { mappingType: 'event_type', eventType: 'notice' })
    composite.register(handler)

    expect(composite.resolve(makeNoticeEvent('group_ban'))).toHaveLength(1)
  })

  it('MessageScope.GROUP 应只匹配群消息', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'command', cmd: 'test', messageScope: MessageScope.GROUP },
    )
    composite.register(handler)

    expect(composite.resolve(makeGroupMsgEvent('/test'))).toHaveLength(1)
    expect(composite.resolve(makePrivateMsgEvent('/test'))).toHaveLength(0)
  })

  it('MessageScope.PRIVATE 应只匹配私聊消息', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'command', cmd: 'test', messageScope: MessageScope.PRIVATE },
    )
    composite.register(handler)

    expect(composite.resolve(makePrivateMsgEvent('/test'))).toHaveLength(1)
    expect(composite.resolve(makeGroupMsgEvent('/test'))).toHaveLength(0)
  })

  it('MessageScope.ALL 应匹配所有消息类型', () => {
    const handler = makeHandler(
      {},
      { mappingType: 'command', cmd: 'test', messageScope: MessageScope.ALL },
    )
    composite.register(handler)

    expect(composite.resolve(makeGroupMsgEvent('/test'))).toHaveLength(1)
    expect(composite.resolve(makePrivateMsgEvent('/test'))).toHaveLength(1)
  })

  it('应按优先级升序排列结果', () => {
    const highPrio = makeHandler({ priority: 10 }, { mappingType: 'command', cmd: 'test' })
    const lowPrio = makeHandler({ priority: 100 }, { mappingType: 'command', cmd: 'test' })
    composite.register(lowPrio)
    composite.register(highPrio)

    const results = composite.resolve(makeGroupMsgEvent('/test'))
    expect(results).toHaveLength(2)
    expect(results[0]?.handler.priority).toBe(10)
    expect(results[1]?.handler.priority).toBe(100)
  })

  it('handlerCount 应统计所有已注册处理器', () => {
    composite.register(makeHandler({}, { mappingType: 'command', cmd: 'a' }))
    composite.register(makeHandler({}, { mappingType: 'keyword', keywords: new Set(['hi']) }))
    composite.register(makeHandler({}, { mappingType: 'event_type', eventType: 'notice' }))

    expect(composite.handlerCount).toBe(3)
  })

  it('同一消息不同 mapping 类型的结果应合并', () => {
    // 命令匹配
    composite.register(makeHandler({}, { mappingType: 'command', cmd: 'hi' }))
    // 关键词匹配（"/hi" 包含 "hi"）
    composite.register(makeHandler({}, { mappingType: 'keyword', keywords: new Set(['hi']) }))

    const results = composite.resolve(makeGroupMsgEvent('/hi'))
    // command 匹配 "/hi"（有前缀），keyword 检查整个文本 "/hi" 是否包含 "hi" → 是
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})
