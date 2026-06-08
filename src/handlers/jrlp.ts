/**
 * 今日老婆 Bot 处理器 —— 响应群聊抽取指令。
 */

import { logger } from '@logger'

import type { Context } from '@/core/framework/context.js'
import { Component, OnRegex, MessageScope } from '@/core/framework/decorators.js'
import { MessageBuilder } from '@/core/protocol/segment.js'
import type { JrlpService } from '@/services/jrlp.js'

// QQ 头像 URL 模板
const AVATAR_URL = 'https://q1.qlogo.cn/g?b=qq&nk={qq}&s=640'

/** 获取今日北京时间日期。 */
function getTodayShanghai(): Date {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return new Date(utc8.toISOString().slice(0, 10))
}

class JrlpHandler {
  private readonly _log = logger.child({ name: 'jrlp' })

  /** 随机抽取今日群老婆。 */

  async drawWife(ctx: Context): Promise<boolean> {
    const { JrlpService: JrlpSvc } = await import('@/services/jrlp.js')

    if (!ctx.hasService(JrlpSvc) || ctx.groupId === undefined) {
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument
    const svc = ctx.getService(JrlpSvc as any) as unknown as JrlpService
    const today = getTodayShanghai()

    let drawResult: Awaited<ReturnType<JrlpService['getOrDraw']>>
    try {
      drawResult = await svc.getOrDraw({
        groupId: ctx.groupId,
        userId: ctx.userId,
        today,
      })
    } catch (err) {
      if (err instanceof Error && err.message.includes('no members')) {
        await ctx.reply('该群暂无可抽取的成员，请等待群成员同步后重试')
        return true
      }
      this._log.error({ groupId: ctx.groupId, userId: ctx.userId, err }, '抽取今日老婆失败')
      await ctx.reply('抽取失败，请稍后重试')
      return true
    }

    const { record, isNew, wifeDisplayName } = drawResult
    const wifeQq = String(record.wifeQq)
    const avatarUrl = AVATAR_URL.replace('{qq}', wifeQq)
    const text = isNew
      ? `你今天的群老婆是：${wifeDisplayName}(${wifeQq})`
      : `你今天已经有群老婆${wifeDisplayName}(${wifeQq})了，要好好对待她哦~`

    const msg = new MessageBuilder().at(ctx.userId).image(avatarUrl).text(` ${text}`).build()
    await ctx.reply(msg)
    return true
  }
}

// ── 装饰器注册 ──

Component({
  name: 'jrlp',
  displayName: '今日老婆',
  description: '每日群内随机抽取群老婆，每人每群每天一次',
  tags: ['fun'],
  defaultEnabled: true,
})(JrlpHandler)

OnRegex('^(jrlp|今日老婆|抽老婆|群老婆)$', 0, {
  scope: MessageScope.GROUP,
  displayName: '抽取今日老婆',
  description: '指令：jrlp / 今日老婆 / 抽老婆 / 群老婆',
  // eslint-disable-next-line @typescript-eslint/unbound-method
})(JrlpHandler.prototype.drawWife)

export { JrlpHandler }
