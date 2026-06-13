/** OneBot 11 协议数据模型统一导出。 */
// base.ts 与 segments.ts 均含 MessageSegment，以 segments.ts 联合类型为准
export { PostType, MessageType, NoticeType, RequestType, MetaEventType, GroupRole } from './base.js'
export type { Sender, Anonymous, HeartbeatStatus, OneBotEvent } from './base.js'
export * from './events.js'
export * from './api.js'
export * from './segments.js'
