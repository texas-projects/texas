import { describe, expect, it, vi, beforeEach } from 'vitest'

import { RenderService } from '@/renderer/service.js'
import type { TemplateFunction } from '@/renderer/types.js'

vi.mock('@/core/logging/index.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('satori', () => ({
  default: vi.fn().mockResolvedValue('<svg width="800" height="1200"></svg>'),
}))

vi.mock('@resvg/resvg-js', () => ({
  Resvg: vi.fn(function () {
    return {
      render: () => ({
        asPng: () => Buffer.from('PNG'),
        width: 800,
        height: 100,
        pixels: new Uint8Array(800 * 100 * 4).fill(255),
      }),
    }
  }),
}))

// Mock the fonts module using its path as seen from service.ts
vi.mock('@/renderer/fonts.js', () => ({
  loadFonts: vi
    .fn()
    .mockResolvedValue([{ name: 'test', data: Buffer.alloc(1), weight: 400, style: 'normal' }]),
}))

describe('RenderService', () => {
  let service: RenderService

  beforeEach(() => {
    service = new RenderService()
  })

  it('throws RenderError if not initialized', async () => {
    service.register('test', () => ({ type: 'div', props: {} }))
    await expect(service.render('test', {})).rejects.toThrow('Renderer not initialized')
  })

  it('throws TemplateNotFoundError for unknown template', async () => {
    await service.initialize()
    await expect(service.render('unknown', {})).rejects.toThrow('Template not found: unknown')
  })

  it('renders registered template to PNG buffer', async () => {
    const tpl: TemplateFunction = () => ({ type: 'div', props: { children: 'hello' } })
    service.register('greeting', tpl)
    await service.initialize()
    const buf = await service.render('greeting', {})
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
})
