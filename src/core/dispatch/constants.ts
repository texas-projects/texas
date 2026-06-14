/**
 * dispatch 模块常量与方法级元数据类型定义。
 *
 * Permission/MessageScope 枚举对象供业务代码按名称引用权限等级/作用域；
 * HandlerMeta 接口描述方法路由的完整元数据结构，供 mapping 层消费。
 */

// ── 枚举常量 ──

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

// ── 方法级路由元数据 ──

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
