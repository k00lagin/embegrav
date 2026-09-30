/** Names and addresses that refer to this machine's loopback interface. */
export function isLoopbackHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (value === 'localhost' || value === '::1') return true
  const ipv4 = value.replace(/^::ffff:/, '')
  const parts = ipv4.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}
