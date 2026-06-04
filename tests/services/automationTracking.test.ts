import { describe, it, expect, beforeEach, vi } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'

// Quiet the logger so service startup doesn't spam the test output.
vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), startup: vi.fn() },
}))

// Avoid pulling whatsapp/contact side effects we don't exercise here.
vi.mock('../../src/services/whatsappService', () => ({
  whatsappService: { sendTemplate: vi.fn() },
}))

// The automationService singleton creates its schema (including the new
// waiting_for_event / wait_true_step_id columns) against ./data/automations.db.
// Under vitest, bun:sqlite is aliased to better-sqlite3, so we can open a second
// connection to the same file to seed and verify rows.
import { automationService } from '../../src/services/automationService'

const DB_PATH = './data/automations.db'

function seedEnrollment(db: BetterSqlite3.Database, row: {
  id: string
  contact_id: string
  current_step_id: string
  waiting_for_event: string | null
  wait_true_step_id: string | null
  status?: string
}) {
  // Ensure a parent automation exists to satisfy the FK (best-effort).
  db.prepare(
    `INSERT OR IGNORE INTO automations (id, user_id, name, trigger_type) VALUES (?, ?, ?, ?)`
  ).run('auto-test', 'user-1', 'Test Automation', 'manual')

  db.prepare(`
    INSERT INTO automation_enrollments
      (id, automation_id, contact_id, current_step_id, status, next_action_at, waiting_for_event, wait_true_step_id)
    VALUES (?, 'auto-test', ?, ?, ?, datetime('now', '+1 day'), ?, ?)
  `).run(
    row.id,
    row.contact_id,
    row.current_step_id,
    row.status || 'active',
    row.waiting_for_event,
    row.wait_true_step_id
  )
}

describe('automationService.handleTrackingEvent', () => {
  let db: BetterSqlite3.Database

  beforeEach(() => {
    db = new BetterSqlite3(DB_PATH)
    // Clean slate for the rows this test owns.
    db.prepare(`DELETE FROM automation_enrollments WHERE contact_id LIKE 'track-test-%'`).run()
  })

  it('redirects a waiting enrollment to the Yes (true) branch on a matching event', () => {
    seedEnrollment(db, {
      id: 'enr-yes',
      contact_id: 'track-test-1',
      current_step_id: 'step-no',
      waiting_for_event: 'email_opened',
      wait_true_step_id: 'step-yes',
    })

    const changed = automationService.handleTrackingEvent('email_opened', 'track-test-1')
    expect(changed).toBe(1)

    const after = db.prepare(
      `SELECT current_step_id, waiting_for_event FROM automation_enrollments WHERE id = 'enr-yes'`
    ).get() as { current_step_id: string; waiting_for_event: string | null }

    expect(after.current_step_id).toBe('step-yes')
    expect(after.waiting_for_event).toBeNull()
  })

  it('leaves an enrollment untouched when the event type does not match', () => {
    seedEnrollment(db, {
      id: 'enr-mismatch-type',
      contact_id: 'track-test-2',
      current_step_id: 'step-no',
      waiting_for_event: 'email_opened',
      wait_true_step_id: 'step-yes',
    })

    const changed = automationService.handleTrackingEvent('email_clicked', 'track-test-2')
    expect(changed).toBe(0)

    const after = db.prepare(
      `SELECT current_step_id, waiting_for_event FROM automation_enrollments WHERE id = 'enr-mismatch-type'`
    ).get() as { current_step_id: string; waiting_for_event: string | null }

    expect(after.current_step_id).toBe('step-no')
    expect(after.waiting_for_event).toBe('email_opened')
  })

  it('leaves other contacts untouched (only the matching contact advances)', () => {
    seedEnrollment(db, {
      id: 'enr-other-contact',
      contact_id: 'track-test-3',
      current_step_id: 'step-no',
      waiting_for_event: 'email_opened',
      wait_true_step_id: 'step-yes',
    })

    const changed = automationService.handleTrackingEvent('email_opened', 'track-test-NOPE')
    expect(changed).toBe(0)

    const after = db.prepare(
      `SELECT current_step_id, waiting_for_event FROM automation_enrollments WHERE id = 'enr-other-contact'`
    ).get() as { current_step_id: string; waiting_for_event: string | null }

    expect(after.current_step_id).toBe('step-no')
    expect(after.waiting_for_event).toBe('email_opened')
  })

  it('does not advance a non-active (e.g. completed) enrollment', () => {
    seedEnrollment(db, {
      id: 'enr-completed',
      contact_id: 'track-test-4',
      current_step_id: 'step-no',
      waiting_for_event: 'email_opened',
      wait_true_step_id: 'step-yes',
      status: 'completed',
    })

    const changed = automationService.handleTrackingEvent('email_opened', 'track-test-4')
    expect(changed).toBe(0)

    const after = db.prepare(
      `SELECT current_step_id FROM automation_enrollments WHERE id = 'enr-completed'`
    ).get() as { current_step_id: string }

    expect(after.current_step_id).toBe('step-no')
  })
})
