import { describe, expect, it } from 'vitest'

import { AppError } from '@/core/errors.js'
import { TemplateNotFoundError, TemplateRenderError, RenderError } from '@/renderer/errors.js'

describe('Renderer errors', () => {
  it('TemplateNotFoundError extends AppError', () => {
    const err = new TemplateNotFoundError('missing')
    expect(err).toBeInstanceOf(AppError)
    expect(err.message).toBe('Template not found: missing')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('TemplateNotFoundError')
  })

  it('TemplateRenderError carries cause', () => {
    const cause = new Error('boom')
    const err = new TemplateRenderError('help', cause)
    expect(err).toBeInstanceOf(AppError)
    expect(err.message).toBe('Template render failed: help')
    expect(err.cause).toBe(cause)
  })

  it('RenderError carries message and optional cause', () => {
    const cause = new Error('oops')
    const err = new RenderError('Image render failed', cause)
    expect(err).toBeInstanceOf(AppError)
    expect(err.message).toBe('Image render failed')
    expect(err.cause).toBe(cause)

    const err2 = new RenderError('Renderer not initialized')
    expect(err2.message).toBe('Renderer not initialized')
    expect(err2.cause).toBeUndefined()
  })
})
