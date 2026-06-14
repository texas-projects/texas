/** Handler 方法路由装饰器：@OnCommand、@OnKeyword、@OnRegex 等。 */

import { getOrCreateMethodEntry } from './utils.js'

export interface OnCommandOptions {
  aliases?: string[]
}

/** 将方法注册为指令处理器（匹配 /cmd 格式的消息）。 */
export function OnCommand(cmd: string, opts?: OnCommandOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'command'
    entry.trigger = { cmd, aliases: opts?.aliases ? new Set(opts.aliases) : undefined }
  }
}

/** 将方法注册为关键词处理器（消息含任意关键词时触发）。 */
export function OnKeyword(keywords: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'keyword'
    entry.trigger = { keywords: new Set(keywords) }
  }
}

/** 将方法注册为正则匹配处理器。 */
export function OnRegex(pattern: string, flags?: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'regex'
    entry.trigger = { pattern, compiledPattern: new RegExp(pattern, flags) }
  }
}

/** 将方法注册为前缀匹配处理器。 */
export function OnStartsWith(prefix: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'startswith'
    entry.trigger = { prefix }
  }
}

/** 将方法注册为后缀匹配处理器。 */
export function OnEndsWith(suffix: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'endswith'
    entry.trigger = { suffix }
  }
}

/** 将方法注册为全量匹配处理器（消息完全等于指定文本时触发）。 */
export function OnFullMatch(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'fullmatch'
    entry.trigger = { text }
  }
}

/** 将方法注册为事件类型处理器。 */
export function OnEvent(eventType: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType }
  }
}

/** 将方法注册为 notice 事件处理器，可进一步过滤 noticeType 和 subType。 */
export function OnNotice(noticeType?: string, subType?: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'notice', noticeType, subType }
  }
}

/** 将方法注册为 request 事件处理器，可进一步过滤 requestType。 */
export function OnRequest(requestType?: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'request', requestType }
  }
}

/** 将方法注册为 message_sent 事件处理器（机器人自身发送消息时触发）。 */
export function OnMessageSent() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'message_sent' }
  }
}

/** 将方法注册为戳一戳事件处理器。 */
export function OnPoke() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'notice', noticeType: 'notify', subType: 'poke' }
  }
}

/** 将方法注册为精华消息事件处理器。 */
export function OnEssence(subType?: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'notice', noticeType: 'essence', subType }
  }
}

/** 将方法注册为机器人下线事件处理器。 */
export function OnOffline() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event_type'
    entry.trigger = { eventType: 'notice', noticeType: 'bot_offline' }
  }
}
