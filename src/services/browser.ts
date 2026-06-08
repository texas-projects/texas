/**
 * 浏览器渲染服务 —— 重导出 BrowserService 单例。
 *
 * 生命周期（启动 / 关闭 Playwright Chromium）已在 core/browser/service.ts 中注册，
 * 此处仅作为 services/ 层的统一入口重导出，供其他服务依赖。
 */

export { browserService, BrowserService } from '@/core/browser/service.js'
