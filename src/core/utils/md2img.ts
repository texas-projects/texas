/**
 * Markdown 转 PNG 图片渲染器 —— 基于 BrowserService 将 Markdown 渲染为图片。
 */

import type { BrowserService } from '@/core/browser/service.js'
import { BrowserRenderError } from '@/core/browser/service.js'

// ── HTML 模板 ──

/**
 * HTML 页面模板。
 *
 * 占位符（使用 String.replace 注入，避免模板字面量与 CSS 花括号冲突）：
 * - `__PADDING__`      内边距（px）
 * - `__WIDTH__`        内容最大宽度（px）
 * - `__HTML_CONTENT__` Markdown 转换后的 HTML 正文
 */
const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; background: #fff; }
    #content {
      padding: __PADDING__px;
      max-width: __WIDTH__px;
      font-family: system-ui, -apple-system, "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #24292e;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 1em; margin-bottom: .5em; font-weight: 600; }
    h1 { font-size: 1.8em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
    pre { background: #f6f8fa; border-radius: 6px; padding: 12px 16px; overflow-x: auto; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
    :not(pre) > code { background: #f0f2f4; padding: 2px 5px; border-radius: 3px; }
    blockquote { border-left: 4px solid #0969da; margin: 0; padding: 0 1em; color: #57606a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
    th { background: #f6f8fa; font-weight: 600; }
    tr:nth-child(even) { background: #f6f8fa; }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid #eaecef; }
  </style>
</head>
<body>
  <div id="content">__HTML_CONTENT__</div>
</body>
</html>`

// ── 异常类 ──

/** Markdown 渲染失败异常。 */
export class MarkdownRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkdownRenderError'
  }
}

// ── 简易 Markdown 解析器 ──

/**
 * 将 Markdown 字符串转换为 HTML 片段（轻量实现，覆盖常用语法）。
 *
 * 支持：标题（h1-h6）、粗体、斜体、行内代码、代码块、块引用、
 * 有序/无序列表、水平线、段落。
 */
function markdownToHtml(md: string): string {
  let html = md
    // 转义 HTML 特殊字符（防止注入）
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 代码块（``` ... ```）— 必须在行内代码之前处理
  html = html.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return `<pre><code>${inner}</code></pre>`
  })

  // 标题
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, text: string) => {
    const level = hashes.length
    return `<h${String(level)}>${text}</h${String(level)}>`
  })

  // 水平线
  html = html.replace(/^[-*_]{3,}\s*$/gm, '<hr>')

  // 粗体（**text** 或 __text__）
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // 斜体（*text* 或 _text_）
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 块引用
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')

  // 无序列表
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')

  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')

  // 段落：两个换行分隔的文本块包裹 <p>
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim()
      // 已经是块级元素，不再包裹 <p>
      if (/^<(h[1-6]|pre|blockquote|ul|ol|li|hr)/.test(trimmed)) {
        return trimmed
      }
      if (trimmed === '') return ''
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  return html
}

// ── MarkdownRenderer ──

/**
 * Markdown 转 PNG 图片渲染器。
 *
 * 将 Markdown 转为 HTML（注入防护由 BrowserService 层提供），委托 BrowserService 渲染为 PNG。
 *
 * 用法：
 * ```ts
 * const renderer = new MarkdownRenderer(browserService)
 * const png = await renderer.render('# Hello')
 * ```
 */
export class MarkdownRenderer {
  private readonly _defaultWidth: number
  private readonly _padding: number
  /** 预替换 padding 的模板（实例生命周期内固定，减少每次 render() 中的重复替换）。 */
  private readonly _partialTemplate: string

  constructor(
    private readonly browserService: BrowserService,
    defaultWidth = 800,
    padding = 24,
  ) {
    this._defaultWidth = defaultWidth
    this._padding = padding
    this._partialTemplate = HTML_TEMPLATE.replace('__PADDING__', String(padding))
  }

  /**
   * 将 Markdown 渲染为 PNG 图片字节。
   *
   * @param markdown - Markdown 格式字符串
   * @param opts.width - 图片宽度（px），默认使用构造参数 defaultWidth
   * @param opts.theme - 主题（'light' | 'dark'），当前版本仅支持 light，保留接口兼容
   * @returns PNG 字节数据（Buffer）
   * @throws {MarkdownRenderError} 内容为空、渲染超时或浏览器不可用时抛出
   */
  async render(
    markdown: string,
    opts: { width?: number; theme?: 'light' | 'dark' } = {},
  ): Promise<Buffer> {
    if (markdown.trim() === '') {
      throw new MarkdownRenderError('Markdown 内容不能为空')
    }

    const w = opts.width ?? this._defaultWidth

    const htmlFragment = markdownToHtml(markdown)
    const html = this._partialTemplate
      .replace('__WIDTH__', String(w))
      .replace('__HTML_CONTENT__', htmlFragment)

    try {
      return await this.browserService.renderHtml(html, {
        viewportWidth: w + this._padding * 2,
        selector: '#content',
      })
    } catch (err) {
      if (err instanceof BrowserRenderError) {
        throw new MarkdownRenderError(`渲染失败：${err.message}`)
      }
      throw new MarkdownRenderError(`渲染失败：${String(err)}`)
    }
  }
}
