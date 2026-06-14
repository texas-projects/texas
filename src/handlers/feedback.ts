/**
 * 用户反馈处理器 —— 反馈提交与查询命令。
 *
 * 注意：交互式多轮会话将在 Phase 4 实现，当前版本仅支持简单模式。
 */

import { logger } from '@logger'

import { type Context } from '@/core/dispatch/context.js'
import { Handler, OnCommand, Permission, SettingNode } from '@/core/dispatch/decorators/index.js'
import { Inject } from '@/core/lifecycle/decorators/index.js'
import type { FeedbackService } from '@/services/feedback.js'

type FeedbackType = 'bug' | 'suggestion' | 'complaint'
type FeedbackSource = 'group' | 'private'

function parseQuickFeedback(args: string): [FeedbackType | null, string] {
  const lower = args.toLowerCase()
  const keywords: [string, FeedbackType][] = [
    ['bug', 'bug'],
    ['问题', 'bug'],
    ['建议', 'suggestion'],
    ['suggestion', 'suggestion'],
    ['投诉', 'complaint'],
    ['complaint', 'complaint'],
  ]
  for (const [kw, ftype] of keywords) {
    if (lower.startsWith(kw)) {
      return [ftype, args.slice(kw.length).trim() || args]
    }
  }
  return [null, args]
}

@Handler({
  name: 'feedback',
  displayName: '用户反馈',
  description: '用户反馈提交与查询功能',
  tags: ['user', 'feedback'],
})
@SettingNode('enabled', {
  type: 'boolean',
  default: true,
  description: '是否启用用户反馈功能',
})
@SettingNode('permission', {
  type: 'enum',
  default: 'ANYONE',
  enumOptions: { ANYONE: 0, GROUP_MEMBER: 10, GROUP_ADMIN: 20, GROUP_OWNER: 30, ADMIN: 100 },
  description: '最低权限等级',
})
class FeedbackHandler {
  private readonly _log = logger.child({ name: 'feedback' })

  @Inject('feedback_service')
  private readonly feedbackService!: FeedbackService

  /** 提交反馈命令。有参数时直接提交，无参数时提示用法。 */
  @OnCommand('/反馈', { aliases: ['/feedback'] })
  @Permission(0)
  async submitFeedback(ctx: Context): Promise<boolean> {
    const argStr = ctx.getArgStr().trim()

    if (!argStr) {
      await ctx.reply(
        '请在命令后附加反馈内容，格式：/反馈 [类型] 内容\n' +
          '类型可选：bug / 建议 / 投诉\n' +
          '示例：/反馈 bug 发现了一个问题',
      )
      return true
    }

    const [feedbackType, content] = parseQuickFeedback(argStr)

    try {
      const source: FeedbackSource = ctx.isGroupEvent() ? 'group' : 'private'
      const feedback = await this.feedbackService.createFeedback({
        userId: BigInt(ctx.userId),
        content,
        source,
        groupId: ctx.groupId !== undefined ? BigInt(ctx.groupId) : null,
        feedbackType: feedbackType ?? null,
      })
      await ctx.reply(`反馈已提交，编号：${feedback.id.slice(0, 8)}`)
    } catch (err) {
      this._log.error({ userId: ctx.userId, err }, '创建反馈失败')
      await ctx.reply('反馈提交失败，请稍后重试')
    }

    return true
  }

  /** 查询用户最近 5 条反馈。 */
  @OnCommand('/我的反馈', { aliases: ['/myfeedback'] })
  @Permission(0)
  async myFeedbacks(ctx: Context): Promise<boolean> {
    try {
      const feedbacks = await this.feedbackService.getUserFeedbacks(BigInt(ctx.userId), 5)

      if (feedbacks.length === 0) {
        await ctx.reply('您还没有提交过反馈')
        return true
      }

      const lines: string[] = ['您的反馈列表：']
      for (const fb of feedbacks) {
        const fbId = fb.id.slice(0, 8)
        const fbType = fb.feedbackType ?? '未分类'
        const fbStatus = fb.status === 'done' ? '已处理' : '待处理'
        const created = new Date(fb.createdAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        let line = `\n[${fbId}] ${fbType} | ${fbStatus} | ${created}`
        if (fb.adminReply) {
          line += `\n回复：${fb.adminReply}`
        }
        lines.push(line)
      }

      await ctx.reply(lines.join(''))
    } catch (err) {
      this._log.error({ userId: ctx.userId, err }, '查询反馈失败')
      await ctx.reply('查询失败，请稍后重试')
    }

    return true
  }
}

export { FeedbackHandler }
