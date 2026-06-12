// src/core/echo/loader.ts
/** 统一 Echo 组件发现与加载器。 */
import { readdir, stat } from 'node:fs/promises'
import { resolve, relative, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { logger } from '@logger'
import { minimatch } from 'minimatch'

import type { EchoType, EchoConfig } from './config.js'
import { normalizeEchoDirConfig } from './config.js'

import type { TaskDefinition } from '@/core/tasks/types.js'

export interface TaskEchoEntry {
  filePath: string
  taskDefinition: TaskDefinition
}

export interface RouteEchoEntry {
  filePath: string
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  plugin: Function
}

export interface GenericEchoEntry {
  filePath: string
}

export type EchoEntry = TaskEchoEntry | RouteEchoEntry | GenericEchoEntry

export interface EchoManifest {
  handlers: GenericEchoEntry[]
  services: GenericEchoEntry[]
  tasks: TaskEchoEntry[]
  routes: RouteEchoEntry[]
}

export class EchoLoader {
  private readonly _config: EchoConfig
  private readonly _baseDir: string

  constructor(config: EchoConfig, baseDir: string) {
    this._config = config
    this._baseDir = baseDir
  }

  async discoverAll(): Promise<EchoManifest> {
    const [handlers, services, tasks, routes] = await Promise.all([
      this.discoverByType('handler'),
      this.discoverByType('service'),
      this.discoverByType('task'),
      this.discoverByType('route'),
    ])
    return {
      handlers: handlers,
      services: services,
      tasks: tasks as TaskEchoEntry[],
      routes: routes as RouteEchoEntry[],
    }
  }

  async discoverByType(type: EchoType): Promise<EchoEntry[]> {
    const dirConfig = normalizeEchoDirConfig(this._config.echoes[type])
    const entries: EchoEntry[] = []
    const skipped: string[] = []

    for (const dir of dirConfig.dirs) {
      const absDir = resolve(this._baseDir, dir)
      if (!(await this._dirExists(absDir))) {
        logger.warn({ dir: absDir }, 'Echo 扫描目录不存在，跳过')
        continue
      }
      const files = await this._collectFiles(absDir, dirConfig.exclude)
      for (const file of files) {
        const entry = await this._loadFile(file, type)
        if (entry) {
          entries.push(entry)
        } else {
          skipped.push(relative(this._baseDir, file))
        }
      }
    }

    if (skipped.length > 0) {
      logger.debug({ type, count: skipped.length }, 'Echo 扫描跳过非标准导出文件')
    }
    logger.info({ type, count: entries.length }, 'Echo 扫描完成')
    return entries
  }

  private async _dirExists(dir: string): Promise<boolean> {
    try {
      const s = await stat(dir)
      return s.isDirectory()
    } catch {
      return false
    }
  }

  private async _collectFiles(dir: string, exclude: string[]): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name)
      const relPath = relative(this._baseDir, fullPath)

      if (entry.isDirectory()) {
        if (!this._isExcluded(relPath + '/', exclude)) {
          const nested = await this._collectFiles(fullPath, exclude)
          results.push(...nested)
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name)
        if ((ext === '.ts' || ext === '.js') && !entry.name.endsWith('.d.ts')) {
          if (!this._isExcluded(relPath, exclude)) {
            results.push(fullPath)
          }
        }
      }
    }
    return results
  }

  private _isExcluded(relPath: string, exclude: string[]): boolean {
    const normalized = relPath.replace(/\\/g, '/')
    return exclude.some((pattern) => minimatch(normalized, pattern))
  }

  private async _loadFile(filePath: string, type: EchoType): Promise<EchoEntry | null> {
    const fileUrl = pathToFileURL(filePath).href
    try {
      const mod = (await import(fileUrl)) as Record<string, unknown>

      switch (type) {
        case 'task': {
          const td = mod.taskDefinition as TaskDefinition | undefined
          if (td && typeof td.processor === 'function') {
            return { filePath, taskDefinition: td }
          }
          return null
        }
        case 'route': {
          if (typeof mod.default === 'function') {
            return { filePath, plugin: mod.default }
          }
          return null
        }
        case 'handler':
        case 'service': {
          return { filePath }
        }
        default:
          return null
      }
    } catch (err) {
      logger.warn({ filePath, err }, 'Echo 加载文件失败，跳过')
      return null
    }
  }
}
