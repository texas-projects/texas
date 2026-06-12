/**
 * HandlerMapping —— 将事件路由到处理器方法（TypeScript 移植自 mapping.py）。
 */

import type { Context } from './context.js'
import type { HandlerMeta } from './decorators.js'

import type { AnyOneBotEvent } from '@/core/protocol/models/events.js'
import { extractPlaintext } from '@/core/protocol/utils.js'

// ── FeatureChecker 接口 ──

/** 功能开关检查器接口（供 dispatch 层使用，由 settings 层实现）。 */
export interface FeatureChecker {
  check(ctx: Context): Promise<boolean>
}

// ── 数据结构 ──

/** 封装已注册的处理器方法及其上下文。 */
export interface HandlerMethod {
  /** 处理器所在类的实例。 */
  instance: object
  /** 未绑定的方法函数（调用时需 bind(instance)）。 */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  method: Function
  /** 优先级（越小越先执行）。 */
  priority: number
  /** 来自 @Component 的组件名称。 */
  componentName: string
  /** 方法级元数据（来自 OnCommand 等装饰器）。 */
  meta: HandlerMeta
}

/** resolve() 的结果单元 —— 包含匹配到的处理器及本次匹配上下文。 */
export interface ResolvedHandler {
  handler: HandlerMethod
  /** 正则匹配结果（仅 RegexHandlerMapping 设置）。 */
  regexMatch: RegExpMatchArray | null
}

// ── 类型守卫 ──

function isMessageEvent(event: AnyOneBotEvent): boolean {
  return event.post_type === 'message' || event.post_type === 'message_sent'
}

function isGroupMessageEvent(event: AnyOneBotEvent): boolean {
  return isMessageEvent(event) && (event as Record<string, unknown>).message_type === 'group'
}

// ── HandlerMapping 接口 ──

interface HandlerMapping {
  register(handler: HandlerMethod): void
  resolve(event: AnyOneBotEvent): ResolvedHandler[]
}

// ── 具体映射实现 ──

/** 通过命令前缀匹配消息文本（例如 /echo、/help）。 */
export class CommandHandlerMapping implements HandlerMapping {
  private readonly prefix: string
  private readonly handlers = new Map<string, HandlerMethod[]>()

  constructor(commandPrefix = '/') {
    this.prefix = commandPrefix
  }

  register(handler: HandlerMethod): void {
    const { cmd = '', aliases = new Set<string>() } = handler.meta
    const allNames = new Set([cmd, ...aliases])
    for (const name of allNames) {
      // 剥离命令前缀，确保与 resolve() 的查找键一致
      const key = name.startsWith(this.prefix) ? name.slice(this.prefix.length) : name
      const list = this.handlers.get(key) ?? []
      list.push(handler)
      this.handlers.set(key, list)
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    if (!text.startsWith(this.prefix)) return []
    const afterPrefix = text.slice(this.prefix.length)
    const cmdName = afterPrefix.split(/\s/u)[0] ?? ''
    const matches = this.handlers.get(cmdName) ?? []
    return matches.map((h) => ({ handler: h, regexMatch: null }))
  }

  /** 已注册的处理器总数（跨所有命令键）。 */
  get registeredCount(): number {
    let count = 0
    for (const list of this.handlers.values()) {
      count += list.length
    }
    return count
  }
}

/** 通过正则表达式匹配消息文本。 */
export class RegexHandlerMapping implements HandlerMapping {
  private readonly handlers: [RegExp, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const pattern = handler.meta.compiledPattern
    if (pattern) {
      this.handlers.push([pattern, handler])
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    const results: ResolvedHandler[] = []
    for (const [pattern, handler] of this.handlers) {
      const match = text.match(pattern)
      if (match) {
        // 每次 resolve 独立创建结果，避免并发竞态（多事件同时 resolve 同一正则 handler）
        results.push({ handler, regexMatch: match })
      }
    }
    return results
  }

  get registeredCount(): number {
    return this.handlers.length
  }
}

/** 匹配包含任意关键词的消息文本。 */
export class KeywordHandlerMapping implements HandlerMapping {
  private readonly handlers: [Set<string>, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const keywords = handler.meta.keywords
    if (keywords && keywords.size > 0) {
      this.handlers.push([keywords, handler])
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    return this.handlers
      .filter(([keywords]) => [...keywords].some((kw) => text.includes(kw)))
      .map(([, handler]) => ({ handler, regexMatch: null }))
  }

  get registeredCount(): number {
    return this.handlers.length
  }
}

/** 匹配以指定前缀开头的消息。 */
export class StartsWithHandlerMapping implements HandlerMapping {
  private readonly handlers: [string, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const prefix = handler.meta.prefix
    if (prefix) {
      this.handlers.push([prefix, handler])
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    return this.handlers
      .filter(([prefix]) => text.startsWith(prefix))
      .map(([, handler]) => ({ handler, regexMatch: null }))
  }

  get registeredCount(): number {
    return this.handlers.length
  }
}

/** 匹配以指定后缀结尾的消息。 */
export class EndsWithHandlerMapping implements HandlerMapping {
  private readonly handlers: [string, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const suffix = handler.meta.suffix
    if (suffix) {
      this.handlers.push([suffix, handler])
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    return this.handlers
      .filter(([suffix]) => text.endsWith(suffix))
      .map(([, handler]) => ({ handler, regexMatch: null }))
  }

  get registeredCount(): number {
    return this.handlers.length
  }
}

/** 完全匹配消息文本。 */
export class FullMatchHandlerMapping implements HandlerMapping {
  private readonly handlers = new Map<string, HandlerMethod[]>()

