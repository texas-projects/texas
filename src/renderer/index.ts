/** src/renderer 公共导出。 */

export { RenderService, cropBottom } from './service.js'
export { loadFonts } from './fonts.js'
export { templateRegistry, registerTemplate, loadTemplates } from './templates.js'
export type { TemplateFunction, SatoriElement, RenderOptions } from './types.js'
export { TemplateNotFoundError, TemplateRenderError, RenderError } from './errors.js'
