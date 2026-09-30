import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { isLoopbackHost } from '../shared/local.ts'

/** Require a direct loopback connection; forwarded client addresses are not trusted. */
export function isLocalRequest(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address
    if (!address || !isLoopbackHost(address) || !isLoopbackHost(new URL(c.req.url).hostname)) {
      return false
    }
    if (
      c.req.header('forwarded') ||
      c.req.header('x-forwarded-for') ||
      c.req.header('x-forwarded-host')
    ) {
      return false
    }
    const origin = c.req.header('origin')
    return !origin || isLoopbackHost(new URL(origin).hostname)
  } catch {
    return false
  }
}
