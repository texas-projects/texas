/** SVG 渲染系统类型定义。 */

export interface SatoriElement {
  type: string
  props: {
    style?: Record<string, unknown>
    children?: string | SatoriElement | (string | SatoriElement)[]
    [key: string]: unknown
  }
}

export type TemplateFunction<T = unknown> = (data: T) => SatoriElement

export interface RenderOptions {
  width?: number
  height?: number
}

export type TemplateRegistry = Map<string, TemplateFunction>
