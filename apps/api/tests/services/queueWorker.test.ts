import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startup: vi.fn(),
  },
}))

// Mock bun:sqlite with better-sqlite3 (matches queueDatabase.test.ts approach)
vi.mock('bun:sqlite', () => {
  class MockDatabase {
    private db: any
    constructor(_path?: string) {
      const BetterSqlite3 = require('better-sqlite3')
      this.db = new BetterSqlite3(':memory:')
    }
    exec(sql: string) {
      this.db.exec(sql)
    }
    prepare(sql: string) {
      return this.db.prepare(sql)
    }
    close() {
      this.db.close()
    }
  }
  return { default: MockDatabase }
})

// Avoid real network / D1 tracking during send
vi.mock('../../src/services/d1Service', () => ({
  d1Service: {
    isConfigured: () => false,
    generateCampaignId: () => 'camp_test',
    registerEmail: vi.fn(),
    injectTracking: (html: string) => html,
  },
}))

// logService writes to disk -- stub it
vi.mock('../../src/services/logService', () => ({
  logService: { addLog: vi.fn() },
}))

// Suppression / frequency / preference / graymail gates -- always allow
vi.mock('../../src/services/frequencyCapService', () => ({
  frequencyCapService: { canSend: () => true, logSend: vi.fn() },
}))
vi.mock('../../src/services/preferenceCenterService', () => ({
  preferenceCenterService: { canReceive: () => true },
}))
vi.mock('../../src/services/graymailService', () => ({
  graymailService: { canSend: () => true, recordSend: vi.fn() },
}))
vi.mock('../../src/services/queue/suppressionStore', () => ({
  suppressionStore: { isSuppressed: () => false, suppress: vi.fn() },
}))

// Control the transport: success vs failure per-test
const mockSend = vi.fn()
vi.mock('../../src/services/transports', () => ({
  createTransport: () => ({ send: mockSend }),
  configFromRecord: (r: any) => r,
}))

import { eventBus } from '../../src/services/eventBus'
import { QueueDatabase } from '../../src/services/queueDatabase'
import { QueueWorker } from '../../src/services/queueWorker'
import type { EnqueueOptions } from '../../src/services/queueDatabase'

let queueDb: QueueDatabase

const baseOptions: EnqueueOptions = {
  type: 'direct',
  priority: 5,
  batchSize: 20,
  emailDelaySec: 0,
  batchDelayMin: 0,
  htmlContent: '<p>Hi {{FirstName}}</p>',
  subject: 'Subject',
  fromEmail: 'sender@test.com',
  fromName: 'Sender',
  configName: 'My SMTP',
}

beforeAll(() => {
  queueDb = new QueueDatabase(':memory:')
})

afterAll(() => {
  try {
    queueDb.db.close()
  } catch {
    /* ignore */
  }
})

beforeEach(() => {
  queueDb.db.exec('DELETE FROM dead_letters')
  queueDb.db.exec('DELETE FROM suppression_list')
  queueDb.db.exec('DELETE FROM jobs')
  mockSend.mockReset()
})

// ---------------------------------------------------------------------------
// 1. config_id round-trips through insertJob/getJob
// ---------------------------------------------------------------------------

describe('QueueDatabase - config_id plumbing', () => {
  it('round-trips config_id through insertJob and getJob', () => {
    queueDb.insertJob(
      'job_cfg_1',
      'campaign_cfg_1',
      'user_cfg',
      JSON.stringify({ host: 'smtp.test.com', port: 587 }),
      JSON.stringify([{ Email: 'a@b.com', FirstName: 'Alice' }]),
      1,
      { ...baseOptions, configId: 'cfg_abc123' }
    )

    const job = queueDb.getJob('job_cfg_1')
    expect(job).toBeDefined()
    expect((job as any).config_id).toBe('cfg_abc123')
  })

  it('stores null config_id when not provided', () => {
    queueDb.insertJob(
      'job_cfg_2',
      'campaign_cfg_2',
      'user_cfg',
      JSON.stringify({ host: 'smtp.test.com', port: 587 }),
      JSON.stringify([{ Email: 'a@b.com', FirstName: 'Alice' }]),
      1,
      { ...baseOptions }
    )
    const job = queueDb.getJob('job_cfg_2')
    expect((job as any).config_id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Worker emits email_sent / email_failed carrying configId + userId
// ---------------------------------------------------------------------------

function enqueueOneContactJob(jobId: string) {
  queueDb.insertJob(
    jobId,
    `campaign_${jobId}`,
    'user_emit',
    JSON.stringify({ host: 'smtp.test.com', port: 587, type: 'smtp' }),
    JSON.stringify([{ Email: 'target@test.com', FirstName: 'Target' }]),
    1,
    { ...baseOptions, configId: 'cfg_emit_1' }
  )
}

describe('QueueWorker - eventBus emission', () => {
  it('emits email_sent with configId and userId on success', async () => {
    mockSend.mockResolvedValue({ messageId: 'msg_1' })

    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined)
    const worker = new QueueWorker(queueDb)

    enqueueOneContactJob('job_emit_ok')
    const job = queueDb.getJob('job_emit_ok')!

    // Drive the job directly through the private executeJob
    await (worker as any).executeJob(job, { abort: false })

    const sentCall = emitSpy.mock.calls.find((c) => c[0] === 'email_sent')
    expect(sentCall).toBeDefined()
    expect(sentCall![1]).toBe('user_emit') // userId is 2nd positional arg
    const data = sentCall![2] as Record<string, unknown>
    expect(data.configId).toBe('cfg_emit_1')
    expect(data.providerType).toBe('smtp')

    emitSpy.mockRestore()
  })

  it('emits email_failed with configId, userId and error on permanent failure', async () => {
    // Permanent failure -> no retry, single emit of email_failed
    mockSend.mockRejectedValue(new Error('550 No such user'))

    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined)
    const worker = new QueueWorker(queueDb)

    enqueueOneContactJob('job_emit_fail')
    const job = queueDb.getJob('job_emit_fail')!

    await (worker as any).executeJob(job, { abort: false })

    const failedCall = emitSpy.mock.calls.find((c) => c[0] === 'email_failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![1]).toBe('user_emit')
    const data = failedCall![2] as Record<string, unknown>
    expect(data.configId).toBe('cfg_emit_1')
    expect(typeof data.error).toBe('string')

    emitSpy.mockRestore()
  })
})
