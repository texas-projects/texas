/** 模板注册表 + 动态加载器，合并在同一文件以避免循环导入。 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { TemplateFunction, TemplateRegistry } from './types.js'

class TemplateRegistryImpl {
  private readonly map: TemplateRegistry = new Map()

  register(name: string, fn: TemplateFunction): void {
    this.map.set(name, fn)
  }

  get(name: string): TemplateFunction | undefined {
    return this.map.get(name)
  }

  has(name: string): boolean {
    return this.map.has(name)
  }
}

export const templateRegistry = new TemplateRegistryImpl()

export function registerTemplate(name: string, fn: TemplateFunction): void {
  templateRegistry.register(name, fn)
}

/** 扫描 ./templates/ 子目录，动态 import 触发各模板的自注册副作用。 */
export async function loadTemplates(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'templates')
  const files = readdirSync(dir).filter(
    (f) => !f.endsWith('.d.ts') && (f.endsWith('.js') || f.endsWith('.ts')),
  )
  for (const file of files) {
    await import(pathToFileURL(join(dir, file)).href)
  }
}
