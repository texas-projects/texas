/**
 * 帮助处理器 —— 响应 /help 等指令，返回图片格式的功能帮助。
 */

import type { Context } from '../core/framework/context.js'
import type { ComponentMeta } from '../core/framework/decorators.js'
import { Component, OnCommand, MessageScope } from '../core/framework/decorators.js'
import { getLogger } from '../core/logging/setup.js'
import type { MarkdownRenderer } from '../core/utils/md2img.js'

const log = getLogger('help')

const HELP_PAGE_SIZE = 8
const RENDER_WIDTH = 680

interface HelpItem {
  displayName: string
  description: string
  trigger: string
  admin: boolean
  tag: string
}

interface HelpCategory {
  tag: string
  items: HelpItem[]
}

function fmtTrigger(trigger: string): string {
  return trigger ? trigger.replace(/\|/g, '\\|') : '—'
}

function buildListMarkdown(categories: HelpCategory[], page: number, totalPages: number): string {
  const lines: string[] = ['# Texas Bot 功能帮助', '']

  for (const cat of categories) {
    lines.push(`## ${cat.tag}`)
    lines.push('| 功能 | 说明 | 触发方式 |')
    lines.push('|------|------|----------|')
    for (const item of cat.items) {
      lines.push(
        `| ${item.displayName} | ${item.description || '—'} | ${fmtTrigger(item.trigger)} |`,
      )
    }
    lines.push('')
  }

  lines.push('---')
  if (totalPages > 1) {
    const parts: string[] = [`第 ${String(page)} 页 / 共 ${String(totalPages)} 页`]
    if (page < totalPages) {
      parts.push(`发送 \`/help ${String(page + 1)}\` 查看下一页`)
    }
    parts.push('`/help <功能名>` 查看详情')
    lines.push(parts.join(' · '))
  } else {
    lines.push('发送 `/help <功能名>` 查看详情')
  }

  return lines.join('\n')
}

/** 降级处理：直接发送纯文本功能列表。 */
async function fallbackText(ctx: Context): Promise<boolean> {
  const { componentRegistry } = await import('../core/framework/decorators.js')
  const lines: string[] = ['可用功能列表：']
  for (const meta of componentRegistry.values()) {
    if (!meta.system) {
      lines.push(`  · ${meta.displayName}: ${meta.description}`)
    }
  }
  await ctx.reply(lines.join('\n'))
  return true
}

/** 渲染 Markdown 并发送图片，失败时回退文字。 */
async function renderAndSend(
  ctx: Context,
  renderer: MarkdownRenderer,
  md: string,
  errorLabel: string,
): Promise<void> {
  try {
    const { Seg } = await import('../core/protocol/segment.js')
    const buf = await renderer.render(md, { width: RENDER_WIDTH })
    const b64 = `base64://${buf.toString('base64')}`
    await ctx.reply([Seg.image(b64)])
  } catch (err) {
    log.error({ userId: ctx.userId, err }, errorLabel)
    await ctx.reply('帮助图片生成失败，请稍后重试')
  }
}

/** 列表模式：渲染指定页的功能列表。 */
async function handleList(
  ctx: Context,
  page: number,
  allFeatures: ComponentMeta[],
  renderer: MarkdownRenderer,
): Promise<boolean> {
  const grouped = new Map<string, HelpItem[]>()
  for (const meta of allFeatures) {
    const tag = meta.tags[0] ?? '其他'
    const item: HelpItem = {
      displayName: meta.displayName,
      description: meta.description,
      trigger: '',
      admin: meta.admin,
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

  const pageCats: HelpCategory[] = []
  for (const [t, its] of pageGrouped) {
    pageCats.push({ tag: t, items: its })
  }

  const md = buildListMarkdown(pageCats, page, totalPages)
  await renderAndSend(ctx, renderer, md, '帮助列表渲染失败')
  return true
}

/** 详情模式：渲染指定功能的帮助。 */
async function handleDetail(
  ctx: Context,
  featureQuery: string,
  allFeatures: ComponentMeta[],
  renderer: MarkdownRenderer,
): Promise<boolean> {
  const meta = allFeatures.find((c) => c.name === featureQuery || c.displayName === featureQuery)

  if (meta === undefined) {
    await ctx.reply('未找到该功能或功能未启用')
    return true
  }

  const md = [`# ${meta.displayName}`, '', meta.description].join('\n')
  await renderAndSend(ctx, renderer, md, '帮助详情渲染失败')
  return true
}

class HelpHandler {
  /** 处理 /help 指令。 */

  async showHelp(ctx: Context): Promise<boolean> {
    const { MarkdownRenderer } = await import('../core/utils/md2img.js')

    if (!ctx.hasService(MarkdownRenderer)) {
      return fallbackText(ctx)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument
    const renderer = ctx.getService(MarkdownRenderer as any) as unknown as MarkdownRenderer
    const arg = ctx.getArgStr().trim()

    const { componentRegistry } = await import('../core/framework/decorators.js')
    const allFeatures = [...componentRegistry.values()].filter((c) => !c.system)

    if (!arg || /^\d+$/u.test(arg)) {
      const page = arg ? parseInt(arg, 10) : 1
      return handleList(ctx, page, allFeatures, renderer)
    }

    return handleDetail(ctx, arg, allFeatures, renderer)
  }
}

// ── 装饰器注册 ──

Component({
  name: 'help',
  displayName: '帮助',
  description: '查看当前可用功能列表',
  tags: [],
  defaultEnabled: true,
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
