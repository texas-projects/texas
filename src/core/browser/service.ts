/**
 * 通用浏览器渲染服务 —— Playwright Chromium 生命周期管理与 HTML-to-PNG API。
 */

import { chromium } from 'playwright'
import type { Browser, BrowserContext, Route } from 'playwright'

import { Shutdown, Startup } from '@/core/lifecycle/registry.js'

// ── 启动参数（容器 / CI 环境兼容）──

/** Chromium 启动参数（Docker 沙箱兼容）。 */
const CHROMIUM_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
]

// ── 异常类 ──

/** 浏览器渲染失败异常。 */
export class BrowserRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserRenderError'
  }
}

// ── 路由中止处理器 ──

/** Playwright route handler：中止所有匹配的网络请求（防止 SSRF）。 */
async function abortRoute(route: Route): Promise<void> {
  await route.abort()
}

// ── BrowserService ──

/**
 * 通用 Playwright Chromium 渲染服务。
 *
 * 管理无头浏览器生命周期，提供异步 HTML-to-PNG 渲染 API。
 * 使用前须调用 start()，应用关闭时调用 stop()。
 *
 * render_html() 默认以 jsEnabled=false、blockNetwork=true 运行，
 * 在 Playwright 浏览器上下文层面禁用 JS 执行并阻断所有网络请求，
 * 无需调用方对 html 内容进行预净化。
 *
 * 用法：
 * ```ts
 * const browser = new BrowserService()
 * await browser.start()
 * const png = await browser.renderHtml('<html>...</html>', { selector: '#content' })
 * await browser.stop()
 * ```
 */
export class BrowserService {
  private _browser: Browser | undefined = undefined
  private _semCount = 0
  private readonly _maxConcurrent: number

  constructor(maxConcurrentRenders = 4) {
    this._maxConcurrent = maxConcurrentRenders
  }

  /** 浏览器是否正在运行。 */
  get isRunning(): boolean {
    return this._browser?.isConnected() ?? false
  }

  /**
   * 启动 Playwright Chromium 浏览器实例。
   *
   * 若 Chromium 未安装，抛出 BrowserRenderError 并提示执行 playwright install chromium。
   */
  async start(): Promise<void> {
    await this._launchBrowser()
  }

  /**
   * 关闭浏览器实例，释放资源。应在应用关闭时调用。
   */
  async stop(): Promise<void> {
    if (this._browser !== undefined) {
      await this._browser.close()
      this._browser = undefined
    }
  }

  /**
   * 创建一个新的 BrowserContext。
   *
   * 调用方负责在使用完毕后调用 context.close()。
   *
   * @throws {BrowserRenderError} 浏览器未启动时抛出
   */
  async newContext(): Promise<BrowserContext> {
    if (this._browser === undefined) {
      throw new BrowserRenderError('BrowserService 未初始化，请先调用 start()')
    }
    return this._browser.newContext()
  }

  /**
   * 将完整 HTML 文档渲染为 PNG 图片字节。
   *
   * @param html - 完整 HTML 文档字符串（应含 <!DOCTYPE html>）
   * @param opts.jsEnabled - 是否允许 JavaScript 执行，默认 false
   * @param opts.blockNetwork - 是否阻断所有 HTTP/HTTPS 网络请求，默认 true
   * @param opts.viewportWidth - 视口宽度（px），默认 800
   * @param opts.viewportHeight - 视口高度（px），默认 1（自动撑开）
   * @param opts.selector - 截图目标 CSS 选择器，默认 "body"
   * @param opts.timeout - 截图超时（ms），默认 10000
   * @returns PNG 字节数据（Buffer）
   * @throws {BrowserRenderError} 浏览器不可用、渲染超时或截图失败时抛出
   */
  async renderHtml(
    html: string,
    opts: {
      jsEnabled?: boolean
      blockNetwork?: boolean
      viewportWidth?: number
      viewportHeight?: number
      selector?: string
      timeout?: number
    } = {},
  ): Promise<Buffer> {
    const {
      jsEnabled = false,
      blockNetwork = true,
      viewportWidth = 800,
      viewportHeight = 1,
      selector = 'body',
      timeout = 10_000,
    } = opts

    if (this._browser === undefined) {
      throw new BrowserRenderError('BrowserService 未初始化，请先调用 start()')
    }

    // 简单的并发限制计数器（轻量替代 semaphore）
    if (this._semCount >= this._maxConcurrent) {
      throw new BrowserRenderError(`并发渲染数已达上限 ${String(this._maxConcurrent)}，请稍后重试`)
    }

    this._semCount++
    let context: BrowserContext | undefined

    try {
      if (!this._browser.isConnected()) {
        throw new BrowserRenderError('浏览器实例已断连，请重启服务')
      }

      context = await this._browser.newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        javaScriptEnabled: jsEnabled,
      })

      if (blockNetwork) {
        await context.route('**/*', abortRoute)
      }

      const page = await context.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      const element = page.locator(selector)
      const pngBytes = await element.screenshot({ type: 'png', timeout })
      return Buffer.from(pngBytes)
    } catch (err) {
      if (err instanceof BrowserRenderError) throw err
      throw new BrowserRenderError(`渲染失败：${String(err)}`)
    } finally {
      if (context !== undefined) {
        await context.close()
      }
      this._semCount--
    }
  }

  // ── 内部方法 ──

  private async _launchBrowser(): Promise<void> {
    const launchArgs: string[] = [...CHROMIUM_ARGS]

    const executablePath = process.env.PLAYWRIGHT_BROWSERS_PATH

    try {
      this._browser = await chromium.launch({
        headless: true,
        args: launchArgs,
        ...(executablePath !== undefined && executablePath !== '' ? { executablePath } : {}),
      })
    } catch (err) {
      const msg = String(err)
      if (msg.includes("Executable doesn't exist") || msg.toLowerCase().includes('not found')) {
        throw new BrowserRenderError('Chromium 未安装，请执行：npx playwright install chromium')
      }
      throw new BrowserRenderError(`浏览器启动失败：${msg}`)
    }
  }
}

// ── 单例实例 ──

/** BrowserService 全局单例（由生命周期系统管理，不应直接调用 start/stop）。 */
export const browserService = new BrowserService()

// ── 生命周期注册 ──

Startup({
  name: 'browser',
  provides: ['browser'],
  requires: [],
})(async (_deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  await browserService.start()
  return { browser: browserService }
})

Shutdown({ name: 'browser' })(async (_services: Record<string, unknown>): Promise<void> => {
  await browserService.stop()
})
