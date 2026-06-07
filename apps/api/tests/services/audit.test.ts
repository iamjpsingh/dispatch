// Net — auditService on real (PGlite) Postgres. Fire-and-forget writes (never reject),
// filtered reads with org/actor scoping + ORDER BY/LIMIT/OFFSET, recent activity,
// retention cleanup, and a Postgres-landing cross-check on row shape.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, audit_logs, activity_logs } from '../../src/db/pg/schema'
import { auditService } from '../../src/services/auditService'
import { logger } from '../../src/utils/logger'
import { eq } from 'drizzle-orm'

const ORG = 'org_a'
const ORG2 = 'org_a2'
const USER = 'usr_a'

describe('auditService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org A', slug: 'org-a' },
      { id: ORG2, name: 'Org A2', slug: 'org-a2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('writes an audit log and reads it back with preserved shape', async () => {
    await auditService.log({
      orgId: ORG,
      actorId: USER,
      actorEmail: 'a@test.com',
      action: 'org.created',
      entityType: 'organization',
      entityId: ORG,
      changes: { name: { from: 'X', to: 'Y' } },
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
      metadata: { k: 'v' },
    })

    const { logs, total } = await auditService.queryAuditLogs({ orgId: ORG })
    expect(total).toBe(1)
    const row = logs[0]
    expect(row.org_id).toBe(ORG)
    expect(row.actor_id).toBe(USER)
    expect(row.action).toBe('org.created')
    expect(row.entity_type).toBe('organization')
    // JSON-as-text preserved
    expect(JSON.parse(row.changes)).toEqual({ name: { from: 'X', to: 'Y' } })
    expect(JSON.parse(row.metadata)).toEqual({ k: 'v' })
    expect(typeof row.created_at).toBe('string')
  })

  it('defaults metadata to {} and nullable fields to null', async () => {
    await auditService.log({ actorId: USER, action: 'user.login', entityType: 'session' })
    const [row] = await db.select().from(audit_logs).limit(1)
    expect(row.org_id).toBeNull()
    expect(row.actor_email).toBeNull()
    expect(row.entity_id).toBeNull()
    expect(row.changes).toBeNull()
    expect(row.metadata).toBe('{}')
  })

  it('writes an activity log and reads it back', async () => {
    await auditService.logActivity({
      orgId: ORG,
      actorId: USER,
      action: 'campaign.created',
      entityType: 'campaign',
      entityId: 'camp_1',
      description: 'Created a campaign',
      metadata: { n: 1 },
    })
    const { logs, total } = await auditService.queryActivityLogs({ orgId: ORG })
    expect(total).toBe(1)
    expect(logs[0].description).toBe('Created a campaign')
    expect(JSON.parse(logs[0].metadata)).toEqual({ n: 1 })
  })

  it('scopes audit queries by org and actor', async () => {
    await auditService.log({ orgId: ORG, actorId: USER, action: 'org.updated', entityType: 'organization' })
    await auditService.log({ orgId: ORG, actorId: 'usr_other', action: 'org.updated', entityType: 'organization' })
    await auditService.log({ orgId: ORG2, actorId: USER, action: 'org.updated', entityType: 'organization' })

    expect((await auditService.queryAuditLogs({ orgId: ORG })).total).toBe(2)
    expect((await auditService.queryAuditLogs({ orgId: ORG2 })).total).toBe(1)
    expect((await auditService.queryAuditLogs({ orgId: ORG, actorId: USER })).total).toBe(1)
    expect((await auditService.queryAuditLogs({ actorId: 'usr_other' })).total).toBe(1)
  })

  it('filters audit queries by action / entityType / entityId', async () => {
    await auditService.log({ orgId: ORG, actorId: USER, action: 'apikey.created', entityType: 'apikey', entityId: 'k1' })
    await auditService.log({ orgId: ORG, actorId: USER, action: 'apikey.revoked', entityType: 'apikey', entityId: 'k2' })
    expect((await auditService.queryAuditLogs({ orgId: ORG, action: 'apikey.created' })).total).toBe(1)
    expect((await auditService.queryAuditLogs({ orgId: ORG, entityType: 'apikey' })).total).toBe(2)
    expect((await auditService.queryAuditLogs({ orgId: ORG, entityId: 'k2' })).total).toBe(1)
  })

  it('orders DESC by created_at and paginates with limit/offset', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(audit_logs).values({
        id: `aud_${i}`,
        org_id: ORG,
        actor_id: USER,
        action: 'org.updated',
        entity_type: 'organization',
        metadata: '{}',
        created_at: new Date(2026, 0, i + 1).toISOString(),
      })
    }
    const page1 = await auditService.queryAuditLogs({ orgId: ORG, page: 1, limit: 2 })
    expect(page1.total).toBe(3)
    expect(page1.logs).toHaveLength(2)
    expect(page1.logs[0].id).toBe('aud_2') // newest first
    const page2 = await auditService.queryAuditLogs({ orgId: ORG, page: 2, limit: 2 })
    expect(page2.logs).toHaveLength(1)
    expect(page2.logs[0].id).toBe('aud_0')
  })

  it('filters by from/to created_at window', async () => {
    await db.insert(audit_logs).values([
      { id: 'aud_old', org_id: ORG, actor_id: USER, action: 'org.updated', entity_type: 'organization', metadata: '{}', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'aud_new', org_id: ORG, actor_id: USER, action: 'org.updated', entity_type: 'organization', metadata: '{}', created_at: '2026-03-01T00:00:00.000Z' },
    ])
    const res = await auditService.queryAuditLogs({ orgId: ORG, from: '2026-02-01T00:00:00.000Z' })
    expect(res.total).toBe(1)
    expect(res.logs[0].id).toBe('aud_new')
  })

  it('getRecentActivity returns org-scoped rows newest-first, capped by limit', async () => {
    await db.insert(activity_logs).values([
      { id: 'act_1', org_id: ORG, actor_id: USER, action: 'campaign.sent', entity_type: 'campaign', description: 'a', metadata: '{}', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'act_2', org_id: ORG, actor_id: USER, action: 'campaign.sent', entity_type: 'campaign', description: 'b', metadata: '{}', created_at: '2026-02-01T00:00:00.000Z' },
      { id: 'act_other', org_id: ORG2, actor_id: USER, action: 'campaign.sent', entity_type: 'campaign', description: 'c', metadata: '{}', created_at: '2026-03-01T00:00:00.000Z' },
    ])
    const recent = await auditService.getRecentActivity(ORG)
    expect(recent.map((r: any) => r.id)).toEqual(['act_2', 'act_1'])
    const limited = await auditService.getRecentActivity(ORG, 1)
    expect(limited).toHaveLength(1)
    expect(limited[0].id).toBe('act_2')
  })

  it('cleanup deletes only rows older than the retention window and returns counts', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    await db.insert(audit_logs).values([
      { id: 'a_old', actor_id: USER, action: 'x', entity_type: 'e', metadata: '{}', created_at: old },
      { id: 'a_new', actor_id: USER, action: 'x', entity_type: 'e', metadata: '{}', created_at: recent },
    ])
    await db.insert(activity_logs).values([
      { id: 'l_old', actor_id: USER, action: 'x', entity_type: 'e', description: 'd', metadata: '{}', created_at: old },
      { id: 'l_new', actor_id: USER, action: 'x', entity_type: 'e', description: 'd', metadata: '{}', created_at: recent },
    ])
    const res = await auditService.cleanup(90)
    expect(res).toEqual({ auditDeleted: 1, activityDeleted: 1 })
    expect(await db.select().from(audit_logs)).toHaveLength(1)
    expect(await db.select().from(activity_logs)).toHaveLength(1)
  })

  it('log/logActivity never reject and swallow errors (fire-and-forget safety)', async () => {
    // Point the client at a torn-down db to force a DB error in the write path.
    await db.$client.close()
    __setTestDb(db)
    await expect(auditService.log({ actorId: USER, action: 'user.login', entityType: 'session' })).resolves.toBeUndefined()
    await expect(
      auditService.logActivity({ actorId: USER, action: 'campaign.sent', entityType: 'campaign', description: 'd' }),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })

  it('Postgres landing cross-check: writes land in the underlying audit_logs table', async () => {
    await auditService.log({ orgId: ORG, actorId: USER, action: 'org.deleted', entityType: 'organization', entityId: ORG })
    const rows = await db.select().from(audit_logs).where(eq(audit_logs.action, 'org.deleted'))
    expect(rows).toHaveLength(1)
    expect(rows[0].org_id).toBe(ORG)
    expect(rows[0].entity_id).toBe(ORG)
  })
})
