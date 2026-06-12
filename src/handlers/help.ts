/**
 * 帮助处理器 —— 响应 /help 等指令，返回图片格式的功能帮助。
 */

import { getLogger } from '@logger'

import type { Context } from '@/core/dispatch/context.js'
import type { ComponentMeta } from '@/core/dispatch/decorators.js'
import { Component, OnCommand, MessageScope } from '@/core/dispatch/decorators.js'
import { handlerRegistry } from '@/core/dispatch/registry.js'
import type { HelpData } from '@/render-templates/help.js'
import { render } from '@/services/renderer/index.js'

const log = getLogger('help')

const HELP_PAGE_SIZE = 8
const RENDER_WIDTH = 680

interface HelpItem {
  displayName: string
  description: string
  trigger: string
  tag: string
}

interface HelpCategory {
  tag: string
  items: HelpItem[]
}

/** 降级处理：直接发送纯文本功能列表。 */
async function fallbackText(ctx: Context): Promise<boolean> {
  const lines: string[] = ['可用功能列表：']
  for (const entry of handlerRegistry.values()) {
    if (!entry.meta.system) {
      lines.push(`  · ${entry.meta.displayName}: ${entry.meta.description}`)
    }
  }
  await ctx.reply(lines.join('\n'))
  return true
}

/** 列表模式：渲染指定页的功能列表。 */
async function handleList(
  ctx: Context,
  page: number,
  allFeatures: ComponentMeta[],
): Promise<boolean> {
  const grouped = new Map<string, HelpItem[]>()
  for (const meta of allFeatures) {
    const tag = meta.tags[0] ?? '其他'
    const item: HelpItem = {
      displayName: meta.displayName,
      description: meta.description,
      trigger: '',
      tag,
    }
    const arr = grouped.get(tag) ?? []
    arr.push(item)
    grouped.set(tag, arr)
  }

  const categories: HelpCategory[] = []
  for (const [t, items] of grouped) {
    categories.push({ tag: t, items })
  }

  const allItems = categories.flatMap((c) => c.items)
  const totalPages = Math.max(1, Math.ceil(allItems.length / HELP_PAGE_SIZE))

  if (page < 1 || page > totalPages) {
    await ctx.reply(`共 ${String(totalPages)} 页，请输入有效页码`)
    return true
  }

  const start = (page - 1) * HELP_PAGE_SIZE
  const pageItems = allItems.slice(start, start + HELP_PAGE_SIZE)

  const pageGrouped = new Map<string, HelpItem[]>()
  for (const item of pageItems) {
    const arr = pageGrouped.get(item.tag) ?? []
    arr.push(item)
    pageGrouped.set(item.tag, arr)
  }

  const pageCats: { tag: string; items: { name: string; desc: string }[] }[] = []
  for (const [t, its] of pageGrouped) {
    pageCats.push({
      tag: t,
      items: its.map((i) => ({ name: i.displayName, desc: i.description || '—' })),
    })
  }

  const helpData: HelpData = {
    title: 'Aemeath Bot 功能帮助',
    categories: pageCats,
    page,
    totalPages,
  }

  try {
    const { Seg } = await import('@/core/protocol/segment.js')
    const buf = await render('help', helpData, { width: RENDER_WIDTH })
    await ctx.reply([Seg.image(`base64://${buf.toString('base64')}`)])
  } catch (err) {
    log.error({ userId: ctx.userId, err }, '帮助列表渲染失败')
    return fallbackText(ctx)
  }
  return true
}

/** 详情模式：渲染指定功能的帮助。 */
async function handleDetail(
  ctx: Context,
  featureQuery: string,
  allFeatures: ComponentMeta[],
): Promise<boolean> {
  const meta = allFeatures.find((c) => c.name === featureQuery || c.displayName === featureQuery)

  if (meta === undefined) {
    await ctx.reply('未找到该功能或功能未启用')
    return true
  }

  const helpData: HelpData = {
    title: meta.displayName,
    categories: [
      {
        tag: '说明',
        items: [{ name: meta.displayName, desc: meta.description || '—' }],
      },
    ],
    page: 1,
    totalPages: 1,
  }

  try {
    const { Seg } = await import('@/core/protocol/segment.js')
    const buf = await render('help', helpData, { width: RENDER_WIDTH })
    await ctx.reply([Seg.image(`base64://${buf.toString('base64')}`)])
  } catch (err) {
    log.error({ userId: ctx.userId, err }, '帮助详情渲染失败')
    return fallbackText(ctx)
  }
  return true
}

class HelpHandler {
  /** 处理 /help 指令。 */
  async showHelp(ctx: Context): Promise<boolean> {
    const arg = ctx.getArgStr().trim()
    const allFeatures: ComponentMeta[] = [...handlerRegistry.values()]
      .map((entry) => entry.meta)
      .filter((m) => !m.system)

    if (!arg || /^\d+$/u.test(arg)) {
      const page = arg ? parseInt(arg, 10) : 1
      return handleList(ctx, page, allFeatures)
    }

    return handleDetail(ctx, arg, allFeatures)
  }
}

// ── 装饰器注册 ──

Component({
  name: 'help',
  displayName: '帮助',
  description: '查看当前可用功能列表',
  tags: [],
  system: true,
})(HelpHandler)

OnCommand('/help', {
  aliases: new Set(['/帮助', '/？']),
  displayName: '功能帮助',
  description: '查看当前可用功能列表，发送 /help <功能名> 查看子命令详情',
  scope: MessageScope.ALL,
  // eslint-disable-next-line @typescript-eslint/unbound-method
})(HelpHandler.prototype.showHelp)

export { HelpHandler }
