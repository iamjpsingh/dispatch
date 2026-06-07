// P4.D net — schedulerService wiring (PG row + BullMQ delayed job + cancel).
// GATED behind RUN_QUEUE_IT=1 (needs Valkey).
//   RUN_QUEUE_IT=1 bunx vitest run tests/services/schedulerService.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { schedulerStore } from '../../src/services/queue/schedulerStore'
import { getSchedulerQueue, closeSchedulerQueue } from '../../src/services/queue/schedulerQueue'
import { schedulerService } from '../../src/services/schedulerService'
import type { EmailJob } from '../../src/types/index'

const RUN = !!process.env.RUN_QUEUE_IT

const emailJob: EmailJob = {
  contacts: [{ Email: 'a@b.com' }],
  htmlContent: '<p>Hi</p>',
  subject: 'Later',
  fromEmail: 'me@x.com',
  fromName: 'Me',
  config: { host: 'smtp.test', port: 587, secure: false, auth: { user: 'u', pass: 'p' } },
  delay: 0,
}

describe.skipIf(!RUN)('P4.D — schedulerService (BullMQ + PG)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await getSchedulerQueue().obliterate({ force: true })
  }, 30_000)
  afterAll(async () => {
    await getSchedulerQueue().obliterate({ force: true })
    await closeSchedulerQueue()
    __setTestDb(null)
  })

  it('scheduleJob writes a PG row and a delayed BullMQ job; cancel removes both', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const id = await schedulerService.scheduleJob('u1', emailJob, null, future, 'My SMTP')

    expect((await schedulerStore.get(id))!.status).toBe('scheduled')
    const delayed = await getSchedulerQueue().getDelayed()
    expect(delayed.map((j) => j.id)).toContain(id)

    const active = await schedulerService.getScheduledJobs()
    expect(active.map((r) => r.id)).toContain(id)

    expect(await schedulerService.cancelScheduledJob(id)).toBe(true)
    expect((await schedulerStore.get(id))!.status).toBe('cancelled')
    expect(await getSchedulerQueue().getJob(id)).toBeUndefined()
  })
})
