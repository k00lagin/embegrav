#!/usr/bin/env node
// Entry point: runs the TypeScript server through tsx.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const child = spawn(
  process.execPath,
  ['--import', 'tsx', join(root, 'server', 'index.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: process.cwd() },
)
child.on('exit', (code) => process.exit(code ?? 0))
