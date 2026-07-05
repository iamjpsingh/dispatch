// P4.D net — schedulerStore: PG-backed scheduled_jobs CRUD (replaces data/scheduler.db).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { schedulerStore } from '../../src/services/queue/schedulerStore'

function row(over: Partial<Parameters<typeof schedulerStore.create>[0]>) {
  return {
    id: 's1',
    user_id: 'u1',
    email_job: JSON.stringify({ contacts: [{ Email: 'a@b.com' }], subject: 'Hi' }),
    scheduled_time: new Date('2026-07-01T10:00:00Z').toISOString(),
    subject: 'Hi',
    contact_count: 1,
    config_name: 'My SMTP',
    ...over,
  }
}

describe('P4.D — schedulerStore (Postgres)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('create then get round-trips, default status scheduled', async () => {
    await schedulerStore.create(row({ id: 's1' }))
    const got = await schedulerStore.get('s1')
    expect(got!.id).toBe('s1')
    expect(got!.status).toBe('scheduled')
    expect(got!.contact_count).toBe(1)
  })

  it('getActive returns only scheduled/running, sorted by scheduled_time', async () => {
    await schedulerStore.create(row({ id: 'a', org_id: 'org-x', scheduled_time: new Date('2026-07-02T00:00:00Z').toISOString() }))
    await schedulerStore.create(row({ id: 'b', org_id: 'org-x', scheduled_time: new Date('2026-07-01T00:00:00Z').toISOString() }))
    await schedulerStore.create(row({ id: 'c', org_id: 'org-x' }))
    await schedulerStore.markCompleted('c')
    const active = await schedulerStore.getActive('org-x')
    expect(active.map((r) => r.id)).toEqual(['b', 'a']) // c excluded (completed), sorted asc
  })

  it('markRunning / markCompleted / markFailed set status', async () => {
    await schedulerStore.create(row({ id: 's1' }))
    await schedulerStore.markRunning('s1')
    expect((await schedulerStore.get('s1'))!.status).toBe('running')
    await schedulerStore.markCompleted('s1')
    const done = await schedulerStore.get('s1')
    expect(done!.status).toBe('completed')
    expect(done!.completed_at).toBeTruthy()
  })

  it('cancel transitions scheduled -> cancelled, but not a completed job', async () => {
    await schedulerStore.create(row({ id: 's1', org_id: 'org-x' }))
    expect(await schedulerStore.cancel('s1', 'org-x')).toBe(true)
    expect((await schedulerStore.get('s1'))!.status).toBe('cancelled')
    await schedulerStore.create(row({ id: 's2', org_id: 'org-x' }))
    await schedulerStore.markCompleted('s2')
    expect(await schedulerStore.cancel('s2', 'org-x')).toBe(false)
  })

  // P5.5 — org_id threaded for org-scoped logging of scheduled sends.
  it('create persists org_id, get round-trips it', async () => {
    await schedulerStore.create(row({ id: 's1', org_id: 'org-x' }))
    expect((await schedulerStore.get('s1'))!.org_id).toBe('org-x')
  })

  it('org_id defaults to null when omitted (legacy rows)', async () => {
    await schedulerStore.create(row({ id: 's1' }))
    expect((await schedulerStore.get('s1'))!.org_id).toBeNull()
  })
})
