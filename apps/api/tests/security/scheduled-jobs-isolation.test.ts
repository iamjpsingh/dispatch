// P8 T2 — scheduled-jobs cross-tenant IDOR. schedulerStore.getActive() had no org
// filter and cancel(id) had no org check: any org could list/cancel any other org's
// scheduled jobs. Exercises the real PG-backed schedulerStore + schedulerService
// (PGlite) to prove org scoping actually happens at the query layer, not just in a mock.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { schedulerStore } from '../../src/services/queue/schedulerStore'
import { schedulerService } from '../../src/services/schedulerService'

function row(over: Partial<Parameters<typeof schedulerStore.create>[0]>) {
  return {
    id: 'sched-b',
    user_id: 'u-b',
    email_job: JSON.stringify({ contacts: [{ Email: 'a@b.com' }], subject: 'Hi' }),
    scheduled_time: new Date('2026-07-10T10:00:00Z').toISOString(),
    subject: 'Hi',
    contact_count: 1,
    config_name: 'Org B SMTP',
    ...over,
  }
}

describe('P8 T2 — scheduled-jobs cross-tenant isolation', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: 'orgA', name: 'Org A', slug: 'org-a' },
      { id: 'orgB', name: 'Org B', slug: 'org-b' },
    ])
  }, 30_000)

  it('getActive(orgA) does not leak a scheduled job that belongs to orgB', async () => {
    await schedulerStore.create(row({ id: 'sched-b', org_id: 'orgB' }))

    const orgAJobs = await schedulerStore.getActive('orgA')
    expect(orgAJobs.map((j) => j.id)).not.toContain('sched-b')

    // Sanity: the row is genuinely there for its real owner.
    const orgBJobs = await schedulerStore.getActive('orgB')
    expect(orgBJobs.map((j) => j.id)).toContain('sched-b')
  })

  it('cancelScheduledJob from a foreign org returns false and leaves the job scheduled', async () => {
    await schedulerStore.create(row({ id: 'sched-b', org_id: 'orgB' }))

    const cancelled = await schedulerService.cancelScheduledJob('sched-b', 'orgA')
    expect(cancelled).toBe(false)

    const row_ = await schedulerStore.get('sched-b')
    expect(row_!.status).toBe('scheduled')
  })
})
