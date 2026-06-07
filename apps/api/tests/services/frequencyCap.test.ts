// P2 net — frequencyCapService on real (PGlite) Postgres. Config upsert, send
// logging, windowed COUNT, can-send cap enforcement, bulk filtering, cleanup,
// tenant (org_id) isolation, and a cross-check that a logged send lands in PG.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { and, eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, frequency_log, frequency_config } from '../../src/db/pg/schema'
import { frequencyCapService } from '../../src/services/frequencyCapService'

const ORG = 'org_f'
const ORG2 = 'org_f2'
const EMAIL = 'a@test.com'

describe('P2 — frequencyCapService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org F', slug: 'org-f' },
      { id: ORG2, name: 'Org F2', slug: 'org-f2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('returns defaults when no config row exists', async () => {
    const cfg = await frequencyCapService.getConfig(ORG)
    expect(cfg).toEqual({ maxPerWindow: 5, windowHours: 168, enabled: false })
  })

  it('upserts config (insert then update) and reads it back', async () => {
    await frequencyCapService.setConfig(ORG, 3, 24, true)
    expect(await frequencyCapService.getConfig(ORG)).toEqual({ maxPerWindow: 3, windowHours: 24, enabled: true })

    // second call hits ON CONFLICT DO UPDATE
    await frequencyCapService.setConfig(ORG, 10, 48, false)
    expect(await frequencyCapService.getConfig(ORG)).toEqual({ maxPerWindow: 10, windowHours: 48, enabled: false })

    // exactly one row (upsert, not duplicate) and enabled stored as integer flag
    const rows = await db.select().from(frequency_config).where(eq(frequency_config.org_id, ORG))
    expect(rows).toHaveLength(1)
    expect(rows[0].enabled).toBe(0)
  })

  it('logSend persists a row in Postgres (cross-check) and getCount reflects it', async () => {
    await frequencyCapService.logSend(ORG, EMAIL, 'camp_1')
    await frequencyCapService.logSend(ORG, EMAIL)

    const rows = await db.select().from(frequency_log).where(and(eq(frequency_log.org_id, ORG), eq(frequency_log.email, EMAIL)))
    expect(rows).toHaveLength(2)
    // auto-identity id was assigned by the DB (not supplied on insert)
    expect(typeof rows[0].id).toBe('number')
    expect(rows.find((r) => r.campaign_id === 'camp_1')).toBeDefined()
    expect(rows.find((r) => r.campaign_id === null)).toBeDefined()

    expect(await frequencyCapService.getCount(ORG, EMAIL)).toBe(2)
  })

  it('canSend returns true when capping disabled regardless of volume', async () => {
    for (let i = 0; i < 10; i++) await frequencyCapService.logSend(ORG, EMAIL)
    // no config => disabled by default
    expect(await frequencyCapService.canSend(ORG, EMAIL)).toBe(true)
  })

  it('canSend enforces the cap within the window when enabled', async () => {
    await frequencyCapService.setConfig(ORG, 2, 168, true)
    expect(await frequencyCapService.canSend(ORG, EMAIL)).toBe(true)
    await frequencyCapService.logSend(ORG, EMAIL)
    expect(await frequencyCapService.canSend(ORG, EMAIL)).toBe(true) // 1 < 2
    await frequencyCapService.logSend(ORG, EMAIL)
    expect(await frequencyCapService.canSend(ORG, EMAIL)).toBe(false) // 2 >= 2
  })

  it('getCount only counts sends inside the time window', async () => {
    await frequencyCapService.setConfig(ORG, 5, 24, true)
    // one send inside the window
    await frequencyCapService.logSend(ORG, EMAIL)
    // one send well outside the 24h window (2 days ago)
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    await db.insert(frequency_log).values({ org_id: ORG, email: EMAIL, campaign_id: null, sent_at: old })

    expect(await frequencyCapService.getCount(ORG, EMAIL)).toBe(1)
  })

  it('filterAllowed splits emails by cap and passes all through when disabled', async () => {
    await frequencyCapService.setConfig(ORG, 1, 168, true)
    await frequencyCapService.logSend(ORG, 'capped@test.com') // now at cap (1)

    const res = await frequencyCapService.filterAllowed(ORG, ['fresh@test.com', 'capped@test.com'])
    expect(res.allowed).toEqual(['fresh@test.com'])
    expect(res.capped).toEqual(['capped@test.com'])

    // disabled => everything allowed
    await frequencyCapService.setConfig(ORG, 1, 168, false)
    const res2 = await frequencyCapService.filterAllowed(ORG, ['fresh@test.com', 'capped@test.com'])
    expect(res2.allowed).toEqual(['fresh@test.com', 'capped@test.com'])
    expect(res2.capped).toEqual([])
  })

  it('cleanup deletes only entries older than 30 days and returns the count', async () => {
    await frequencyCapService.logSend(ORG, EMAIL) // recent
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await db.insert(frequency_log).values([
      { org_id: ORG, email: EMAIL, campaign_id: null, sent_at: old },
      { org_id: ORG, email: 'b@test.com', campaign_id: null, sent_at: old },
    ])

    const removed = await frequencyCapService.cleanup()
    expect(removed).toBe(2)
    const remaining = await db.select().from(frequency_log)
    expect(remaining).toHaveLength(1)
  })

  it('isolates config and counts by org_id (tenant isolation)', async () => {
    await frequencyCapService.setConfig(ORG, 1, 168, true)
    await frequencyCapService.setConfig(ORG2, 9, 12, false)

    // each org reads its own config
    expect(await frequencyCapService.getConfig(ORG)).toEqual({ maxPerWindow: 1, windowHours: 168, enabled: true })
    expect(await frequencyCapService.getConfig(ORG2)).toEqual({ maxPerWindow: 9, windowHours: 12, enabled: false })

    // same email logged under ORG must not count toward ORG2
    await frequencyCapService.logSend(ORG, EMAIL)
    expect(await frequencyCapService.getCount(ORG, EMAIL)).toBe(1)
    expect(await frequencyCapService.getCount(ORG2, EMAIL)).toBe(0)

    // ORG is capped (1>=1) but ORG2 (disabled) still allows the same email
    expect(await frequencyCapService.canSend(ORG, EMAIL)).toBe(false)
    expect(await frequencyCapService.canSend(ORG2, EMAIL)).toBe(true)
  })
})
