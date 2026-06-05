/**
 * 用户群签到 Bot 处理器 —— 响应「签到」关键词或「/签到」命令。
 */

import type { Context } from '../core/framework/context.js'
import {
  Component,
  OnCommand,
  OnKeyword,
  MessageScope,
  Permission,
} from '../core/framework/decorators.js'
import { logger } from '../core/logging/setup.js'
import { MessageBuilder } from '../core/protocol/segment.js'
import type { CheckinService } from '../services/checkin.js'

// ── 上海时区辅助 ──
function getTodayShanghai(): Date {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return new Date(utc8.toISOString().slice(0, 10))
}

class CheckinHandler {
  private readonly _log = logger.child({ name: 'checkin' })

  /** 处理用户签到请求，回复排名和连续/累计天数。 */

  async handleCheckin(ctx: Context): Promise<boolean> {
    const { CheckinService: CheckinSvc } = await import('../services/checkin.js')

    if (!ctx.hasService(CheckinSvc) || ctx.groupId === undefined) {
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument
    const svc = ctx.getService(CheckinSvc as any) as unknown as CheckinService
    const today = getTodayShanghai()

    let result: Awaited<ReturnType<CheckinService['checkin']>>
    try {
      result = await svc.checkin({
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

// ── 装饰器注册 ──

Component({
  name: 'user_checkin',
  displayName: '群签到',
  description: '用户手动签到，回复今日本群排名和连续/累计天数',
  tags: ['fun'],
  defaultEnabled: true,
})(CheckinHandler)

OnKeyword(new Set(['签到']), {
  scope: MessageScope.GROUP,
  displayName: '签到（关键词）',
  description: '发送「签到」触发',
  // eslint-disable-next-line @typescript-eslint/unbound-method
})(CheckinHandler.prototype.handleCheckin)

OnCommand('签到', {
  permission: Permission.ANYONE,
  scope: MessageScope.GROUP,
  displayName: '签到（命令）',
  description: '发送「/签到」触发',
  // eslint-disable-next-line @typescript-eslint/unbound-method
})(CheckinHandler.prototype.handleCheckin)

export { CheckinHandler }
