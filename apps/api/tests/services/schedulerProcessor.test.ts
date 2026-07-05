// P4.D net — processScheduledRun: when a scheduled job fires, route the send through
// the unified BullMQ send queue (queueEngine.enqueue) and mark the row completed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

const enqueue = vi.fn()
vi.mock('../../src/services/queueEngine', () => ({ queueEngine: { enqueue: (...a: unknown[]) => enqueue(...a) } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { schedulerStore } from '../../src/services/queue/schedulerStore'
import { processScheduledRun } from '../../src/services/queue/schedulerProcessor'

const EMAIL_JOB = {
  contacts: [{ Email: 'a@b.com' }, { Email: 'c@d.com' }],
  htmlContent: '<p>Hi</p>',
  subject: 'Newsletter',
  fromEmail: 'me@x.com',
  fromName: 'Me',
  config: { host: 'smtp.test', type: 'smtp' },
  delay: 30,
}

function row(over: Partial<Parameters<typeof schedulerStore.create>[0]>) {
  return {
    id: 's1',
    user_id: 'u1',
    email_job: JSON.stringify(EMAIL_JOB),
    scheduled_time: new Date('2026-07-01T10:00:00Z').toISOString(),
    subject: 'Newsletter',
    config_name: 'My SMTP',
    notify_email: 'ops@x.com',
    ...over,
  }
}

describe('P4.D — processScheduledRun', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    vi.clearAllMocks()
    enqueue.mockResolvedValue('job_x')
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
  })

  it('enqueues the scheduled send and completes the row (direct, no batch)', async () => {
    await schedulerStore.create(row({ id: 's1' }))
    await processScheduledRun('s1')

    expect(enqueue).toHaveBeenCalledTimes(1)
    const [userId, config, contacts, opts] = enqueue.mock.calls[0] as [string, unknown, unknown[], Record<string, unknown>]
    expect(userId).toBe('u1')
    expect(config).toEqual(EMAIL_JOB.config)
    expect(contacts).toHaveLength(2)
    expect(opts.type).toBe('direct')
    expect(opts.subject).toBe('Newsletter')
    expect(opts.notifyEmail).toBe('ops@x.com')
    expect(opts.emailDelaySec).toBe(30)
    expect(opts.batchSize).toBe(2) // direct -> all contacts in one batch

    expect((await schedulerStore.get('s1'))!.status).toBe('completed')
  })

  it('uses batch settings when batch_config is present', async () => {
    await schedulerStore.create(
      row({ id: 's2', batch_config: JSON.stringify({ batchSize: 50, emailDelay: 5, batchDelay: 10, enabled: true }) })
    )
    await processScheduledRun('s2')
    const opts = (enqueue.mock.calls[0] as [string, unknown, unknown[], Record<string, unknown>])[3]
    expect(opts.type).toBe('batch')
    expect(opts.batchSize).toBe(50)
    expect(opts.emailDelaySec).toBe(5)
    expect(opts.batchDelayMin).toBe(10)
  })

  it('does not enqueue a cancelled job', async () => {
    await schedulerStore.create(row({ id: 's3', org_id: 'org-x' }))
    await schedulerStore.cancel('s3', 'org-x')
    await processScheduledRun('s3')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('marks the row failed if enqueue throws', async () => {
    await schedulerStore.create(row({ id: 's4' }))
    enqueue.mockRejectedValue(new Error('boom'))
    await processScheduledRun('s4')
    expect((await schedulerStore.get('s4'))!.status).toBe('failed')
  })

  // P5.5 — org_id threads into enqueue options so scheduled sends get org-scoped logging.
  it('threads the row org_id into enqueue options', async () => {
    await schedulerStore.create(row({ id: 's5', org_id: 'org-x' }))
    await processScheduledRun('s5')
    const opts = (enqueue.mock.calls[0] as [string, unknown, unknown[], Record<string, unknown>])[3]
    expect(opts.orgId).toBe('org-x')
  })

  it('passes orgId null when the row has no org_id (legacy rows)', async () => {
    await schedulerStore.create(row({ id: 's6' }))
    await processScheduledRun('s6')
    const opts = (enqueue.mock.calls[0] as [string, unknown, unknown[], Record<string, unknown>])[3]
    expect(opts.orgId).toBeNull()
  })
})
