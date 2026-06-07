// P4.E net — apiKeyService: PG-backed API keys (argon2id hashes, org-scoped).
// Replaces the data/apikeys.db sqlite store.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, api_keys } from '../../src/db/pg/schema'
import { eq } from 'drizzle-orm'
import { apiKeyService } from '../../src/services/apiKeyService'

describe('P4.E — apiKeyService (Postgres)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: 'org-1', name: 'Org One', slug: 'org-1' },
      { id: 'org-2', name: 'Org Two', slug: 'org-2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('create returns a dsp_ key + prefix and stores an argon2 hash (not the raw key)', async () => {
    const { id, key, keyPrefix } = await apiKeyService.create('org-1', 'user-1', 'CI key', ['read', 'send'])
    expect(key).toMatch(/^dsp_/)
    expect(keyPrefix).toBe(key.substring(0, 8))
    const [row] = await db.select().from(api_keys).where(eq(api_keys.id, id))
    expect(row.key_hash).not.toBe(key)
    expect(row.key_hash).toMatch(/^\$argon2/)
    expect(JSON.parse(row.scopes)).toEqual(['read', 'send'])
  })

  it('list is org-scoped and never exposes the hash', async () => {
    await apiKeyService.create('org-1', 'user-1', 'k1', ['read'])
    await apiKeyService.create('org-2', 'user-2', 'k2', ['read'])
    const list = await apiKeyService.list('org-1')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('k1')
    expect((list[0] as Record<string, unknown>).key_hash).toBeUndefined()
  })

  it('validate verifies the hash, returns identity + scopes, and stamps last_used', async () => {
    const { id, key } = await apiKeyService.create('org-1', 'user-7', 'k', ['read', 'campaigns'])
    const res = await apiKeyService.validate(key)
    expect(res).toEqual({ userId: 'user-7', orgId: 'org-1', scopes: ['read', 'campaigns'] })
    const [row] = await db.select().from(api_keys).where(eq(api_keys.id, id))
    expect(row.last_used_at).toBeTruthy()
  })

  it('validate returns null for a wrong, disabled, or expired key', async () => {
    const { id, key } = await apiKeyService.create('org-1', 'user-1', 'k', ['read'])
    expect(await apiKeyService.validate('dsp_deadbeef_not_a_key')).toBeNull()

    await apiKeyService.toggle('org-1', id, false)
    expect(await apiKeyService.validate(key)).toBeNull()

    await apiKeyService.toggle('org-1', id, true)
    await db.update(api_keys).set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where(eq(api_keys.id, id))
    expect(await apiKeyService.validate(key)).toBeNull()
  })

  it('revoke / toggle / updateScopes are org-scoped no-ops for the wrong org', async () => {
    const { id } = await apiKeyService.create('org-1', 'user-1', 'k', ['read'])
    expect(await apiKeyService.revoke('org-2', id)).toBe(false)
    expect(await apiKeyService.toggle('org-2', id, false)).toBe(false)
    expect(await apiKeyService.updateScopes('org-2', id, ['admin'])).toBe(false)
    // correct org works
    expect(await apiKeyService.updateScopes('org-1', id, ['admin'])).toBe(true)
    expect(await apiKeyService.revoke('org-1', id)).toBe(true)
  })
})
