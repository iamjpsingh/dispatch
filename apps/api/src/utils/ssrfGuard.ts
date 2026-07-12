// src/utils/ssrfGuard.ts — SSRF guard for server-initiated fetches to user-supplied URLs.
// Resolves the host and rejects any URL that targets a private / reserved / loopback /
// link-local address (incl. cloud metadata 169.254.169.254). Because it checks the RESOLVED
// address, it also defeats DNS-name and decimal/hex-encoded bypasses of an IP-literal blocklist.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** IPv4 in a private/reserved/loopback/link-local/CGNAT/unspecified range. Malformed → blocked. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (AWS/GCP metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  return false
}

/** IPv6 loopback/unspecified/unique-local/link-local, or an IPv4-mapped blocked address. */
function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0] // strip zone id
  if (v === '::1' || v === '::') return true // loopback / unspecified
  if (v.startsWith('fc') || v.startsWith('fd')) return true // fc00::/7 unique-local
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true // fe80::/10 link-local
  const mapped = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/) // ::ffff:a.b.c.d
  if (mapped) return isBlockedIpv4(mapped[1])
  return false
}

function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return isBlockedIpv4(ip)
  if (fam === 6) return isBlockedIpv6(ip)
  return true // not a valid IP literal → block
}

/**
 * True if `rawUrl` is safe to fetch server-side: an http(s) URL whose host resolves ONLY to
 * public addresses. DNS names are resolved and every returned address must be public.
 */
export async function isPublicHttpUrl(rawUrl: string): Promise<boolean> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false

  const host = u.hostname
  if (isIP(host)) return !isBlockedIp(host)

  try {
    const addrs = await lookup(host, { all: true })
    if (addrs.length === 0) return false
    return addrs.every((a) => !isBlockedIp(a.address))
  } catch {
    return false
  }
}
