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

/** Fail-fast validation for boot. Throws if SUPPRESSION_HASH_SECRET is unset, so a
 * misconfigured deploy is caught at startup rather than mid-send / mid-import —
 * hashEmail sits on the suppression hot path (per-recipient in the worker, per row
 * on import), where a missing secret would otherwise fail every send and import. */
export function assertSuppressionSecret(): void {
  if (!process.env.SUPPRESSION_HASH_SECRET) {
    throw new Error('SUPPRESSION_HASH_SECRET is required to start (used for GDPR suppression-by-hash)')
  }
}
