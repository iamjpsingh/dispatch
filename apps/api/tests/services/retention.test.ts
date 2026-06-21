import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { event_analytics } from '../../src/db/pg/schema'
import { retentionService } from '../../src/services/retentionService'

describe('retentionService.purgeExpired', () => {
  let db: TestDb
  beforeEach(async () => { db = await freshDbMigrated(); __setTestDb(db) }, 30_000)
  afterEach(() => __setTestDb(null))

  it('deletes rows older than the window and keeps newer ones', async () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString()
    const fresh = new Date('2020-12-25T00:00:00Z').toISOString()
    await db.insert(event_analytics).values([
      { id: 'old', user_id: 'u1', event_type: 'open', created_at: old } as any,
      { id: 'new', user_id: 'u1', event_type: 'open', created_at: fresh } as any,
    ])
    const res = await retentionService.purgeExpired(new Date('2021-01-01T00:00:00Z'), 30)
    const ev = res.find(r => r.table === 'event_analytics')
    expect(ev?.deleted).toBe(1)
    const remaining = await db.select().from(event_analytics)
    expect(remaining.map(r => r.id)).toEqual(['new'])
  })
})
