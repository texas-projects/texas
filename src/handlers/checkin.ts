/**
 * 用户群签到 Bot 处理器 —— 响应「签到」关键词或「/签到」命令。
 */

import { logger } from '@logger'

import { type Context } from '@/core/dispatch/context.js'
import {
  Handler,
  OnCommand,
  OnKeyword,
  Scope,
  Permission,
  SettingNode,
} from '@/core/dispatch/decorators/index.js'
import { Inject } from '@/core/lifecycle/decorators/index.js'
import { MessageBuilder } from '@/core/protocol/index.js'
import type { CheckinService } from '@/services/checkin.js'

// ── 上海时区辅助 ──
function getTodayShanghai(): Date {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return new Date(utc8.toISOString().slice(0, 10))
}

@Handler({
  name: 'user_checkin',
  displayName: '群签到',
  description: '用户手动签到，回复今日本群排名和连续/累计天数',
  tags: ['fun'],
})
@SettingNode('enabled', {
  type: 'boolean',
  default: true,
  description: '是否启用群签到功能',
})
@SettingNode('permission', {
  type: 'enum',
  default: 'ANYONE',
  enumOptions: { ANYONE: 0, GROUP_MEMBER: 10, GROUP_ADMIN: 20, GROUP_OWNER: 30, ADMIN: 100 },
  description: '最低权限等级',
})
class CheckinHandler {
  private readonly _log = logger.child({ name: 'checkin' })

  @Inject('user_checkin_service')
  private readonly checkinService!: CheckinService

  /** 处理用户签到请求（关键词触发）。 */
  @OnKeyword(['签到'])
  @Scope('group')
  async handleCheckinKeyword(ctx: Context): Promise<boolean> {
    return this._doCheckin(ctx)
  }

  /** 处理用户签到请求（命令触发）。 */
  @OnCommand('签到')
  @Scope('group')
  @Permission(0)
  async handleCheckinCommand(ctx: Context): Promise<boolean> {
    return this._doCheckin(ctx)
  }

  /** 执行签到业务逻辑。 */
  private async _doCheckin(ctx: Context): Promise<boolean> {
    if (ctx.groupId === undefined) {
      return false
    }

    const today = getTodayShanghai()

    let result: Awaited<ReturnType<CheckinService['checkin']>>
    try {
      result = await this.checkinService.checkin({
        groupId: BigInt(ctx.groupId),
        userId: BigInt(ctx.userId),
        today,
      })
    } catch (err) {
      this._log.error({ groupId: ctx.groupId, userId: ctx.userId, err }, '用户签到异常')
      await ctx.reply('签到失败，请稍后重试')
      return true
    }

    let msg: ReturnType<MessageBuilder['build']>
    if (result.isDuplicate) {
      msg = new MessageBuilder()
        .at(ctx.userId)
        .text(
          ` 今天已经签到过啦~（连续 ${String(result.streak)} 天，累计 ${String(result.total)} 天）`,
        )
        .build()
    } else {
      msg = new MessageBuilder()
        .at(ctx.userId)
        .text(
          ` 签到成功！今日本群第 ${String(result.rank)} 个签到\n` +
            `连续签到 ${String(result.streak)} 天，累计签到 ${String(result.total)} 天`,
        )
        .build()
    }

    await ctx.reply(msg)
    return true
  }
}

export { CheckinHandler }
