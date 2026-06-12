/** RenderService —— Satori + resvg-js 渲染管线，支持 Twemoji emoji。 */

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'

import { getLogger } from '@logger'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import type { Font } from 'satori'

/** satori 第一参数类型，避免直接依赖 @types/react。 */
type SatoriInput = Parameters<typeof satori>[0]

import { RenderError, TemplateNotFoundError, TemplateRenderError } from './errors.js'
import { loadFonts } from './fonts.js'
import type { RenderOptions, SatoriElement, TemplateFunction, TemplateRegistry } from './types.js'

const log = getLogger('renderer')
const _require = createRequire(import.meta.url)

const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 1200

/** 构建 emoji → Twemoji SVG 路径映射（供 satori graphemeImages 使用）。 */
function buildGraphemeImages(): Record<string, string> {
  try {
    const pkgJson = _require.resolve('@twemoji/svg/package.json')
    const svgDir = dirname(pkgJson)
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const codepoints = Array.from(prop)
            .map((c) => c.codePointAt(0) ?? 0)
            .filter((cp) => cp !== 0xfe0f) // 去除 Variation Selector-16，Twemoji 文件名不含此码点
            .map((cp) => cp.toString(16))
            .join('-')
          return `file://${join(svgDir, `${codepoints}.svg`)}`
        },
        has: () => true,
      },
    )
  } catch {
    log.warn('@twemoji/svg 未找到，emoji 渲染降级为字体 fallback')
    return {}
  }
}

const GRAPHEME_IMAGES = buildGraphemeImages()

export class RenderService {
  private fonts: Font[] = []
  private readonly templates: TemplateRegistry = new Map()

  async initialize(): Promise<void> {
    this.fonts = await loadFonts()
    log.info({ fontCount: this.fonts.length }, 'renderer fonts loaded')
  }

  register(name: string, template: TemplateFunction): void {
    this.templates.set(name, template)
  }

  async render(name: string, data: unknown, options?: RenderOptions): Promise<Buffer> {
    if (this.fonts.length === 0) {
      throw new RenderError('Renderer not initialized')
    }

    const template = this.templates.get(name)
    if (!template) {
      throw new TemplateNotFoundError(name)
    }

    let element: SatoriElement
    try {
      element = template(data)
    } catch (err) {
      throw new TemplateRenderError(name, err)
    }

    const width = options?.width ?? DEFAULT_WIDTH
    const height = options?.height ?? DEFAULT_HEIGHT
    const satoriOpts = { width, fonts: this.fonts, graphemeImages: GRAPHEME_IMAGES }

    // 第一次渲染：大画布，获取实际内容高度
    const svgFull = await satori(element as unknown as SatoriInput, { ...satoriOpts, height })
    const resvgFull = new Resvg(Buffer.from(svgFull))
    const renderFull = resvgFull.render()
    const croppedHeight = cropBottom(renderFull.pixels, width, height)

    // 第二次渲染：按裁剪高度精确输出
    const svgFinal = await satori(element as unknown as SatoriInput, {
      ...satoriOpts,
      height: croppedHeight,
    })
    const resvgFinal = new Resvg(Buffer.from(svgFinal))
    return Buffer.from(resvgFinal.render().asPng())
  }
}

export function cropBottom(
  pixels: Uint8Array,
  width: number,
  height: number,
  padding = 16,
): number {
  for (let row = height - 1; row >= 0; row--) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4
      if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) {
        return Math.min(row + 1 + padding, height)
      }
    }
  }
  return Math.max(1, padding)
}
