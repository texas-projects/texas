// tests/unit/core/framework/echo-config.test.ts
import { describe, it, expect } from 'vitest'

import { defineConfig, normalizeEchoDirConfig } from '@/core/echo/config.js'

describe('EchoConfig', () => {
  it('defineConfig 透传配置', () => {
    const config = defineConfig({
      echoes: {
        handler: ['src/handlers'],
        service: ['src/services'],
        task: ['src/tasks'],
        route: ['src/apis'],
      },
    })
    expect(config.echoes.handler).toEqual(['src/handlers'])
  })

  it('normalizeEchoDirConfig 处理 string[] 简写', () => {
    const result = normalizeEchoDirConfig(['src/handlers'])
    expect(result).toEqual({ dirs: ['src/handlers'], exclude: [] })
  })

  it('normalizeEchoDirConfig 处理完整配置', () => {
    const result = normalizeEchoDirConfig({ dirs: ['src/apis'], exclude: ['**/schemas/**'] })
    expect(result).toEqual({ dirs: ['src/apis'], exclude: ['**/schemas/**'] })
  })
})
