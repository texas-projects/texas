/**
 * 控制器与处理器注册装饰器（替代 Python 装饰器），使用全局注册表副作用模式。
 */

import { handlerRegistry as _handlerRegistry } from './registry.js'
import type {
  HandlerMeta as HandlerClassMeta,
  MethodMeta,
  HandlerRegistryEntry,
} from './registry.js'

// ── 枚举与常量 ──

/** 权限等级枚举。 */
export const Permission = {
  ANYONE: 0,
  GROUP_MEMBER: 10,
  GROUP_ADMIN: 20,
  GROUP_OWNER: 30,
  ADMIN: 100,
} as const
export type Permission = (typeof Permission)[keyof typeof Permission]

/** 消息作用域 —— 限制 handler 仅在特定消息类型中触发。 */
export const MessageScope = {
  ALL: 'all',
  GROUP: 'group',
  PRIVATE: 'private',
} as const
export type MessageScope = (typeof MessageScope)[keyof typeof MessageScope]

// ── 元数据类型 ──

/** 处理器方法元数据（用于 mapping 路由）。 */
export interface HandlerMeta {
  mappingType:
    | 'command'
    | 'regex'
    | 'keyword'
    | 'startswith'
    | 'endswith'
    | 'fullmatch'
    | 'event_type'
  permission: Permission
  messageScope: MessageScope
  priority: number | null
  displayName: string
  description: string
  // command
  cmd?: string
  aliases?: Set<string>
  // regex
  pattern?: string
  compiledPattern?: RegExp
  // keyword
  keywords?: Set<string>
  // startsWith
  prefix?: string
  // endsWith
  suffix?: string
  // fullMatch
  text?: string
  // event_type
  eventType?: string
  noticeType?: string | null
  subType?: string | null
  requestType?: string | null
}

/** 组件类元数据（兼容别名，实际为 HandlerClassMeta）。 */
export type ComponentMeta = HandlerClassMeta

// ── 全局注册表 ──

/**
 * 方法级 pending 元数据（按方法函数引用索引）。
 * 方法装饰器将元数据暂存于此，类装饰器 @Handler 执行时统一收集。
 * @internal 仅供测试和框架内部使用。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const _pendingMethods = new Map<Function, HandlerMeta[]>()

// ── 类装饰器 ──

/** Handler 选项（原 ComponentOptions）。 */
export interface HandlerOptions {
  name: string
  description?: string
  displayName?: string
  tags?: string[]
  defaultPriority?: number
  /** system=true 时强制启用且不暴露给前端。 */
  system?: boolean
}

/** 兼容别名。 */
export type ComponentOptions = HandlerOptions

/**
 * 将类标记为 Handler（功能组件），收集其方法装饰器元数据并注册到 HandlerRegistry。
 * 使用方式：`Handler({ name: 'echo', ... })(EchoHandler)`
 */
export function Handler(opts: HandlerOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: HandlerClassMeta = {
      name: opts.name,
      displayName: opts.displayName ?? opts.name,
      description: opts.description ?? '',
      tags: opts.tags ?? [],
      defaultPriority: opts.defaultPriority ?? 50,
      system: opts.system ?? false,
      target,
    }

    // 收集该类原型方法上的 pending 元数据
    const methods: MethodMeta[] = []
    const proto = target.prototype as Record<string, unknown>
    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue
      const fn = proto[methodName]
      if (typeof fn !== 'function') continue
      const metas = _pendingMethods.get(fn)
      if (metas && metas.length > 0) {
        for (const m of metas) {
          methods.push({
            ...m,
            method: fn,
          })
        }
      }
    }

    const entry: HandlerRegistryEntry = { meta, methods }
    _handlerRegistry.register(opts.name, entry)
  }
}

/** 兼容别名：Component = Handler。 */
export const Component = Handler

// ── 方法装饰器内部辅助 ──

interface BaseHandlerOptions {
  permission?: Permission
  scope?: MessageScope
  priority?: number | null
  displayName?: string
  description?: string
  admin?: boolean | null
}

