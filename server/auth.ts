import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Browser pairing.
 *
 * `embegrav pair` (or server startup) issues a short-lived, single-use pairing
 * token. The browser redeems it once for a long-lived session token, keeps the
 * session in localStorage and sends it as `Authorization: Bearer <session>`.
 *
 * Both kinds of tokens live on disk under the state directory so that the CLI
 * and a running server share them without IPC, and sessions survive restarts:
 *
 *   <state>/pairing/<sha256(token)>.json   { expiresAt }
 *   <state>/sessions/<sha256(token)>.json  { createdAt, userAgent }
 *
 * File names are hashes, so listing the directory does not reveal tokens.
 * Deleting a session file revokes that browser.
 */

export const DEFAULT_PAIRING_TTL_MS = 5 * 60_000

/** Human-friendly alphabet without 0/O/1/I; 12 symbols × 5 bits = 60 bits. */
const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PAIRING_LENGTH = 12
const PAIRING_PATTERN = new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_LENGTH}}$`)
/** 32 random bytes, base64url without padding. */
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function stateDir(): string {
  return process.env.EMBEGRAV_HOME || join(homedir(), '.embegrav')
}

const pairingDir = () => join(stateDir(), 'pairing')
const sessionDir = () => join(stateDir(), 'sessions')

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function writePrivate(dir: string, name: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, name), JSON.stringify(data), { mode: 0o600, flag: 'wx' })
}

function pairingToken(): string {
  // Rejection sampling keeps every symbol equally likely (256 is a multiple of 32,
  // but this stays correct if the alphabet changes).
  const limit = 256 - (256 % PAIRING_ALPHABET.length)
  let token = ''
  while (token.length < PAIRING_LENGTH) {
    for (const byte of randomBytes(PAIRING_LENGTH)) {
      if (byte >= limit || token.length === PAIRING_LENGTH) continue
      token += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]
    }
  }
  return token
}

/** Normalizes a typed or pasted pairing token; null when it cannot be one. */
export function normalizePairingToken(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const token = input.trim().toUpperCase()
  return PAIRING_PATTERN.test(token) ? token : null
}

export interface PairingToken {
  token: string
  expiresAt: number
}

export async function createPairingToken(
  ttlMs = DEFAULT_PAIRING_TTL_MS,
  now = Date.now(),
): Promise<PairingToken> {
  await removeExpiredPairingTokens(now)
  const token = pairingToken()
  const expiresAt = now + ttlMs
  await writePrivate(pairingDir(), `${digest(token)}.json`, { expiresAt })
  return { token, expiresAt }
}

async function removeExpiredPairingTokens(now: number): Promise<void> {
  let names: string[]
  try {
    names = await readdir(pairingDir())
  } catch {
    return
  }
  await Promise.all(
    names.map(async (name) => {
      const file = join(pairingDir(), name)
      try {
        const { expiresAt } = JSON.parse(await readFile(file, 'utf8')) as { expiresAt: number }
        if (!(expiresAt > now)) await unlink(file)
      } catch {
        /* concurrently consumed or unreadable; leave it */
      }
    }),
  )
}

let redemptions: Promise<unknown> = Promise.resolve()

/**
 * Consumes a pairing token and returns a new session token, or null when the
 * token is unknown, already used or expired.
 *
 * Redemptions run one at a time: on Windows two concurrent unlinks of the same
 * file can both succeed, so deleting the file alone does not make it single-use.
 */
export function redeemPairingToken(
  input: unknown,
  userAgent = '',
  now = Date.now(),
): Promise<string | null> {
  const result = redemptions.then(() => redeem(input, userAgent, now))
  redemptions = result.catch(() => {})
  return result
}

async function redeem(input: unknown, userAgent: string, now: number): Promise<string | null> {
  const token = normalizePairingToken(input)
  if (!token) return null
  const file = join(pairingDir(), `${digest(token)}.json`)
  let expiresAt: number
  try {
    ;({ expiresAt } = JSON.parse(await readFile(file, 'utf8')) as { expiresAt: number })
    await unlink(file)
  } catch {
    return null
  }
  if (!(expiresAt > now)) return null
  const session = randomBytes(32).toString('base64url')
  await writePrivate(sessionDir(), `${digest(session)}.json`, {
    id: randomUUID(),
    createdAt: now,
    userAgent: userAgent.slice(0, 200),
  })
  return session
}

export async function isValidSession(input: unknown): Promise<boolean> {
  if (typeof input !== 'string' || !SESSION_PATTERN.test(input)) return false
  try {
    return (await stat(join(sessionDir(), `${digest(input)}.json`))).isFile()
  } catch {
    return false
  }
}

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match ? match[1] : null
}
