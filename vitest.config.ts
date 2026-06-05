import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [],
    },
    projects: [
      {
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
