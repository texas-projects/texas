// tests/unit/core/framework/loader.test.ts
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { EchoConfig } from '@/core/echo/config.js'
import { EchoLoader } from '@/core/echo/loader.js'
import type { TaskEchoEntry, RouteEchoEntry } from '@/core/echo/loader.js'

const TMP_DIR = resolve(import.meta.dirname, '__fixtures_loader__')

async function createFixture(relPath: string, content: string) {
  const full = resolve(TMP_DIR, relPath)
  await mkdir(resolve(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

describe('EchoLoader', () => {
  beforeEach(async () => {
    await mkdir(TMP_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true })
  })

  it('扫描目录发现 .ts 文件', async () => {
    await createFixture('handlers/echo.ts', 'export {}')
    const config: EchoConfig = {
      echoes: { handler: ['handlers'], service: [], task: [], route: [] },
    }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('handler')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]?.filePath).toContain('echo.ts')
  })

  it('排除匹配 exclude 模式的文件', async () => {
    await createFixture('apis/user.ts', 'export default async function plugin() {}')
    await createFixture('apis/schemas/user-schema.ts', 'export {}')
    const config: EchoConfig = {
      echoes: {
        handler: [],
        service: [],
        task: [],
        route: { dirs: ['apis'], exclude: ['**/schemas/**'] },
      },
    }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('route')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.filePath).toContain('user.ts')
  })

  it('目录不存在时跳过不报错', async () => {
    const config: EchoConfig = {
      echoes: { handler: ['nonexistent'], service: [], task: [], route: [] },
    }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('handler')
    expect(entries).toHaveLength(0)
  })

  it('discoverByType(task) 收集 taskDefinition 导出', async () => {
    await createFixture(
      'tasks/my-task.js',
      `
      export const taskDefinition = {
        jobName: 'my_task',
        processor: async () => ({}),
        requires: ['db'],
      }
    `,
    )
    const config: EchoConfig = { echoes: { handler: [], service: [], task: ['tasks'], route: [] } }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('task')
    expect(entries).toHaveLength(1)
    expect((entries[0] as TaskEchoEntry).taskDefinition.jobName).toBe('my_task')
  })

  it('discoverByType(route) 收集 export default 函数', async () => {
    await createFixture(
      'routes/health.js',
      'export default async function plugin(app) { app.get("/health", () => "ok") }',
    )
    const config: EchoConfig = { echoes: { handler: [], service: [], task: [], route: ['routes'] } }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('route')
    expect(entries).toHaveLength(1)
    expect(typeof (entries[0] as RouteEchoEntry).plugin).toBe('function')
  })

  it('无标准导出的文件被静默跳过', async () => {
    await createFixture('tasks/util.js', 'export function helper() {}')
    const config: EchoConfig = { echoes: { handler: [], service: [], task: ['tasks'], route: [] } }
    const loader = new EchoLoader(config, TMP_DIR)
    const entries = await loader.discoverByType('task')
    expect(entries).toHaveLength(0)
  })
})