  register(handler: HandlerMethod): void {
    const text = handler.meta.text
    if (text) {
      const list = this.handlers.get(text) ?? []
      list.push(handler)
      this.handlers.set(text, list)
    }
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    if (!isMessageEvent(event)) return []
    const text = extractPlaintext(event)
    const matches = this.handlers.get(text) ?? []
    return matches.map((h) => ({ handler: h, regexMatch: null }))
  }

  get registeredCount(): number {
    let count = 0
    for (const list of this.handlers.values()) {
      count += list.length
    }
    return count
  }
}

/** 按事件 post_type / notice_type / sub_type / request_type 匹配。 */
export class EventTypeHandlerMapping implements HandlerMapping {
  private readonly handlers: HandlerMethod[] = []

  register(handler: HandlerMethod): void {
    this.handlers.push(handler)
  }

  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    const results: ResolvedHandler[] = []
    const eventRecord = event as Record<string, unknown>
    for (const handler of this.handlers) {
      const { meta } = handler
      const targetEventType = meta.eventType ?? ''

      if (event.post_type !== targetEventType) continue

      // 对于通知事件，可选择按 notice_type 和 sub_type 过滤
      if (meta.noticeType != null) {
        if (eventRecord.notice_type !== meta.noticeType) continue
      }

      if (meta.subType != null) {
        if (eventRecord.sub_type !== meta.subType) continue
      }

      // 对于请求事件，可选择按 request_type 过滤
      if (meta.requestType != null) {
        if (eventRecord.request_type !== meta.requestType) continue
      }

      results.push({ handler, regexMatch: null })
    }
    return results
  }

  get registeredCount(): number {
    return this.handlers.length
  }
}

// ── 复合映射 ──

const MAPPING_TYPES = [
  'command',
  'regex',
  'keyword',
  'startswith',
  'endswith',
  'fullmatch',
  'event_type',
] as const
type MappingType = (typeof MAPPING_TYPES)[number]

function createMappingForType(type: MappingType): HandlerMapping {
  switch (type) {
    case 'command':
      return new CommandHandlerMapping()
    case 'regex':
      return new RegexHandlerMapping()
    case 'keyword':
      return new KeywordHandlerMapping()
    case 'startswith':
      return new StartsWithHandlerMapping()
    case 'endswith':
      return new EndsWithHandlerMapping()
    case 'fullmatch':
      return new FullMatchHandlerMapping()
    case 'event_type':
      return new EventTypeHandlerMapping()
  }
}

/** 聚合所有 HandlerMapping，合并结果并按优先级排序。 */
export class CompositeHandlerMapping {
  private readonly mappings: HandlerMapping[]
  private readonly typeIndex: Map<MappingType, HandlerMapping>

  constructor() {
    this.typeIndex = new Map()
    this.mappings = []
    for (const type of MAPPING_TYPES) {
      const instance = createMappingForType(type)
      this.mappings.push(instance)
      this.typeIndex.set(type, instance)
    }
  }

  /**
   * 注册处理器到对应的子映射。
   * 根据 meta.mappingType 路由到正确的 HandlerMapping 实例。
   */
  register(handler: HandlerMethod): void {
    const mappingType = handler.meta.mappingType
    const target = this.typeIndex.get(mappingType)
    target?.register(handler)
  }

  /**
   * 解析事件，返回所有匹配的处理器（按优先级升序排序）。
   * 同时执行 messageScope 过滤。
   */
  resolve(event: AnyOneBotEvent): ResolvedHandler[] {
    const resolved: ResolvedHandler[] = []
    for (const mapping of this.mappings) {
      resolved.push(...mapping.resolve(event))
    }

    // messageScope 过滤：仅对消息事件生效
    const isGroup = isGroupMessageEvent(event)
    const filtered = isMessageEvent(event)
      ? resolved.filter(({ handler }) => {
          const scope = handler.meta.messageScope
          if (scope === 'all') return true
          if (scope === 'group') return isGroup
          // scope === 'private'
          return !isGroup
        })
      : resolved

    // 按优先级升序排序
    filtered.sort((a, b) => a.handler.priority - b.handler.priority)
    return filtered
  }

  /** 所有子映射中已注册的处理器总数。 */
  get handlerCount(): number {
    let count = 0
    for (const mapping of this.mappings) {
      if (
        mapping instanceof CommandHandlerMapping ||
        mapping instanceof RegexHandlerMapping ||
        mapping instanceof KeywordHandlerMapping ||
        mapping instanceof StartsWithHandlerMapping ||
        mapping instanceof EndsWithHandlerMapping ||
        mapping instanceof FullMatchHandlerMapping ||
        mapping instanceof EventTypeHandlerMapping
      ) {
        count += mapping.registeredCount
      }
    }
    return count
  }
}
