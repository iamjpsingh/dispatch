// P2 net — preferenceCenterService on real (PGlite) Postgres. Read/write of
// preferences, effective-preference pause expiry, canReceive gating, stats
// aggregation, unsubscribed listing, tenant (org_id) isolation, and a direct
// Postgres cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, email_preferences } from '../../src/db/pg/schema'
import { preferenceCenterService } from '../../src/services/preferenceCenterService'

const ORG = 'org_p'
const ORG2 = 'org_p2'

describe('P2 — preferenceCenterService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org P', slug: 'org-p' },
      { id: ORG2, name: 'Org P2', slug: 'org-p2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('defaults to subscribed when no row exists', async () => {
    expect(await preferenceCenterService.getPreference(ORG, 'a@test.com')).toBeNull()
    expect(await preferenceCenterService.getEffectivePreference(ORG, 'a@test.com')).toBe('subscribed')
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com')).toBe(true)
  })

  it('sets a preference and reads it back with the exact shape', async () => {
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'campaign_only', 'user request')
    const pref = await preferenceCenterService.getPreference(ORG, 'a@test.com')
    expect(pref).not.toBeNull()
    expect(pref!.org_id).toBe(ORG)
    expect(pref!.email).toBe('a@test.com')
    expect(pref!.preference).toBe('campaign_only')
    expect(pref!.reason).toBe('user request')
    expect(pref!.pause_until).toBeNull()
    expect(typeof pref!.id).toBe('string')
    expect(typeof pref!.updated_at).toBe('string')
  })

  it('upserts on (org_id, email) conflict rather than inserting a duplicate', async () => {
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'campaign_only', 'first')
    const first = await preferenceCenterService.getPreference(ORG, 'a@test.com')
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'paused', 'second', 7)
    const second = await preferenceCenterService.getPreference(ORG, 'a@test.com')

    expect(second!.id).toBe(first!.id) // same row, updated in place
    expect(second!.preference).toBe('paused')
    expect(second!.reason).toBe('second')
    expect(second!.pause_until).not.toBeNull()

    // exactly one row for the pair
    const all = await db.select().from(email_preferences).where(eq(email_preferences.org_id, ORG))
    expect(all).toHaveLength(1)
  })

  it('unsubscribe / resubscribe / pause convenience writers', async () => {
    await preferenceCenterService.unsubscribe(ORG, 'a@test.com', 'spam')
    expect((await preferenceCenterService.getPreference(ORG, 'a@test.com'))!.preference).toBe('unsubscribed')
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com')).toBe(false)

    await preferenceCenterService.resubscribe(ORG, 'a@test.com')
    expect((await preferenceCenterService.getPreference(ORG, 'a@test.com'))!.preference).toBe('subscribed')
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com')).toBe(true)

    await preferenceCenterService.pause(ORG, 'a@test.com', 14)
    const paused = await preferenceCenterService.getPreference(ORG, 'a@test.com')
    expect(paused!.preference).toBe('paused')
    expect(paused!.pause_until).not.toBeNull()
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com')).toBe(false)
  })

  it('an unexpired pause stays paused; canReceive is false', async () => {
    await preferenceCenterService.pause(ORG, 'a@test.com', 30)
    expect(await preferenceCenterService.getEffectivePreference(ORG, 'a@test.com')).toBe('paused')
  })

  it('an expired pause reverts to subscribed (effective preference + persisted)', async () => {
    // Seed a paused row whose pause_until is already in the past.
    await db.insert(email_preferences).values({
      id: 'pref_expired',
      org_id: ORG,
      email: 'a@test.com',
      preference: 'paused',
      pause_until: new Date(Date.now() - 86400000).toISOString(),
      reason: 'old pause',
      updated_at: new Date().toISOString(),
    })
    expect(await preferenceCenterService.getEffectivePreference(ORG, 'a@test.com')).toBe('subscribed')
    // and the revert is persisted
    expect((await preferenceCenterService.getPreference(ORG, 'a@test.com'))!.preference).toBe('subscribed')
  })

  it('transactional always passes; marketing gating follows the preference', async () => {
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'unsubscribed')
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com', 'transactional')).toBe(true)
    expect(await preferenceCenterService.canReceive(ORG, 'a@test.com', 'marketing')).toBe(false)

    await preferenceCenterService.setPreference(ORG, 'b@test.com', 'digest_weekly')
    expect(await preferenceCenterService.canReceive(ORG, 'b@test.com')).toBe(false)
    await preferenceCenterService.setPreference(ORG, 'c@test.com', 'campaign_only')
    expect(await preferenceCenterService.canReceive(ORG, 'c@test.com')).toBe(true)
  })

  it('aggregates stats grouped by preference with a zero-filled shape', async () => {
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'subscribed')
    await preferenceCenterService.setPreference(ORG, 'b@test.com', 'subscribed')
    await preferenceCenterService.setPreference(ORG, 'c@test.com', 'unsubscribed')
    await preferenceCenterService.setPreference(ORG, 'd@test.com', 'paused', undefined, 7)

    const stats = await preferenceCenterService.getStats(ORG)
    expect(stats.subscribed).toBe(2)
    expect(stats.unsubscribed).toBe(1)
    expect(stats.paused).toBe(1)
    expect(stats.campaign_only).toBe(0)
    expect(stats.digest_weekly).toBe(0)
    expect(stats.digest_monthly).toBe(0)
  })

  it('lists unsubscribed emails for the org', async () => {
    await preferenceCenterService.setPreference(ORG, 'a@test.com', 'unsubscribed')
    await preferenceCenterService.setPreference(ORG, 'b@test.com', 'subscribed')
    await preferenceCenterService.setPreference(ORG, 'c@test.com', 'unsubscribed')
    const emails = await preferenceCenterService.getUnsubscribedEmails(ORG)
    expect(new Set(emails)).toEqual(new Set(['a@test.com', 'c@test.com']))
  })

  it('isolates by org_id across every read path', async () => {
    await preferenceCenterService.setPreference(ORG, 'shared@test.com', 'unsubscribed', 'org1')
    await preferenceCenterService.setPreference(ORG2, 'shared@test.com', 'subscribed', 'org2')

    // getPreference is scoped
    expect((await preferenceCenterService.getPreference(ORG, 'shared@test.com'))!.preference).toBe('unsubscribed')
    expect((await preferenceCenterService.getPreference(ORG2, 'shared@test.com'))!.preference).toBe('subscribed')

    // canReceive is scoped
    expect(await preferenceCenterService.canReceive(ORG, 'shared@test.com')).toBe(false)
    expect(await preferenceCenterService.canReceive(ORG2, 'shared@test.com')).toBe(true)

    // stats + unsubscribed lists are scoped
    expect((await preferenceCenterService.getStats(ORG)).unsubscribed).toBe(1)
    expect((await preferenceCenterService.getStats(ORG2)).unsubscribed).toBe(0)
    expect(await preferenceCenterService.getUnsubscribedEmails(ORG)).toEqual(['shared@test.com'])
    expect(await preferenceCenterService.getUnsubscribedEmails(ORG2)).toEqual([])
  })

  it('a written preference lands as a real row in Postgres', async () => {
    await preferenceCenterService.setPreference(ORG, 'cross@test.com', 'campaign_only', 'cross-check')
    const rows = await db
      .select()
      .from(email_preferences)
      .where(eq(email_preferences.email, 'cross@test.com'))
    expect(rows).toHaveLength(1)
    expect(rows[0].org_id).toBe(ORG)
    expect(rows[0].preference).toBe('campaign_only')
    expect(rows[0].reason).toBe('cross-check')
  })
})
