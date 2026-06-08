/**
 * Markdown 渲染器服务 —— 创建 MarkdownRenderer 实例并注册生命周期。
 */

import type { BrowserService } from '@/core/browser/service.js'
import { Startup } from '@/core/lifecycle/registry.js'
import { MarkdownRenderer } from '@/core/utils/md2img.js'

export { MarkdownRenderer }

/** MarkdownRenderer 全局导出引用（生命周期启动后有效）。 */
export let mdRenderer: MarkdownRenderer | null = null

// ── 生命周期注册 ──

Startup({
  name: 'md_renderer',
  provides: ['md_renderer'],
  requires: ['browser'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const browser = deps.browser as BrowserService
  const renderer = new MarkdownRenderer(browser)
  mdRenderer = renderer
  return { md_renderer: renderer }
})
