#!/usr/bin/env node
// Keep the compiled entry beside dist/ so its asset paths also work when linked.
import { existsSync } from 'node:fs'

const entry = new URL('../dist-server/index.js', import.meta.url)
if (!existsSync(entry)) {
  console.error('Embegrav has not been built yet. Run "pnpm build" first.')
  process.exit(1)
}
await import(entry.href)
