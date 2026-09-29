import { defineConfig, mergeConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'node',
      testTimeout: 15_000,
      hookTimeout: 30_000,
      // Pairing tokens and sessions must never touch the real ~/.embegrav.
      env: { EMBEGRAV_HOME: join(tmpdir(), 'embegrav-test-home') },
    },
  }),
)
