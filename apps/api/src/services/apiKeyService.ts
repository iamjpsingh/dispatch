// src/services/apiKeyService.ts - PG-backed API keys (argon2id, org-scoped).
// Replaces the data/apikeys.db sqlite store. The raw key is returned ONLY on create;
// only its argon2id hash is stored. Validation is by prefix lookup + hash verify.
import argon2 from 'argon2'
import { and, eq, desc } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { api_keys } from '../db/pg/schema'
import { generateId } from '../utils/id'

function generateApiKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `dsp_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

export const apiKeyService = {
  async create(
    orgId: string,
    userId: string,
    name: string,
    scopes: string[],
    expiresAt?: string
  ): Promise<{ id: string; key: string; keyPrefix: string }> {
    const id = generateId('ak')
    const key = generateApiKey()
    const keyPrefix = key.substring(0, 8)
    const keyHash = await argon2.hash(key, { type: argon2.argon2id })
    await getDb().insert(api_keys).values({
      id,
      org_id: orgId,
      user_id: userId,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: JSON.stringify(scopes),
      expires_at: expiresAt ?? null,
    })
    return { id, key, keyPrefix }
  },

  /** Safe list for the UI — never selects key_hash. Org-scoped. */
  async list(orgId: string) {
    return getDb()
      .select({
        id: api_keys.id,
        name: api_keys.name,
        key_prefix: api_keys.key_prefix,
        scopes: api_keys.scopes,
        last_used_at: api_keys.last_used_at,
        expires_at: api_keys.expires_at,
        enabled: api_keys.enabled,
        created_at: api_keys.created_at,
      })
      .from(api_keys)
      .where(eq(api_keys.org_id, orgId))
      .orderBy(desc(api_keys.created_at))
  },

  async revoke(orgId: string, keyId: string): Promise<boolean> {
    const deleted = await getDb()
      .delete(api_keys)
      .where(and(eq(api_keys.id, keyId), eq(api_keys.org_id, orgId)))
      .returning({ id: api_keys.id })
    return deleted.length > 0
  },

  async toggle(orgId: string, keyId: string, enabled: boolean): Promise<boolean> {
    const updated = await getDb()
      .update(api_keys)
      .set({ enabled: enabled ? 1 : 0 })
      .where(and(eq(api_keys.id, keyId), eq(api_keys.org_id, orgId)))
      .returning({ id: api_keys.id })
    return updated.length > 0
  },

  async updateScopes(orgId: string, keyId: string, scopes: string[]): Promise<boolean> {
    const updated = await getDb()
      .update(api_keys)
      .set({ scopes: JSON.stringify(scopes) })
      .where(and(eq(api_keys.id, keyId), eq(api_keys.org_id, orgId)))
      .returning({ id: api_keys.id })
    return updated.length > 0
  },

  /** Verify a raw key. Returns the owning identity + scopes, or null. Stamps last_used. */
  async validate(key: string): Promise<{ userId: string; orgId: string; scopes: string[] } | null> {
    const prefix = key.substring(0, 8)
    const candidates = await getDb()
      .select()
      .from(api_keys)
      .where(and(eq(api_keys.key_prefix, prefix), eq(api_keys.enabled, 1)))

    for (const candidate of candidates) {
      if (candidate.expires_at && new Date(candidate.expires_at) < new Date()) continue
      if (await argon2.verify(candidate.key_hash, key)) {
        await getDb().update(api_keys).set({ last_used_at: new Date().toISOString() }).where(eq(api_keys.id, candidate.id))
        return { userId: candidate.user_id, orgId: candidate.org_id ?? '', scopes: JSON.parse(candidate.scopes) }
      }
    }
    return null
  },
}
