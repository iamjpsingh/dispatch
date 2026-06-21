import { createHmac } from 'node:crypto'

/**
 * One-way, deterministic hash of an email for suppression-by-hash (GDPR erasure
 * keeps recipients suppressed without retaining their address). Server-only
 * secret; not reversible.
 */
export function hashEmail(email: string): string {
  const secret = process.env.SUPPRESSION_HASH_SECRET
  if (!secret) throw new Error('SUPPRESSION_HASH_SECRET is not set')
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex')
}
