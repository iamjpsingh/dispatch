// P5.3 net — logService on Postgres (async, org-scoped). The old ./logs JSON file is gone;
// every read/write is keyed by org_id (R9). Cross-tenant isolation is the security-critical case.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { getDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { logService } from '../../src/services/logService'
import type { EmailLog } from '../../src/types/index'

const makeLog = (over: Partial<EmailLog> = {}): EmailLog => ({
  id: `log_${Math.random().toString(36).slice(2)}`,
  email: 'a@test.com',
  status: 'Sent',
  timestamp: '2026-06-08T00:00:00.000Z',
  ...over,
})

async function seedOrg(id: string) {
  // email_logs.org_id is a FK → organizations. Insert the parent rows the test needs.
  // organizations.slug is NOT NULL + unique, so derive a unique slug from the id.
  await getDb().insert(organizations).values({ id, name: id, slug: id }).onConflictDoNothing()
}

describe('P5.3 — logService (Postgres, org-scoped)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seedOrg('org-a')
    await seedOrg('org-b')
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('addLog then getLogs returns the org’s logs', async () => {
    await logService.addLog('org-a', makeLog({ email: 'x@a.com', status: 'Sent' }))
    const logs = await logService.getLogs('org-a')
    expect(logs).toHaveLength(1)
    expect(logs[0].email).toBe('x@a.com')
    expect(logs[0].status).toBe('Sent')
  })

  it('getStats returns zeros for an org with no logs', async () => {
    await seedOrg('org-empty')
    const stats = await logService.getStats('org-empty')
    expect(stats).toEqual({ total: 0, sent: 0, failed: 0, errors: 0 })
  })

  it('getStats counts by status for the org', async () => {
    await logService.addLog('org-a', makeLog({ status: 'Sent' }))
    await logService.addLog('org-a', makeLog({ status: 'Failed' }))
    await logService.addLog('org-a', makeLog({ status: 'Error' }))
    const stats = await logService.getStats('org-a')
    expect(stats).toEqual({ total: 3, sent: 1, failed: 1, errors: 1 })
  })

  it('isolates tenants — org A never sees org B logs or stats', async () => {
    await logService.addLog('org-a', makeLog({ email: 'a@a.com' }))
    await logService.addLog('org-b', makeLog({ email: 'b@b.com' }))

    const aLogs = await logService.getLogs('org-a')
    expect(aLogs).toHaveLength(1)
    expect(aLogs[0].email).toBe('a@a.com')

    expect((await logService.getStats('org-b')).total).toBe(1)
  })

  it('deleteLog only deletes within the org', async () => {
    // Log ids are globally unique (the PK) — producers mint distinct ids — so each org
    // gets its own id. The security-critical property: deleteLog is org-scoped, so it
    // never deletes a row the caller's org does not own.
    await logService.addLog('org-a', makeLog({ id: 'log-a' }))
    await logService.addLog('org-b', makeLog({ id: 'log-b' }))

    // org-a deleting its own id removes only org-a's row.
    await logService.deleteLog('org-a', 'log-a')
    expect(await logService.getLogs('org-a')).toHaveLength(0)
    expect(await logService.getLogs('org-b')).toHaveLength(1) // org B untouched

    // org-a attempting to delete org-b's id is a no-op (cross-tenant delete blocked).
    await logService.deleteLog('org-a', 'log-b')
    expect(await logService.getLogs('org-b')).toHaveLength(1) // still there
  })

  it('getLogsAsCSV returns a header + the org’s rows', async () => {
    await logService.addLog('org-a', makeLog({ email: 'csv@a.com', status: 'Sent' }))
    const csv = await logService.getLogsAsCSV('org-a')
    expect(csv).toContain('email')
    expect(csv).toContain('csv@a.com')
  })
})
