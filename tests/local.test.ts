import { expect, it } from 'vitest'
import { Hono } from 'hono'
import { isLocalRequest } from '../server/local.ts'

const app = new Hono()
app.get('/', (c) => c.json({ local: isLocalRequest(c) }))

it.each([
  ['http://localhost/', '127.0.0.1', {}, true],
  ['http://127.0.0.1/', '::ffff:127.0.0.1', {}, true],
  ['http://[::1]/', '::1', { origin: 'http://[::1]:3210' }, true],
  ['http://localhost/', '192.168.1.20', {}, false],
  ['http://192.168.1.10/', '127.0.0.1', {}, false],
  ['http://localhost/', '127.0.0.1', { origin: 'https://remote.example' }, false],
  ['http://localhost/', '127.0.0.1', { 'x-forwarded-for': '192.168.1.20' }, false],
  ['http://localhost/', '127.0.0.1', { forwarded: 'for=192.168.1.20' }, false],
  ['http://localhost/', '127.0.0.1', { 'x-forwarded-host': 'remote.example' }, false],
  ['http://localhost/', undefined, {}, false],
])('checks direct local access: %s from %s with %j', async (url, address, headers, local) => {
  const response = await app.fetch(new Request(url, { headers: headers as HeadersInit }), {
    incoming: { socket: { remoteAddress: address } },
  })
  expect(await response.json()).toEqual({ local })
})

it('disables local actions when connection information is unavailable', async () => {
  const response = await app.request('http://localhost/')
  expect(await response.json()).toEqual({ local: false })
})
