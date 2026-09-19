import { execFile } from 'node:child_process'

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly args: string[],
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitRunOptions {
  /** Exit codes (besides 0) that should not throw */
  allowCodes?: number[]
  input?: string
  env?: Record<string, string>
}

export interface GitRunResult {
  stdout: string
  stderr: string
  code: number
}

const BASE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_OPTIONAL_LOCKS: '0',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
}

/** Config overrides applied to every invocation (silence noisy, irrelevant advice). */
const BASE_ARGS = ['-c', 'advice.useCoreFSMonitorConfig=false', '-c', 'advice.detachedHead=false']

export function gitRaw(
  cwd: string,
  args: string[],
  opts: GitRunOptions = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...BASE_ARGS, ...args],
      {
        cwd,
        maxBuffer: 512 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ...BASE_ENV, ...opts.env },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : error
              ? -1
              : 0
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GitError('git executable not found in PATH', -1, '', '', args))
          return
        }
        if (code !== 0 && !(opts.allowCodes ?? []).includes(code)) {
          const msg = (stderr || stdout || error?.message || `git exited with code ${code}`).trim()
          reject(new GitError(msg, code, stdout, stderr, args))
          return
        }
        resolve({ stdout, stderr, code })
      },
    )
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    } else {
      child.stdin?.end()
    }
  })
}

/** Run git and return stdout. Throws GitError on failure. */
export async function git(cwd: string, args: string[], opts: GitRunOptions = {}): Promise<string> {
  const r = await gitRaw(cwd, args, opts)
  return r.stdout
}

/** Run git and return stdout, or null on any failure. */
export async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}

/** Run git and return combined stdout+stderr as human readable output (used for actions). */
export async function gitOutput(
  cwd: string,
  args: string[],
  opts: GitRunOptions = {},
): Promise<string> {
  const r = await gitRaw(cwd, args, opts)
  return [r.stdout, r.stderr]
    .filter((s) => s.trim().length > 0)
    .join('\n')
    .trim()
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const out = await git(dir, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

export async function repoRoot(dir: string): Promise<string | null> {
  const out = await gitOrNull(dir, ['rev-parse', '--show-toplevel'])
  return out ? out.trim() : null
}

/** Reject values that could be interpreted as git options. */
export function assertSafeArg(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`)
  }
  if (value.startsWith('-')) {
    throw new Error(`${label} must not start with "-"`)
  }
  if (/[\0\n\r]/.test(value)) {
    throw new Error(`${label} contains invalid characters`)
  }
  return value
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

export function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`)
  }
  return value.map((v) => {
    if (typeof v !== 'string' || v.length === 0 || /[\0\n\r]/.test(v)) {
      throw new Error(`${label} contains an invalid entry`)
    }
    return v
  })
}
