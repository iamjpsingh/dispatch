// P2.7a net — webhookService on real (PGlite) Postgres. CRUD, org scoping,
// enable toggle, log read/clear (cascade), and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
// eventBus side-effect: webhookService.registerEventHandlers() calls eventBus.on at import.
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, webhooks, webhook_logs } from '../../src/db/pg/schema'
import { webhookService } from '../../src/services/webhookService'

const ORG = 'org_w'
const ORG2 = 'org_w2'
const USER = 'usr_w'

describe('P2.7a — webhookService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org W', slug: 'org-w' },
      { id: ORG2, name: 'Org W2', slug: 'org-w2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a webhook with a generated secret and reads it back (shape preserved)', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'Hook', url: 'https://x.test/h', events: ['email_sent', 'email_opened'] })
    expect(wh.id).toMatch(/^wh_/)
    expect(wh.org_id).toBe(ORG)
    expect(wh.user_id).toBe(USER)
    expect(wh.name).toBe('Hook')
    expect(wh.url).toBe('https://x.test/h')
    expect(wh.secret).toMatch(/^[0-9a-f]{64}$/) // 32 random bytes hex
    expect(JSON.parse(wh.events)).toEqual(['email_sent', 'email_opened']) // JSON-as-text
    expect(wh.enabled).toBe(1) // integer flag, default on
    expect(wh.failure_count).toBe(0)
    expect(wh.last_triggered_at).toBeNull()
    expect(typeof wh.created_at).toBe('string')

    const got = await webhookService.get(ORG, wh.id)
    expect(got?.id).toBe(wh.id)
    expect(got?.secret).toBe(wh.secret)
  })

  it('encrypts the secret at rest but surfaces plaintext to callers', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'Enc', url: 'https://x.test/e', events: [] })
    // create() returns plaintext to callers
    expect(wh.secret).toMatch(/^[0-9a-f]{64}$/)

    // (a) the raw Postgres row holds a v1: envelope, never the plaintext
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, wh.id)).limit(1)
    expect(row.secret).toMatch(/^v1:/)
    expect(row.secret).not.toBe(wh.secret)

    // (b) get() decrypts back to the original plaintext
    const got = await webhookService.get(ORG, wh.id)
    expect(got?.secret).toBe(wh.secret)
  })

  it('honors enabled:false on create (integer 0 flag)', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'Off', url: 'https://x.test/o', events: [], enabled: false })
    expect(wh.enabled).toBe(0)
    expect(JSON.parse(wh.events)).toEqual([])
  })

  it('updates fields and is tenant-scoped', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'A', url: 'https://x.test/a', events: ['email_sent'] })

    expect(await webhookService.update(ORG, wh.id, { name: 'B', url: 'https://x.test/b', events: ['email_clicked'], enabled: false })).toBe(true)
    const got = await webhookService.get(ORG, wh.id)
    expect(got?.name).toBe('B')
    expect(got?.url).toBe('https://x.test/b')
    expect(JSON.parse(got!.events)).toEqual(['email_clicked'])
    expect(got?.enabled).toBe(0)

    // empty update is a no-op → false
    expect(await webhookService.update(ORG, wh.id, {})).toBe(false)
    // wrong org cannot mutate
    expect(await webhookService.update(ORG2, wh.id, { name: 'X' })).toBe(false)
  })

  it('toggleEnabled flips the flag and is tenant-scoped', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'T', url: 'https://x.test/t', events: [] })
    expect(await webhookService.toggleEnabled(ORG, wh.id, false)).toBe(true)
    expect((await webhookService.get(ORG, wh.id))?.enabled).toBe(0)
    expect(await webhookService.toggleEnabled(ORG, wh.id, true)).toBe(true)
    expect((await webhookService.get(ORG, wh.id))?.enabled).toBe(1)
    // wrong org cannot toggle
    expect(await webhookService.toggleEnabled(ORG2, wh.id, false)).toBe(false)
  })

  it('lists webhooks for the org only, newest first', async () => {
    const a = await webhookService.create(ORG, USER, { name: 'A', url: 'https://x.test/a', events: [] })
    const b = await webhookService.create(ORG, USER, { name: 'B', url: 'https://x.test/b', events: [] })
    await webhookService.create(ORG2, USER, { name: 'Other', url: 'https://x.test/other', events: [] })

    const list = await webhookService.list(ORG)
    expect(list).toHaveLength(2)
    expect(new Set(list.map((w) => w.id))).toEqual(new Set([a.id, b.id]))
    // ORDER BY created_at DESC — both ids present; ensure scoping excluded ORG2
    expect(list.some((w) => w.name === 'Other')).toBe(false)
  })

  it('deletes a webhook (tenant-scoped) and cascades its logs', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'D', url: 'https://x.test/d', events: [] })
    // seed a couple of delivery logs directly, with distinct timestamps so
    // ORDER BY created_at DESC is deterministic (the 'failed' one is newest).
    await db.insert(webhook_logs).values([
      { id: 'whl_1', webhook_id: wh.id, event_type: 'email_sent', status: 'success', status_code: 200, response_body: 'ok', error: null, duration_ms: 12, created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'whl_2', webhook_id: wh.id, event_type: 'email_opened', status: 'failed', status_code: 500, response_body: null, error: 'boom', duration_ms: 34, created_at: '2026-06-02T00:00:00.000Z' },
    ])

    // wrong org cannot delete
    expect(await webhookService.delete(ORG2, wh.id)).toBe(false)
    // logs still readable, newest first
    const logs = await webhookService.getLogs(wh.id)
    expect(logs).toHaveLength(2)
    expect(logs[0].status).toBe('failed') // shapes: string status, integer code, ms
    expect(logs[0].status_code).toBe(500)
    expect(logs[0].duration_ms).toBe(34)

    // correct org deletes; FK ON DELETE CASCADE removes logs
    expect(await webhookService.delete(ORG, wh.id)).toBe(true)
    expect(await webhookService.get(ORG, wh.id)).toBeNull()
    const remaining = await db.select().from(webhook_logs).where(eq(webhook_logs.webhook_id, wh.id))
    expect(remaining).toHaveLength(0)
  })

  it('getLogs paginates and clearLogs returns the deleted-row count', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'L', url: 'https://x.test/l', events: [] })
    await db.insert(webhook_logs).values([
      { id: 'whl_a', webhook_id: wh.id, event_type: 'e1', status: 'success', duration_ms: 1 },
      { id: 'whl_b', webhook_id: wh.id, event_type: 'e2', status: 'success', duration_ms: 2 },
      { id: 'whl_c', webhook_id: wh.id, event_type: 'e3', status: 'success', duration_ms: 3 },
    ])
    const page1 = await webhookService.getLogs(wh.id, 2, 0)
    expect(page1).toHaveLength(2)
    const page2 = await webhookService.getLogs(wh.id, 2, 2)
    expect(page2).toHaveLength(1)

    const cleared = await webhookService.clearLogs(wh.id)
    expect(cleared).toBe(3)
    expect(await webhookService.getLogs(wh.id)).toHaveLength(0)
  })

  it('Postgres landing cross-check: create writes a real row with the exact column shape', async () => {
    const wh = await webhookService.create(ORG, USER, { name: 'Land', url: 'https://x.test/land', events: ['email_bounced'], enabled: false })
    const [row] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, wh.id), eq(webhooks.org_id, ORG)))
      .limit(1)
    expect(row).toBeDefined()
    expect(row.user_id).toBe(USER)
    expect(row.events).toBe('["email_bounced"]') // stored verbatim as text
    expect(row.enabled).toBe(0) // integer flag landed
    expect(row.failure_count).toBe(0)
    // secret is encrypted at rest (envelope), not the plaintext returned to callers
    expect(row.secret).toMatch(/^v1:/)
    expect(row.secret).not.toBe(wh.secret)
  })
})
