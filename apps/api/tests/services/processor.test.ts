// P4.C net — processSendBatch: the BullMQ batch processor (PGlite + mocked transport).
// Verifies: gate-blocked recipients are skipped (not sent, not failed), allowed ones
// send, atomic progress + completion when the last batch finishes, and a permanent
// failure dead-letters + suppresses. Gate internals are tested in gates.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/d1Service', () => ({
  d1Service: { isConfigured: () => false, generateCampaignId: () => 'camp_x', registerEmail: vi.fn(), injectTracking: (h: string) => h },
}))
vi.mock('../../src/services/logService', () => ({ logService: { addLog: vi.fn() } }))

const mockSend = vi.fn()
vi.mock('../../src/services/transports', () => ({
  createTransport: () => ({ send: mockSend }),
  configFromRecord: (r: unknown) => r,
}))

const emitSpy = vi.fn()
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: (...a: unknown[]) => emitSpy(...a) } }))

const gate = vi.fn()
vi.mock('../../src/services/queue/gates', () => ({ evaluateGates: (...a: unknown[]) => gate(...a) }))

const logSend = vi.fn()
const recordSend = vi.fn()
vi.mock('../../src/services/frequencyCapService', () => ({ frequencyCapService: { logSend: (...a: unknown[]) => logSend(...a) } }))
vi.mock('../../src/services/graymailService', () => ({ graymailService: { recordSend: (...a: unknown[]) => recordSend(...a) } }))

const suppress = vi.fn()
vi.mock('../../src/services/queue/suppressionStore', () => ({ suppressionStore: { suppress: (...a: unknown[]) => suppress(...a) } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { queueStore } from '../../src/services/queue/queueStore'
import { processSendBatch } from '../../src/services/queue/processor'

function jobRow(over: Partial<Parameters<typeof queueStore.insertJob>[0]>) {
  return {
    id: 'j1',
    user_id: 'u1',
    org_id: 'o1',
    config_json: JSON.stringify({ type: 'smtp' }),
    contacts_json: JSON.stringify([{ Email: 'a@x.com' }, { Email: 'b@x.com' }, { Email: 'c@x.com' }]),
    total_count: 3,
    batch_size: 20,
    email_delay_sec: 0,
    subject: 'Hi',
    html_content: '<p>Hi</p>',
    from_email: 'me@x.com',
    ...over,
  }
}

describe('P4.C — processSendBatch', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    vi.clearAllMocks()
    gate.mockResolvedValue({ allowed: true })
    emitSpy.mockResolvedValue(undefined)
    mockSend.mockResolvedValue({ messageId: 'm1' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
  })

  it('sends allowed recipients, skips blocked, completes when the batch finishes', async () => {
    await queueStore.insertJob(jobRow({}))
    // block the 2nd recipient only
    gate.mockImplementation((_u: string, _o: string | null, email: string) =>
      Promise.resolve(email === 'b@x.com' ? { allowed: false, reason: 'suppressed' } : { allowed: true })
    )

    await processSendBatch('j1', 0)

    expect(mockSend).toHaveBeenCalledTimes(2)
    const job = await queueStore.getJob('j1')
    expect(job!.sent_count).toBe(2)
    expect(job!.failed_count).toBe(0)
    expect(job!.last_processed_index).toBe(3) // 2 sent + 1 skipped
    expect(job!.status).toBe('completed')
    const sent = emitSpy.mock.calls.filter((c) => c[0] === 'email_sent')
    expect(sent).toHaveLength(2)
  })

  it('logs frequency + graymail sends only when org_id present', async () => {
    await queueStore.insertJob(jobRow({ contacts_json: JSON.stringify([{ Email: 'a@x.com' }]), total_count: 1 }))
    await processSendBatch('j1', 0)
    expect(logSend).toHaveBeenCalledWith('o1', 'a@x.com', expect.any(String))
    expect(recordSend).toHaveBeenCalledWith('o1', 'a@x.com')
  })

  it('does not send/skip-process a cancelled job', async () => {
    await queueStore.insertJob(jobRow({ status: 'cancelled' }))
    await processSendBatch('j1', 0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('a permanent failure dead-letters and suppresses the recipient', async () => {
    await queueStore.insertJob(jobRow({ contacts_json: JSON.stringify([{ Email: 'bad@x.com' }]), total_count: 1 }))
    mockSend.mockRejectedValue(new Error('550 No such user'))

    await processSendBatch('j1', 0)

    const dls = await queueStore.getDeadLetters('j1')
    expect(dls).toHaveLength(1)
    expect(dls[0].recipient_email).toBe('bad@x.com')
    expect(suppress).toHaveBeenCalledWith('u1', 'bad@x.com', 'bounce_hard', expect.any(String))
    const job = await queueStore.getJob('j1')
    expect(job!.failed_count).toBe(1)
    expect(job!.status).toBe('completed')
    expect(emitSpy.mock.calls.filter((c) => c[0] === 'email_failed')).toHaveLength(1)
  })

  it('processes only its own batch slice', async () => {
    const contacts = Array.from({ length: 5 }, (_, i) => ({ Email: `u${i}@x.com` }))
    await queueStore.insertJob(jobRow({ contacts_json: JSON.stringify(contacts), total_count: 5, batch_size: 2 }))
    await processSendBatch('j1', 1) // slice [2,4) -> u2, u3
    expect(mockSend).toHaveBeenCalledTimes(2)
    const job = await queueStore.getJob('j1')
    expect(job!.last_processed_index).toBe(2)
    expect(job!.status).not.toBe('completed') // 2 < 5
  })
})
