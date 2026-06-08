/**
 * 点赞 Bot 处理器 —— 响应 /like 或 /点赞 命令。
 */

import type { Context } from '@/core/framework/context.js'
import { Component, OnCommand, MessageScope, Permission } from '@/core/framework/decorators.js'
import type { LikeService } from '@/services/like.js'

const DEFAULT_LIKE_TIMES = 10

const USAGE =
  '用法：\n' +
  '  /like [n]       立即点赞 n 次（默认 10）\n' +
  '  /like schedule  注册每日定时点赞\n' +
  '  /like cancel    取消定时点赞\n' +
  '  /like status    查看状态与统计'

class LikeHandler {
  /** 解析参数并分发到对应子命令。 */

  async handle(ctx: Context): Promise<void> {
    const { LikeService: LikeSvc } = await import('@/services/like.js')

    if (!ctx.hasService(LikeSvc)) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument
    const svc = ctx.getService(LikeSvc as any) as unknown as LikeService
    const qq = BigInt(ctx.userId)
    const args = ctx.getArgs()
    const sub = args[0]?.toLowerCase() ?? ''

    if (sub === 'schedule' || sub === '定时') {
      await handleSchedule(ctx, svc, qq)
    } else if (sub === 'cancel' || sub === '取消') {
      await handleCancel(ctx, svc, qq)
    } else if (sub === 'status' || sub === '状态') {
      await handleStatus(ctx, svc, qq)
    } else if (sub === '' || /^\d+$/u.test(sub)) {
      await handleSend(ctx, svc, qq, sub)
    } else {
      await ctx.reply(USAGE)
    }
  }
}

/** 执行立即点赞。 */
async function handleSend(ctx: Context, svc: LikeService, qq: bigint, sub: string): Promise<void> {
  let times = DEFAULT_LIKE_TIMES
  if (/^\d+$/u.test(sub)) {
    const n = parseInt(sub, 10)
    if (n < 1 || n > 20) {
      await ctx.reply('点赞次数范围为 1~20')
      return
    }
    times = n
  }

  const success = await svc.sendLikeNow(qq, times, 'manual')
  if (success) {
    await ctx.reply(`已给你点赞 ${String(times)} 次 👍`)
  } else {
    await ctx.reply('点赞失败，请稍后重试')
  }
}

/** 注册定时点赞任务。 */
async function handleSchedule(ctx: Context, svc: LikeService, qq: bigint): Promise<void> {
  const groupId = ctx.groupId !== undefined ? BigInt(ctx.groupId) : null
  const result = await svc.registerTask(qq, groupId)
  if (result.alreadyExists) {
    await ctx.reply('你已经注册过每日定时点赞了～')
  } else {
    await ctx.reply(`已注册每日定时点赞！每天零点自动给你点赞 ${String(DEFAULT_LIKE_TIMES)} 次`)
  }
}

/** 取消定时点赞任务。 */
async function handleCancel(ctx: Context, svc: LikeService, qq: bigint): Promise<void> {
  const deleted = await svc.cancelTask(qq)
  if (deleted) {
    await ctx.reply('已取消每日定时点赞')
  } else {
    await ctx.reply('你还没有注册定时点赞哦')
  }
}

/** 查询点赞状态与统计。 */
async function handleStatus(ctx: Context, svc: LikeService, qq: bigint): Promise<void> {
  const status = await svc.getStatus(qq)
  const taskInfo = status.hasTask ? '✅ 已开启每日定时点赞' : '❌ 未开启定时点赞'
  const lastTime = status.lastTriggeredAt
    ? new Date(status.lastTriggeredAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '暂无'
  await ctx.reply(
    `点赞状态\n${taskInfo}\n累计已点赞：${String(status.totalTimes)} 次\n最近点赞：${lastTime}`,
  )
}

// ── 装饰器注册 ──

Component({
  name: 'like',
  displayName: '点赞',
  description: '给自己 QQ 主页点赞，支持手动和每日定时自动点赞',
  tags: ['fun'],
  defaultEnabled: true,
})(LikeHandler)

OnCommand('like', {
  aliases: new Set(['点赞']),
  permission: Permission.ANYONE,
  scope: MessageScope.ALL,
  displayName: '点赞',
  description: '/like [n|schedule|cancel|status]',
  // eslint-disable-next-line @typescript-eslint/unbound-method
})(LikeHandler.prototype.handle)

export { LikeHandler }
