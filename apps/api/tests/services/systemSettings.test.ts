// P2.8 net — systemSettingsService: Postgres-backed key/value config with an
// in-memory cache (sync reads, async write-through). Verifies set→get consistency,
// JSON helpers, delete, getAll ordering, init() loading from PG, and PG landing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { system_settings } from '../../src/db/pg/schema'
import { systemSettingsService } from '../../src/services/systemSettingsService'

describe('P2.8 — systemSettingsService (Postgres + cache)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await systemSettingsService.init() // start from an empty, freshly-loaded cache
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('set then get is immediately consistent (cache write-through)', async () => {
    await systemSettingsService.set('k1', 'v1', 'user-1')
    expect(systemSettingsService.get('k1')).toBe('v1')
    // and it landed in Postgres
    const rows = await db.select().from(system_settings)
    expect(rows.find((r) => r.key === 'k1')?.value).toBe('v1')
  })

  it('returns null for missing keys', () => {
    expect(systemSettingsService.get('nope')).toBeNull()
    expect(systemSettingsService.getJson('nope')).toBeNull()
  })

  it('round-trips JSON via setJson/getJson', async () => {
    await systemSettingsService.setJson('cfg', { a: 1, b: ['x'] })
    expect(systemSettingsService.getJson<{ a: number; b: string[] }>('cfg')).toEqual({ a: 1, b: ['x'] })
  })

  it('upserts on repeated set', async () => {
    await systemSettingsService.set('k', 'one')
    await systemSettingsService.set('k', 'two')
    expect(systemSettingsService.get('k')).toBe('two')
    const rows = await db.select().from(system_settings)
    expect(rows.filter((r) => r.key === 'k')).toHaveLength(1)
  })

  it('deletes a key from cache and Postgres', async () => {
    await systemSettingsService.set('gone', 'x')
    expect(await systemSettingsService.delete('gone')).toBe(true)
    expect(systemSettingsService.get('gone')).toBeNull()
    expect(await systemSettingsService.delete('gone')).toBe(false)
    const rows = await db.select().from(system_settings)
    expect(rows.find((r) => r.key === 'gone')).toBeUndefined()
  })

  it('getAll returns key-sorted entries', async () => {
    await systemSettingsService.set('zeta', '1')
    await systemSettingsService.set('alpha', '2')
    const all = systemSettingsService.getAll()
    expect(all.map((r) => r.key)).toEqual(['alpha', 'zeta'])
    expect(all[0]).toMatchObject({ key: 'alpha', value: '2' })
  })

  it('init() loads existing rows from Postgres into the cache', async () => {
    // write directly to PG (bypassing the service), then re-init
    await db.insert(system_settings).values({ key: 'preexisting', value: 'loaded' })
    expect(systemSettingsService.get('preexisting')).toBeNull() // not in cache yet
    await systemSettingsService.init()
    expect(systemSettingsService.get('preexisting')).toBe('loaded')
  })
})
