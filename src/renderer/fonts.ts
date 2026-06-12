/** 字体加载 —— 从 @fontsource/* 包通过 import.meta.resolve() 按需读取。 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { getLogger } from '@logger'
import type { Font } from 'satori'

const log = getLogger('renderer:fonts')

interface FontSpec {
  name: string
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  style: 'normal' | 'italic'
  resolveId: string
}

const FONT_SPECS: readonly FontSpec[] = [
  {
    name: 'Noto Sans CJK SC',
    weight: 400,
    style: 'normal',
    resolveId: '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
  },
  {
    name: 'Noto Sans',
    weight: 400,
    style: 'normal',
    resolveId: '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2',
  },
  {
    name: 'Noto Sans JP',
    weight: 400,
    style: 'normal',
    resolveId: '@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
  },
  {
    name: 'Noto Sans KR',
    weight: 400,
    style: 'normal',
    resolveId: '@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2',
  },
  {
    name: 'JetBrains Mono',
    weight: 400,
    style: 'normal',
    resolveId: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  },
] as const

async function loadFont(spec: FontSpec): Promise<Font | null> {
  try {
    const url = import.meta.resolve(spec.resolveId)
    const data = await readFile(fileURLToPath(url))
    return { name: spec.name, data, weight: spec.weight, style: spec.style }
  } catch (err) {
    log.warn({ font: spec.name, err }, '字体加载失败，跳过')
    return null
  }
}

export async function loadFonts(): Promise<Font[]> {
  const results = await Promise.all(FONT_SPECS.map(loadFont))
  const fonts = results.filter((f): f is Font => f !== null)
  log.info({ count: fonts.length, total: FONT_SPECS.length }, '字体加载完成')
  return fonts
}
