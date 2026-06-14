/**
 * 今日老婆 Bot 处理器 —— 响应群聊抽取指令。
 */

import { logger } from '@logger'

import { type Context } from '@/core/dispatch/context.js'
import { Handler, OnRegex, Scope, SettingNode } from '@/core/dispatch/decorators/index.js'
import { Inject } from '@/core/lifecycle/decorators/index.js'
import { MessageBuilder } from '@/core/protocol/index.js'
import type { JrlpService } from '@/services/jrlp.js'

// QQ 头像 URL 模板
const AVATAR_URL = 'https://q1.qlogo.cn/g?b=qq&nk={qq}&s=640'

/** 获取今日北京时间日期。 */
function getTodayShanghai(): Date {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return new Date(utc8.toISOString().slice(0, 10))
}

@Handler({
  name: 'jrlp',
  displayName: '今日老婆',
  description: '每日群内随机抽取群老婆，每人每群每天一次',
  tags: ['fun'],
})
@SettingNode('enabled', {
  type: 'boolean',
  default: true,
  description: '是否启用今日老婆功能',
})
@SettingNode('permission', {
  type: 'enum',
  default: 'ANYONE',
  enumOptions: { ANYONE: 0, GROUP_MEMBER: 10, GROUP_ADMIN: 20, GROUP_OWNER: 30, ADMIN: 100 },
  description: '最低权限等级',
})
class JrlpHandler {
  private readonly _log = logger.child({ name: 'jrlp' })

  @Inject('jrlp_service')
  private readonly jrlpService!: JrlpService

  /** 随机抽取今日群老婆。 */
  @OnRegex('^(jrlp|今日老婆|抽老婆|群老婆)$')
  @Scope('group')
  async drawWife(ctx: Context): Promise<boolean> {
    if (ctx.groupId === undefined) {
      return false
    }

    const today = getTodayShanghai()

    let drawResult: Awaited<ReturnType<JrlpService['getOrDraw']>>
    try {
      drawResult = await this.jrlpService.getOrDraw({
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

export { JrlpHandler }
