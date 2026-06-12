/** 渲染领域异常类。 */

import { AppError } from '@/core/errors.js'

export class TemplateNotFoundError extends AppError {
  constructor(name: string) {
    super(-1, `Template not found: ${name}`, 500)
    this.name = 'TemplateNotFoundError'
  }
}

export class TemplateRenderError extends AppError {
  constructor(name: string, cause: unknown) {
    super(-1, `Template render failed: ${name}`, 500)
    this.name = 'TemplateRenderError'
    this.cause = cause
  }
}

export class RenderError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(-1, message, 500)
    this.name = 'RenderError'
    if (cause !== undefined) this.cause = cause
  }
}
