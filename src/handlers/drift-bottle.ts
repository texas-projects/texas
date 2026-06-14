/**
 * 漂流瓶 Bot 处理器 —— 响应「扔漂流瓶」和「捞漂流瓶」关键词。
 */

import { logger } from '@logger'

import { type Context } from '@/core/dispatch/context.js'
import {
  Handler,
  OnStartsWith,
  OnFullMatch,
  Scope,
  Permission,
  SettingNode,
} from '@/core/dispatch/decorators/index.js'
import { Inject } from '@/core/lifecycle/decorators/index.js'
import { MessageBuilder, Seg, type MessageSegment } from '@/core/protocol/index.js'
import type { DriftBottleService } from '@/services/drift-bottle.js'

const TRIGGER_THROW = '扔漂流瓶'
const TRIGGER_PICK = '捞漂流瓶'

/** 过滤消息段，保留 text（去除触发词）和 image，其他类型丢弃。 */
function filterContent(
  message: MessageSegment[] | string,
  trigger: string,
): { type: string; data: Record<string, unknown> }[] {
  if (typeof message === 'string') {
    const text = message.startsWith(trigger) ? message.slice(trigger.length).trim() : message
    return text ? [{ type: 'text', data: { text } }] : []
  }

  const result: { type: string; data: Record<string, unknown> }[] = []
  for (const seg of message) {
    if (seg.type === 'image') {
      result.push({ type: 'image', data: { ...seg.data } })
    } else if (seg.type === 'text') {
      const rawText = seg.data.text
      const rawStr = typeof rawText === 'string' ? rawText : ''
      const finalStr =
        result.length === 0 && rawStr.startsWith(trigger)
          ? rawStr.slice(trigger.length).trim()
          : rawStr
      if (finalStr) {
        result.push({ type: 'text', data: { text: finalStr } })
      }
    }
  }
  return result
}

@Handler({
  name: 'drift_bottle',
  displayName: '漂流瓶',
  description: '扔/捞漂流瓶，同池内随机互通，每瓶一次性消耗',
  tags: ['fun'],
})
@SettingNode('enabled', {
  type: 'boolean',
  default: true,
  description: '是否启用漂流瓶功能',
})
@SettingNode('permission', {
  type: 'enum',
  default: 'ANYONE',
  enumOptions: { ANYONE: 0, GROUP_MEMBER: 10, GROUP_ADMIN: 20, GROUP_OWNER: 30, ADMIN: 100 },
  description: '最低权限等级',
})
class DriftBottleHandler {
  private readonly _log = logger.child({ name: 'driftBottle' })

  @Inject('drift_bottle_service')
  private readonly driftBottleService!: DriftBottleService

  /** 处理扔漂流瓶请求。 */
  @OnStartsWith(TRIGGER_THROW)
  @Scope('group')
  @Permission(0)
  async handleThrow(ctx: Context): Promise<boolean> {
    if (ctx.groupId === undefined) {
      return false
    }

    const groupId = BigInt(ctx.groupId)

    const rawMessage = (ctx.event as Record<string, unknown>).message
    const message = Array.isArray(rawMessage)
      ? (rawMessage as MessageSegment[])
      : typeof rawMessage === 'string'
        ? rawMessage
        : ctx.getPlaintext()

    const content = filterContent(message, TRIGGER_THROW)
    if (content.length === 0) {
      await ctx.reply('漂流瓶里什么都没有哦~')
      return true
    }

    try {
      const poolId = await this.driftBottleService.getPoolId(groupId)
      await this.driftBottleService.throwBottle({
        poolId,
        senderId: BigInt(ctx.userId),
        senderGroupId: groupId,
        content,
      })
    } catch (err) {
      this._log.error({ groupId: ctx.groupId, userId: ctx.userId, err }, '扔漂流瓶失败')
      await ctx.reply('扔漂流瓶失败，请稍后重试')
      return true
    }

    const msg = new MessageBuilder().at(ctx.userId).text(' 漂流瓶已扔出，不知道会漂到哪里~').build()
    await ctx.reply(msg)
    return true
  }

  /** 处理捞漂流瓶请求。 */
  @OnFullMatch(TRIGGER_PICK)
  @Scope('group')
  @Permission(0)
  async handlePick(ctx: Context): Promise<boolean> {
    if (ctx.groupId === undefined) {
      return false
    }

    const groupId = BigInt(ctx.groupId)

    let bottle: Awaited<ReturnType<DriftBottleService['pickBottle']>>
    try {
      const poolId = await this.driftBottleService.getPoolId(groupId)
      bottle = await this.driftBottleService.pickBottle({ poolId, userId: BigInt(ctx.userId) })
    } catch (err) {
      this._log.error({ groupId: ctx.groupId, userId: ctx.userId, err }, '捞漂流瓶失败')
      await ctx.reply('捞漂流瓶失败，请稍后重试')
      return true
    }

    if (bottle === null) {
      await ctx.reply('池子里暂时没有漂流瓶，快去扔一个吧~')
      return true
    }

    const replySegs: MessageSegment[] = [
      Seg.text('捞到了一个漂流瓶：\n'),
      ...(bottle.content as { type: string; data: Record<string, unknown> }[]).map((s) => ({
        type: s.type,
        data: s.data,
      })),
    ]

    await ctx.reply(replySegs)
    return true
  }
}

export { DriftBottleHandler }
