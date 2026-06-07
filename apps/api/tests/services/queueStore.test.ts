// P4.C net — queueStore: PG-backed job + dead-letter history mirror (async).
// Replaces QueueDatabase's job CRUD. Mirrors the sqlite encoding (snake_case,
// JSON-as-text, integer counts, ISO timestamps) on the PG jobs/dead_letters tables.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { queueStore } from '../../src/services/queue/queueStore'

type Over = Partial<Parameters<typeof queueStore.insertJob>[0]>
function makeJob(over: Over) {
  return {
    id: 'job_1',
    user_id: 'user-1',
    config_json: JSON.stringify({ host: 'smtp.test' }),
    contacts_json: JSON.stringify([{ Email: 'a@b.com' }]),
    total_count: 1,
    ...over,
  }
}

describe('P4.C — queueStore (Postgres)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('insertJob then getJob round-trips the row', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1', config_id: 'cfg_1', campaign_id: 'camp_1' }))
    const job = await queueStore.getJob('j1')
    expect(job).toBeTruthy()
    expect(job!.id).toBe('j1')
    expect(job!.config_id).toBe('cfg_1')
    expect(job!.status).toBe('pending')
    expect(job!.total_count).toBe(1)
  })

  it('getJob returns null for a missing id', async () => {
    expect(await queueStore.getJob('nope')).toBeNull()
  })

  it('getJobs is user-scoped, newest-first, status-filterable', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1', user_id: 'user-1', status: 'pending' }))
    await queueStore.insertJob(makeJob({ id: 'j2', user_id: 'user-1', status: 'completed' }))
    await queueStore.insertJob(makeJob({ id: 'j3', user_id: 'user-2', status: 'pending' }))

    const all = await queueStore.getJobs('user-1')
    expect(all.map((j) => j.id).sort()).toEqual(['j1', 'j2'])

    const pending = await queueStore.getJobs('user-1', 'pending')
    expect(pending.map((j) => j.id)).toEqual(['j1'])

    expect(await queueStore.getJobs('user-3')).toEqual([])
  })

  it('markRunning / updateProgress / completeJob mutate the row', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1', total_count: 5 }))
    await queueStore.markRunning('j1')
    expect((await queueStore.getJob('j1'))!.status).toBe('running')

    await queueStore.updateProgress('j1', 3, 2, 1)
    const mid = await queueStore.getJob('j1')
    expect(mid!.last_processed_index).toBe(3)
    expect(mid!.sent_count).toBe(2)
    expect(mid!.failed_count).toBe(1)

    await queueStore.completeJob('j1')
    const done = await queueStore.getJob('j1')
    expect(done!.status).toBe('completed')
    expect(done!.completed_at).toBeTruthy()
  })

  it('failJob records status + error', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1' }))
    await queueStore.failJob('j1', 'boom')
    const job = await queueStore.getJob('j1')
    expect(job!.status).toBe('failed')
    expect(job!.last_error).toBe('boom')
  })

  it('setStatus transitions and reports whether a row changed', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1', status: 'running' }))
    expect(await queueStore.setStatus('j1', 'paused')).toBe(true)
    expect((await queueStore.getJob('j1'))!.status).toBe('paused')
    expect(await queueStore.setStatus('missing', 'cancelled')).toBe(false)
  })

  it('addToDeadLetter + getDeadLetters (job-scoped)', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1' }))
    await queueStore.addToDeadLetter('j1', 'bad@x.com', 'Bad', 'perm fail', 'permanent', 4)
    const dls = await queueStore.getDeadLetters('j1')
    expect(dls).toHaveLength(1)
    expect(dls[0].recipient_email).toBe('bad@x.com')
    expect(dls[0].error_type).toBe('permanent')
    expect(dls[0].attempts).toBe(4)
  })

  it('getStats aggregates per-user counts + dead letters', async () => {
    await queueStore.insertJob(makeJob({ id: 'j1', status: 'pending' }))
    await queueStore.insertJob(makeJob({ id: 'j2', status: 'completed', sent_count: 10, failed_count: 2 }))
    await queueStore.insertJob(makeJob({ id: 'j3', status: 'running', sent_count: 1 }))
    await queueStore.insertJob(makeJob({ id: 'j4', user_id: 'user-2', status: 'pending' }))
    await queueStore.addToDeadLetter('j2', 'x@y.com', null, 'e', 'permanent', 1)

    const stats = await queueStore.getStats('user-1')
    expect(stats.pending).toBe(1)
    expect(stats.running).toBe(1)
    expect(stats.completed).toBe(1)
    expect(stats.total_sent).toBe(11)
    expect(stats.total_failed).toBe(2)
    expect(stats.dead_letters).toBe(1)
  })
})
