// Net — route-layer audit helpers derive actor/org/ip/ua from Context and land a row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { Hono } from 'hono'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, audit_logs, activity_logs } from '../../src/db/pg/schema'
import { auditFromContext, activityFromContext } from '../../src/services/audit/context'
import { auditService } from '../../src/services/auditService'

const ORG = 'org_ctx'
const USER = { id: 'usr_ctx', email: 'ctx@test.com', name: 'Ctx' }

function appThatAudits(fn: (c: any) => void) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.user = USER as any; c.set('orgId', ORG); await next() })
  app.post('/go', (c) => { fn(c); return c.json({ ok: true }) })
  return app
}

describe('audit context helpers', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated(); __setTestDb(db)
    await db.insert(organizations).values({ id: ORG, name: 'O', slug: 'o' })
  }, 30_000)
  afterEach(() => { __setTestDb(null); vi.clearAllMocks() })

  it('auditFromContext derives actor/org/ip/ua and lands an audit row', async () => {
    const app = appThatAudits((c) => auditFromContext(c, { action: 'campaign.launched', entityType: 'campaign', entityId: 'cmp_1' }))
    await app.fetch(new Request('http://localhost/go', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9', 'user-agent': 'net' } }))
    await new Promise((r) => setTimeout(r, 20)) // let the un-awaited insert settle
    const { logs, total } = await auditService.queryAuditLogs({ orgId: ORG })
    expect(total).toBe(1)
    expect(logs[0].actor_id).toBe('usr_ctx')
    expect(logs[0].actor_email).toBe('ctx@test.com')
    expect(logs[0].action).toBe('campaign.launched')
    expect(logs[0].entity_id).toBe('cmp_1')
    expect(logs[0].ip_address).toBe('9.9.9.9')
    expect(logs[0].user_agent).toBe('net')
  })

  it('activityFromContext lands an activity row with a description', async () => {
    const app = appThatAudits((c) => activityFromContext(c, { action: 'campaign.created', entityType: 'campaign', entityId: 'cmp_2', description: 'Created' }))
    await app.fetch(new Request('http://localhost/go', { method: 'POST' }))
    await new Promise((r) => setTimeout(r, 20))
    const { logs, total } = await auditService.queryActivityLogs({ orgId: ORG })
    expect(total).toBe(1)
    expect(logs[0].description).toBe('Created')
  })

  it('never throws when there is no user or org on the context', async () => {
    const app = new Hono()
    app.post('/go', (c) => { auditFromContext(c, { action: 'user.logout', entityType: 'session' }); return c.json({ ok: true }) })
    const res = await app.fetch(new Request('http://localhost/go', { method: 'POST' }))
    expect(res.status).toBe(200) // handler completed; no throw from the helper
  })
})
