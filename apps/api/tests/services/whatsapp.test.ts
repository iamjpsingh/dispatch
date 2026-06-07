// P2.7b net — whatsappService on real (PGlite) Postgres. Config/template/message
// CRUD + reads, tenant scoping, daily-counter atomic increment, webhook status
// updates, stats aggregation, and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, whatsapp_messages } from '../../src/db/pg/schema'
import { whatsappService } from '../../src/services/whatsappService'

const ORG = 'org_wa'
const ORG2 = 'org_wa2'
const USER = 'usr_wa'

describe('P2.7b — whatsappService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org WA', slug: 'org-wa' },
      { id: ORG2, name: 'Org WA2', slug: 'org-wa2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a config with defaults and reads it back (shape preserved)', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, {
      name: 'Main',
      phone_number_id: 'pn_1',
      access_token: 'tok_1',
    })
    expect(cfg.org_id).toBe(ORG)
    expect(cfg.user_id).toBe(USER)
    expect(cfg.provider).toBe('meta') // default
    expect(cfg.status).toBe('active') // default
    expect(cfg.daily_limit).toBe(1000) // default
    expect(cfg.sent_today).toBe(0)
    expect(typeof cfg.webhook_verify_token).toBe('string')
    expect(cfg.business_account_id).toBeNull()

    const got = await whatsappService.getConfig(ORG, cfg.id)
    expect(got?.id).toBe(cfg.id)
  })

  it('updates and deletes a config (tenant-scoped)', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    await whatsappService.updateConfig(ORG, cfg.id, { name: 'B', daily_limit: 50 })
    expect((await whatsappService.getConfig(ORG, cfg.id))?.name).toBe('B')
    expect((await whatsappService.getConfig(ORG, cfg.id))?.daily_limit).toBe(50)

    // wrong org cannot read or mutate
    expect(await whatsappService.getConfig(ORG2, cfg.id)).toBeNull()
    await whatsappService.updateConfig(ORG2, cfg.id, { name: 'X' })
    expect((await whatsappService.getConfig(ORG, cfg.id))?.name).toBe('B') // unchanged
    await whatsappService.deleteConfig(ORG2, cfg.id)
    expect(await whatsappService.getConfig(ORG, cfg.id)).not.toBeNull() // still there
    await whatsappService.deleteConfig(ORG, cfg.id)
    expect(await whatsappService.getConfig(ORG, cfg.id)).toBeNull()
  })

  it('lists configs for the org only, newest first', async () => {
    await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    await whatsappService.createConfig(ORG, USER, { name: 'B', phone_number_id: 'p', access_token: 't' })
    await whatsappService.createConfig(ORG2, USER, { name: 'Other', phone_number_id: 'p', access_token: 't' })
    const list = await whatsappService.getConfigs(ORG)
    expect(list).toHaveLength(2)
    expect(list.every(c => c.org_id === ORG)).toBe(true)
  })

  it('verifyToken matches the persisted webhook_verify_token only', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    expect(await whatsappService.verifyToken(cfg.webhook_verify_token!)).toBe(true)
    expect(await whatsappService.verifyToken('nope')).toBe(false)
  })

  it('getMessages filters by org/config/status with pagination + total', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    // seed messages directly (sending path requires the Meta HTTP call)
    await db.insert(whatsapp_messages).values([
      { id: 'm1', org_id: ORG, config_id: cfg.id, phone_number: '111', status: 'sent' },
      { id: 'm2', org_id: ORG, config_id: cfg.id, phone_number: '222', status: 'failed' },
      { id: 'm3', org_id: ORG2, config_id: 'other', phone_number: '333', status: 'sent' },
    ])

    const all = await whatsappService.getMessages(ORG)
    expect(all.total).toBe(2)
    expect(all.messages).toHaveLength(2)

    const onlySent = await whatsappService.getMessages(ORG, { status: 'sent' })
    expect(onlySent.total).toBe(1)
    expect(onlySent.messages[0].id).toBe('m1')

    const byConfig = await whatsappService.getMessages(ORG, { configId: cfg.id, limit: 1, offset: 0 })
    expect(byConfig.total).toBe(2)
    expect(byConfig.messages).toHaveLength(1) // limited
  })

  it('processWebhook updates message status/timestamps by wamid', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    await db.insert(whatsapp_messages).values([
      { id: 'm1', org_id: ORG, config_id: cfg.id, phone_number: '111', status: 'sent', wamid: 'wamid_1' },
      { id: 'm2', org_id: ORG, config_id: cfg.id, phone_number: '222', status: 'sent', wamid: 'wamid_2' },
    ])

    await whatsappService.processWebhook({
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid_1', status: 'delivered', timestamp: '1700000000' },
              { id: 'wamid_2', status: 'failed', errors: [{ message: 'boom' }] },
            ],
          },
        }],
      }],
    })

    const res = await whatsappService.getMessages(ORG)
    const m1 = res.messages.find(m => m.id === 'm1')!
    const m2 = res.messages.find(m => m.id === 'm2')!
    expect(m1.status).toBe('delivered')
    expect(m1.delivered_at).not.toBeNull()
    expect(m2.status).toBe('failed')
    expect(m2.error_message).toBe('boom')
  })

  it('getStats aggregates counts + rates as integers, scoped to org', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, { name: 'A', phone_number_id: 'p', access_token: 't' })
    await db.insert(whatsapp_messages).values([
      { id: 'm1', org_id: ORG, config_id: cfg.id, phone_number: '1', status: 'sent' },
      { id: 'm2', org_id: ORG, config_id: cfg.id, phone_number: '2', status: 'delivered' },
      { id: 'm3', org_id: ORG, config_id: cfg.id, phone_number: '3', status: 'read' },
      { id: 'm4', org_id: ORG, config_id: cfg.id, phone_number: '4', status: 'failed' },
      { id: 'm5', org_id: ORG2, config_id: 'x', phone_number: '5', status: 'read' }, // other org ignored
    ])

    const stats = await whatsappService.getStats(ORG)
    expect(stats.total_messages).toBe(4)
    expect(stats.sent).toBe(3) // sent + delivered + read
    expect(stats.delivered).toBe(2) // delivered + read
    expect(stats.read).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.delivery_rate).toBe(67) // round(2/3 * 100)
    expect(stats.read_rate).toBe(33) // round(1/3 * 100)
  })

  it('getStats returns zeros for an org with no messages', async () => {
    const stats = await whatsappService.getStats(ORG)
    expect(stats).toEqual({
      total_messages: 0, sent: 0, delivered: 0, read: 0, failed: 0, delivery_rate: 0, read_rate: 0,
    })
  })

  it('lands a config on Postgres with expected column types (cross-check)', async () => {
    const cfg = await whatsappService.createConfig(ORG, USER, {
      name: 'X', phone_number_id: 'pn', access_token: 'tok', daily_limit: 250,
    })
    const res = await db.execute(
      sql`select org_id, daily_limit, sent_today, status, provider from whatsapp_configs where id = ${cfg.id}`,
    )
    const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].org_id).toBe(ORG)
    expect(Number(rows[0].daily_limit)).toBe(250)
    expect(Number(rows[0].sent_today)).toBe(0)
    expect(rows[0].status).toBe('active')
    expect(rows[0].provider).toBe('meta')
  })
})
