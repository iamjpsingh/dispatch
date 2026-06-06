import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'

// Mock logger to prevent console noise
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startup: vi.fn(),
  },
}))

// Mock bun:sqlite with better-sqlite3 (which vitest/vite can load)
// We create a lightweight in-memory wrapper that matches the bun:sqlite API
vi.mock('bun:sqlite', () => {
  // Use a factory to create in-memory databases
  class MockDatabase {
    private stmtCache = new Map<string, any>()
    private tables = new Map<string, any[]>()
    private db: any

    constructor(_path?: string) {
      // We need a real SQLite for proper testing - use better-sqlite3
      // Since better-sqlite3 may not be installed, we'll use a simple mock
      // that tracks state in memory
      this.db = createInMemorySQLite()
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

// Simple in-memory SQLite implementation using better-sqlite3 or a polyfill
function createInMemorySQLite() {
  // Try to use better-sqlite3, fall back to tracking state manually
  try {
    const BetterSqlite3 = require('better-sqlite3')
    return new BetterSqlite3(':memory:')
  } catch {
    // If better-sqlite3 is not available, we can't run these tests
    throw new Error('better-sqlite3 is required for queueDatabase tests - install with: bun add -d better-sqlite3')
  }
}

import { QueueDatabase } from '../../src/services/queueDatabase'
import type { EnqueueOptions } from '../../src/services/queueDatabase'

let queueDb: QueueDatabase

const defaultEnqueueOptions: EnqueueOptions = {
  type: 'batch',
  priority: 5,
  batchSize: 20,
  emailDelaySec: 45,
  batchDelayMin: 60,
  htmlContent: '<p>Hello {{FirstName}}</p>',
  subject: 'Test Subject',
  fromEmail: 'sender@test.com',
  fromName: 'Test Sender',
}

function insertTestJob(id: string, userId = 'user_1', opts: Partial<EnqueueOptions> = {}) {
  const mergedOpts = { ...defaultEnqueueOptions, ...opts }
  const contacts = [{ Email: 'a@b.com', FirstName: 'Alice' }]
  queueDb.insertJob(
    id,
    `campaign_${id}`,
    userId,
    JSON.stringify({ host: 'smtp.test.com', port: 587 }),
    JSON.stringify(contacts),
    contacts.length,
    mergedOpts
  )
}

beforeAll(() => {
  // Use in-memory database (path is ignored since we mock bun:sqlite)
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
  // Clean tables between tests
  queueDb.db.exec('DELETE FROM dead_letters')
  queueDb.db.exec('DELETE FROM suppression_list')
  queueDb.db.exec('DELETE FROM jobs')
})

// ============================================================================
// Schema Initialization
// ============================================================================

describe('QueueDatabase - Schema', () => {
  it('creates jobs table', () => {
    const result = queueDb.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get() as any
    expect(result).toBeDefined()
    expect(result.name).toBe('jobs')
  })

  it('creates dead_letters table', () => {
    const result = queueDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dead_letters'")
      .get() as any
    expect(result).toBeDefined()
  })

  it('creates suppression_list table', () => {
    const result = queueDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='suppression_list'")
      .get() as any
    expect(result).toBeDefined()
  })
})

// ============================================================================
// Job CRUD
// ============================================================================

describe('QueueDatabase - Job CRUD', () => {
  it('inserts and retrieves a job', () => {
    insertTestJob('job_crud_1')
    const job = queueDb.getJob('job_crud_1')
    expect(job).toBeDefined()
    expect(job!.id).toBe('job_crud_1')
    expect(job!.user_id).toBe('user_1')
    expect(job!.status).toBe('pending')
    expect(job!.total_count).toBe(1)
    expect(job!.type).toBe('batch')
    expect(job!.priority).toBe(5)
  })

  it('returns null for non-existent job', () => {
    const job = queueDb.getJob('nonexistent')
    expect(job).toBeUndefined()
  })

  it('inserts job with custom options', () => {
    insertTestJob('job_crud_2', 'user_2', {
      type: 'scheduled',
      priority: 1,
      batchSize: 50,
      notifyEmail: 'admin@test.com',
    })
    const job = queueDb.getJob('job_crud_2')
    expect(job!.type).toBe('scheduled')
    expect(job!.priority).toBe(1)
    expect(job!.batch_size).toBe(50)
    expect(job!.notify_email).toBe('admin@test.com')
  })

  it('stores html_content and subject', () => {
    insertTestJob('job_crud_3')
    const job = queueDb.getJob('job_crud_3')
    expect(job!.html_content).toBe('<p>Hello {{FirstName}}</p>')
    expect(job!.subject).toBe('Test Subject')
    expect(job!.from_email).toBe('sender@test.com')
    expect(job!.from_name).toBe('Test Sender')
  })
})

// ============================================================================
// Dequeue
// ============================================================================

describe('QueueDatabase - Dequeue', () => {
  it('dequeues the highest priority pending job', () => {
    insertTestJob('job_dq_low', 'user_1', { priority: 10 })
    insertTestJob('job_dq_high', 'user_1', { priority: 1 })

    const job = queueDb.dequeue()
    expect(job).toBeDefined()
    expect(job!.id).toBe('job_dq_high')
  })

  it('returns null when no pending jobs', () => {
    const job = queueDb.dequeue()
    expect(job).toBeFalsy()
  })

  it('does not dequeue running jobs', () => {
    insertTestJob('job_dq_running')
    queueDb.markRunning('job_dq_running')

    const job = queueDb.dequeue()
    expect(job).toBeFalsy()
  })
})

// ============================================================================
// Job Status Transitions
// ============================================================================

describe('QueueDatabase - Status Transitions', () => {
  it('marks job as running', () => {
    insertTestJob('job_run_1')
    queueDb.markRunning('job_run_1')

    const job = queueDb.getJob('job_run_1')
    expect(job!.status).toBe('running')
    expect(job!.started_at).toBeTruthy()
  })

  it('pauses a running job', () => {
    insertTestJob('job_pause_1')
    queueDb.markRunning('job_pause_1')

    const result = queueDb.pause('job_pause_1')
    expect(result).toBe(true)

    const job = queueDb.getJob('job_pause_1')
    expect(job!.status).toBe('paused')
  })

  it('cannot pause a pending job', () => {
    insertTestJob('job_pause_2')
    const result = queueDb.pause('job_pause_2')
    expect(result).toBe(false)
  })

  it('resumes a paused job', () => {
    insertTestJob('job_resume_1')
    queueDb.markRunning('job_resume_1')
    queueDb.pause('job_resume_1')

    const result = queueDb.resume('job_resume_1')
    expect(result).toBe(true)

    const job = queueDb.getJob('job_resume_1')
    expect(job!.status).toBe('pending')
  })

  it('cannot resume a running job', () => {
    insertTestJob('job_resume_2')
    queueDb.markRunning('job_resume_2')

    const result = queueDb.resume('job_resume_2')
    expect(result).toBe(false)
  })

  it('cancels a pending job', () => {
    insertTestJob('job_cancel_1')
    const result = queueDb.cancel('job_cancel_1')
    expect(result).toBe(true)

    const job = queueDb.getJob('job_cancel_1')
    expect(job!.status).toBe('cancelled')
    expect(job!.completed_at).toBeTruthy()
  })

  it('cancels a running job', () => {
    insertTestJob('job_cancel_2')
    queueDb.markRunning('job_cancel_2')

    const result = queueDb.cancel('job_cancel_2')
    expect(result).toBe(true)

    const job = queueDb.getJob('job_cancel_2')
    expect(job!.status).toBe('cancelled')
  })

  it('cancels a paused job', () => {
    insertTestJob('job_cancel_3')
    queueDb.markRunning('job_cancel_3')
    queueDb.pause('job_cancel_3')

    const result = queueDb.cancel('job_cancel_3')
    expect(result).toBe(true)
  })

  it('cannot cancel a completed job', () => {
    insertTestJob('job_cancel_4')
    queueDb.completeJob('job_cancel_4')

    const result = queueDb.cancel('job_cancel_4')
    expect(result).toBe(false)
  })

  it('updates progress', () => {
    insertTestJob('job_prog_1')
    queueDb.markRunning('job_prog_1')

    queueDb.updateProgress('job_prog_1', 10, 8, 2, 'Last error here')

    const job = queueDb.getJob('job_prog_1')
    expect(job!.last_processed_index).toBe(10)
    expect(job!.sent_count).toBe(8)
    expect(job!.failed_count).toBe(2)
    expect(job!.last_error).toBe('Last error here')
  })

  it('completes a job', () => {
    insertTestJob('job_complete_1')
    queueDb.markRunning('job_complete_1')
    queueDb.completeJob('job_complete_1')

    const job = queueDb.getJob('job_complete_1')
    expect(job!.status).toBe('completed')
    expect(job!.completed_at).toBeTruthy()
  })

  it('fails a job with error message', () => {
    insertTestJob('job_fail_1')
    queueDb.markRunning('job_fail_1')
    queueDb.failJob('job_fail_1', 'Something went wrong')

    const job = queueDb.getJob('job_fail_1')
    expect(job!.status).toBe('failed')
    expect(job!.last_error).toBe('Something went wrong')
    expect(job!.completed_at).toBeTruthy()
  })
})

// ============================================================================
// Get Jobs
// ============================================================================

describe('QueueDatabase - getJobs', () => {
  it('returns jobs for a user', () => {
    insertTestJob('job_list_1', 'user_list')
    insertTestJob('job_list_2', 'user_list')
    insertTestJob('job_list_3', 'other_user')

    const jobs = queueDb.getJobs('user_list')
    expect(jobs.length).toBe(2)
    expect(jobs.every((j) => j.user_id === 'user_list')).toBe(true)
  })

  it('filters by status', () => {
    insertTestJob('job_filter_1', 'user_filter')
    insertTestJob('job_filter_2', 'user_filter')
    queueDb.markRunning('job_filter_2')

    const pending = queueDb.getJobs('user_filter', 'pending')
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe('job_filter_1')

    const running = queueDb.getJobs('user_filter', 'running')
    expect(running.length).toBe(1)
    expect(running[0].id).toBe('job_filter_2')
  })

  it('respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      insertTestJob(`job_page_${i}`, 'user_page')
    }

    const page1 = queueDb.getJobs('user_page', undefined, 2, 0)
    expect(page1.length).toBe(2)

    const page2 = queueDb.getJobs('user_page', undefined, 2, 2)
    expect(page2.length).toBe(2)

    const page3 = queueDb.getJobs('user_page', undefined, 2, 4)
    expect(page3.length).toBe(1)
  })
})

// ============================================================================
// Dead Letter Queue
// ============================================================================

describe('QueueDatabase - Dead Letters', () => {
  it('adds an entry to dead letter queue', () => {
    insertTestJob('job_dl_1')

    queueDb.addToDeadLetter('job_dl_1', 'bad@example.com', 'Bad User', 'User unknown', 'permanent', 3)

    const dls = queueDb.getDeadLetters('job_dl_1')
    expect(dls.length).toBe(1)
    expect(dls[0].recipient_email).toBe('bad@example.com')
    expect(dls[0].recipient_name).toBe('Bad User')
    expect(dls[0].error_message).toBe('User unknown')
    expect(dls[0].error_type).toBe('permanent')
    expect(dls[0].attempts).toBe(3)
  })

  it('returns all dead letters when no jobId filter', () => {
    insertTestJob('job_dl_2a')
    insertTestJob('job_dl_2b')

    queueDb.addToDeadLetter('job_dl_2a', 'a@b.com', null, 'err1', 'permanent', 1)
    queueDb.addToDeadLetter('job_dl_2b', 'b@c.com', null, 'err2', 'permanent', 1)

    const all = queueDb.getDeadLetters()
    expect(all.length).toBe(2)
  })

  it('filters dead letters by job', () => {
    insertTestJob('job_dl_3a')
    insertTestJob('job_dl_3b')

    queueDb.addToDeadLetter('job_dl_3a', 'a@b.com', null, 'err', 'permanent', 1)
    queueDb.addToDeadLetter('job_dl_3b', 'b@c.com', null, 'err', 'permanent', 1)

    const filtered = queueDb.getDeadLetters('job_dl_3a')
    expect(filtered.length).toBe(1)
    expect(filtered[0].job_id).toBe('job_dl_3a')
  })
})

// ============================================================================
// Suppression List
// ============================================================================

describe('QueueDatabase - Suppression List', () => {
  it('adds email to suppression list', () => {
    queueDb.suppress('user_sup', 'bad@test.com', 'bounce', 'auto')
    expect(queueDb.isSuppressed('user_sup', 'bad@test.com')).toBe(true)
  })

  it('normalizes email to lowercase', () => {
    queueDb.suppress('user_sup2', 'UPPER@TEST.COM', 'bounce')
    expect(queueDb.isSuppressed('user_sup2', 'upper@test.com')).toBe(true)
    expect(queueDb.isSuppressed('user_sup2', 'UPPER@TEST.COM')).toBe(true)
  })

  it('returns false for non-suppressed email', () => {
    expect(queueDb.isSuppressed('user_sup3', 'good@test.com')).toBe(false)
  })

  it('suppression is per-user', () => {
    queueDb.suppress('user_sup4a', 'shared@test.com', 'bounce')
    expect(queueDb.isSuppressed('user_sup4a', 'shared@test.com')).toBe(true)
    expect(queueDb.isSuppressed('user_sup4b', 'shared@test.com')).toBe(false)
  })

  it('unsuppresses an email', () => {
    queueDb.suppress('user_sup5', 'remove@test.com', 'bounce')
    expect(queueDb.isSuppressed('user_sup5', 'remove@test.com')).toBe(true)

    const result = queueDb.unsuppress('user_sup5', 'remove@test.com')
    expect(result).toBe(true)
    expect(queueDb.isSuppressed('user_sup5', 'remove@test.com')).toBe(false)
  })

  it('unsuppress returns false for non-existent entry', () => {
    const result = queueDb.unsuppress('user_sup6', 'nonexistent@test.com')
    expect(result).toBe(false)
  })

  it('ignores duplicate suppression (INSERT OR IGNORE)', () => {
    queueDb.suppress('user_sup7', 'dup@test.com', 'bounce')
    queueDb.suppress('user_sup7', 'dup@test.com', 'complaint') // should not throw
    expect(queueDb.isSuppressed('user_sup7', 'dup@test.com')).toBe(true)
  })

  it('retrieves suppression list for a user', () => {
    queueDb.suppress('user_sup8', 'a@test.com', 'bounce')
    queueDb.suppress('user_sup8', 'b@test.com', 'complaint')
    queueDb.suppress('other_user_sup', 'c@test.com', 'bounce')

    const list = queueDb.getSuppressionList('user_sup8')
    expect(list.length).toBe(2)
  })
})

// ============================================================================
// Statistics
// ============================================================================

describe('QueueDatabase - Stats', () => {
  it('returns correct stats for a user', () => {
    insertTestJob('job_stat_1', 'user_stat')
    insertTestJob('job_stat_2', 'user_stat')
    insertTestJob('job_stat_3', 'user_stat')

    queueDb.markRunning('job_stat_1')
    queueDb.updateProgress('job_stat_1', 10, 8, 2)
    queueDb.completeJob('job_stat_1')

    queueDb.markRunning('job_stat_2')

    // job_stat_3 remains pending

    const stats = queueDb.getStats('user_stat')
    expect(stats.pending).toBe(1)
    expect(stats.running).toBe(1)
    expect(stats.completed).toBe(1)
    expect(stats.total_sent).toBe(8)
    expect(stats.total_failed).toBe(2)
  })

  it('counts dead letters in stats', () => {
    insertTestJob('job_stat_dl', 'user_stat_dl')
    queueDb.addToDeadLetter('job_stat_dl', 'a@b.com', null, 'err', 'permanent', 1)
    queueDb.addToDeadLetter('job_stat_dl', 'b@c.com', null, 'err', 'permanent', 1)

    const stats = queueDb.getStats('user_stat_dl')
    expect(stats.dead_letters).toBe(2)
  })

  it('returns zeros for user with no jobs', () => {
    const stats = queueDb.getStats('no_jobs_user')
    expect(stats.pending).toBe(0)
    expect(stats.running).toBe(0)
    expect(stats.completed).toBe(0)
    expect(stats.failed).toBe(0)
    expect(stats.total_sent).toBe(0)
    expect(stats.total_failed).toBe(0)
    expect(stats.dead_letters).toBe(0)
  })
})

// ============================================================================
// Recovery & Cleanup
// ============================================================================

describe('QueueDatabase - Recovery', () => {
  it('recovers interrupted (running) jobs to pending', () => {
    insertTestJob('job_recover_1', 'user_recover')
    insertTestJob('job_recover_2', 'user_recover')
    queueDb.markRunning('job_recover_1')
    queueDb.markRunning('job_recover_2')

    const recovered = queueDb.recoverInterruptedJobs()
    expect(recovered).toBe(2)

    const job1 = queueDb.getJob('job_recover_1')
    const job2 = queueDb.getJob('job_recover_2')
    expect(job1!.status).toBe('pending')
    expect(job2!.status).toBe('pending')
  })

  it('returns 0 when no interrupted jobs', () => {
    insertTestJob('job_no_recover', 'user_no_recover')
    const recovered = queueDb.recoverInterruptedJobs()
    expect(recovered).toBe(0)
  })
})

describe('QueueDatabase - Cleanup', () => {
  it('cleans up old completed jobs', () => {
    insertTestJob('job_cleanup_1', 'user_cleanup')
    queueDb.completeJob('job_cleanup_1')

    // Set completed_at to 60 days ago manually
    queueDb.db.prepare("UPDATE jobs SET completed_at = datetime('now', '-60 days') WHERE id = ?").run('job_cleanup_1')

    const deleted = queueDb.cleanup(30)
    expect(deleted).toBe(1)
    expect(queueDb.getJob('job_cleanup_1')).toBeFalsy()
  })

  it('does not clean up recent jobs', () => {
    insertTestJob('job_cleanup_2', 'user_cleanup2')
    queueDb.completeJob('job_cleanup_2')

    const deleted = queueDb.cleanup(30)
    expect(deleted).toBe(0)
    expect(queueDb.getJob('job_cleanup_2')).toBeDefined()
  })

  it('does not clean up pending jobs', () => {
    insertTestJob('job_cleanup_3', 'user_cleanup3')

    const deleted = queueDb.cleanup(0)
    expect(deleted).toBe(0)
  })
})
