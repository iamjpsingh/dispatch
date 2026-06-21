// src/services/queue/suppressionStore.ts - PG-backed suppression list (async).
// Replaces the SQLite suppression methods in queueDatabase. user_id-keyed to
// match uq_suppress_user_email; emails lowercased; INSERT ... ON CONFLICT DO NOTHING.
import { and, eq, desc, or } from 'drizzle-orm'
import { getDb } from '../../db/pg/client'
import { suppression_list, type SuppressionRow } from '../../db/pg/schema'
import { generateId } from '../../utils/id'
import { hashEmail } from '../../utils/suppressionHash'

export const suppressionStore = {
  async isSuppressed(userId: string, email: string): Promise<boolean> {
    const normalized = email.toLowerCase()
    const hash = hashEmail(normalized)
    const [row] = await getDb()
      .select({ id: suppression_list.id })
      .from(suppression_list)
      .where(and(eq(suppression_list.user_id, userId), or(eq(suppression_list.email, normalized), eq(suppression_list.email_hash, hash))))
      .limit(1)
    return !!row
  },

  async suppressByHash(userId: string, orgId: string | null, emailHash: string, reason: string): Promise<void> {
    await getDb()
      .insert(suppression_list)
      .values({ id: generateId('sup'), user_id: userId, org_id: orgId, email: null, email_hash: emailHash, reason })
      .onConflictDoNothing({ target: [suppression_list.user_id, suppression_list.email_hash] })
  },

  async suppress(userId: string, email: string, reason: string, source?: string): Promise<void> {
    await getDb()
      .insert(suppression_list)
      .values({ id: generateId('sup'), user_id: userId, email: email.toLowerCase(), reason, source: source ?? null })
      .onConflictDoNothing({ target: [suppression_list.user_id, suppression_list.email] })
  },

  async unsuppress(userId: string, email: string): Promise<boolean> {
    const deleted = await getDb()
      .delete(suppression_list)
      .where(and(eq(suppression_list.user_id, userId), eq(suppression_list.email, email.toLowerCase())))
      .returning({ id: suppression_list.id })
    return deleted.length > 0
  },

  async getSuppressionList(userId: string, limit = 50, offset = 0): Promise<SuppressionRow[]> {
    return getDb()
      .select()
      .from(suppression_list)
      .where(eq(suppression_list.user_id, userId))
      .orderBy(desc(suppression_list.created_at))
      .limit(limit)
      .offset(offset)
  },
}
