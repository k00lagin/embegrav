import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'node',
      testTimeout: 15_000,
      hookTimeout: 30_000,
    },
  }),
)
