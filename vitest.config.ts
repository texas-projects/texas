import { transform } from 'esbuild'
import { defineConfig } from 'vitest/config'

/** Vite 插件：使用 esbuild 变换 TypeScript，以支持 TC39 Stage 3 装饰器（oxc 暂不支持） */
const esbuildDecoratorPlugin = {
  name: 'esbuild-decorator-compat',
  enforce: 'pre' as const,
  async transform(code: string, id: string) {
    if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return null
    if (id.includes('node_modules')) return null
    const result = await transform(code, {
      target: 'es2022',
      loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
      sourcefile: id,
      sourcemap: true,
    })
    return { code: result.code, map: result.map }
  },
}

export default defineConfig({
  plugins: [esbuildDecoratorPlugin],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [],
    },
    projects: [
      {
        plugins: [esbuildDecoratorPlugin],
        resolve: { tsconfigPaths: true },
        test: {
          name: 'backend',
          root: '.',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      'frontend',
    ],
  },
})