function makeHandlerDecorator(
  meta: Omit<
    HandlerMeta,
    'permission' | 'messageScope' | 'priority' | 'displayName' | 'description'
  >,
  opts: BaseHandlerOptions,
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    let permission: Permission = opts.permission ?? Permission.ANYONE
    if (opts.admin === true) {
      permission = Permission.ADMIN
    }
    const fullMeta: HandlerMeta = {
      ...meta,
      permission,
      messageScope: opts.scope ?? MessageScope.ALL,
      priority: opts.priority ?? null,
      displayName: opts.displayName ?? '',
      description: opts.description ?? '',
    }
    const existing = _pendingMethods.get(target) ?? []
    existing.push(fullMeta)
    _pendingMethods.set(target, existing)
  }
}

// ── 方法装饰器 ──

/** 命令选项。 */
export interface OnCommandOptions extends BaseHandlerOptions {
  aliases?: Set<string>
}

/** 通过命令前缀匹配消息（例如 /echo）。 */
export function OnCommand(cmd: string, opts: OnCommandOptions = {}) {
  return makeHandlerDecorator(
    {
      mappingType: 'command',
      cmd,
      aliases: opts.aliases ?? new Set<string>(),
    },
    { ...opts, displayName: opts.displayName ?? cmd },
  )
}

/** 通过正则表达式匹配消息。 */
export function OnRegex(pattern: string, flags = 0, opts: BaseHandlerOptions = {}) {
  const flagStr = flags ? String.fromCodePoint(flags) : undefined
  return makeHandlerDecorator(
    {
      mappingType: 'regex',
      pattern,
      compiledPattern: new RegExp(pattern, flagStr),
    },
    opts,
  )
}

/** 匹配包含任意关键词的消息。 */
export function OnKeyword(keywords: Set<string>, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'keyword', keywords }, opts)
}

/** 匹配以指定前缀开头的消息。 */
export function OnStartsWith(prefix: string, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'startswith', prefix }, opts)
}

/** 匹配以指定后缀结尾的消息。 */
export function OnEndsWith(suffix: string, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'endswith', suffix }, opts)
}

/** 完全匹配消息文本。 */
export function OnFullMatch(text: string, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'fullmatch', text }, opts)
}

/** 按事件 post_type 匹配。 */
export function OnEvent(eventType: string, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'event_type', eventType }, opts)
}

/** 匹配通知事件，可按 notice_type 和 sub_type 过滤。 */
export function OnNotice(
  noticeType: string | null = null,
  subType: string | null = null,
  opts: BaseHandlerOptions = {},
) {
  return makeHandlerDecorator(
    { mappingType: 'event_type', eventType: 'notice', noticeType, subType },
    opts,
  )
}

/** 匹配请求事件，可按 request_type 过滤。 */
export function OnRequest(requestType: string | null = null, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator(
    { mappingType: 'event_type', eventType: 'request', requestType },
    opts,
  )
}

/** 匹配 message_sent 事件（NapCat 扩展）。 */
export function OnMessageSent(opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator({ mappingType: 'event_type', eventType: 'message_sent' }, opts)
}

/** 匹配戳一戳通知事件。 */
export function OnPoke(opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator(
    { mappingType: 'event_type', eventType: 'notice', noticeType: 'notify', subType: 'poke' },
    opts,
  )
}

/** 匹配精华消息通知事件。 */
export function OnEssence(subType: string | null = null, opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator(
    { mappingType: 'event_type', eventType: 'notice', noticeType: 'essence', subType },
    opts,
  )
}

/** 匹配 bot_offline 通知事件。 */
export function OnBotOffline(opts: BaseHandlerOptions = {}) {
  return makeHandlerDecorator(
    { mappingType: 'event_type', eventType: 'notice', noticeType: 'bot_offline' },
    opts,
  )
}

// ── Settings 装饰器 re-export ──

export { SettingNode, settingNodeRegistry } from '@/core/settings/decorators.js'
export type {
  SettingNodeMeta,
  SettingNodeOptions,
  SettingValueType,
} from '@/core/settings/decorators.js'
