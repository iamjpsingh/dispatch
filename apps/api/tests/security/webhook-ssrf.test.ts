// P8 T5 — H4: outbound webhook delivery (sendWebhook/testWebhook) fetched webhook.url with no
// host allowlist, so an internal/metadata URL was reachable (blind-SSRF oracle + response-body
// exfiltration via webhook_logs). Guard must (a) reject private/reserved URLs at create/update
// and (b) refuse to fetch them at the sink. Global fetch is stubbed → no real network.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, webhooks } from '../../src/db/pg/schema'
import { webhookService } from '../../src/services/webhookService'

const ORG = 'org_x'

const fetchMock = vi.fn(async () => new Response('internal-secret-data', { status: 200 }))

async function seedBase(db: TestDb) {
  await db.insert(organizations).values({ id: ORG, name: 'X', slug: 'x' })
  await db.insert(users).values({ id: 'u1', email: 'u1@t.co', name: 'U1', password_hash: 'x' })
}

async function seedWebhook(db: TestDb, url: string) {
  await db.insert(webhooks).values({
    id: 'wh_1', org_id: ORG, user_id: 'u1', name: 'W', url,
    secret: 'plainsecret', events: JSON.stringify(['email.sent']), enabled: 1,
  })
}

describe('P8 T5 — outbound webhook SSRF guard (H4)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seedBase(db)
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('H4: testWebhook does NOT fetch a cloud-metadata IP (169.254.169.254)', async () => {
    await seedWebhook(db, 'http://169.254.169.254/latest/meta-data/')
    const res = await webhookService.testWebhook(ORG, 'wh_1')
    expect(res.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('H4: testWebhook does NOT fetch localhost (host resolves to loopback)', async () => {
    await seedWebhook(db, 'http://localhost:9200/')
    const res = await webhookService.testWebhook(ORG, 'wh_1')
    expect(res.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('H4: create() rejects a private/loopback URL at the boundary', async () => {
    await expect(
      webhookService.create(ORG, 'u1', { name: 'W', url: 'http://127.0.0.1:5000/x', events: [] })
    ).rejects.toThrow()
  })

  it('H4: create() rejects a non-http(s) scheme', async () => {
    await expect(
      webhookService.create(ORG, 'u1', { name: 'W', url: 'file:///etc/passwd', events: [] })
    ).rejects.toThrow()
  })

  it('H4+: testWebhook still fetches a public host (not over-blocked)', async () => {
    await seedWebhook(db, 'http://8.8.8.8/hook')
    const res = await webhookService.testWebhook(ORG, 'wh_1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.success).toBe(true)
  })

  // T7 review: fetch defaults to redirect:'follow', so a public URL 302→internal would bypass
  // the guard. Delivery must never follow a redirect into an internal host.
  it('H4: fetch is invoked with redirect:"manual" (no redirect-follow SSRF)', async () => {
    await seedWebhook(db, 'http://8.8.8.8/hook')
    await webhookService.testWebhook(ORG, 'wh_1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const opts = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined
    expect(opts?.redirect).toBe('manual')
  })

  // T7 review: IPv6-literal handling — URL.hostname keeps the brackets, so isIP failed and the
  // guard used to reject ALL IPv6 literals (over-block) while blocking loopback only by accident.
  it('H4: create() accepts a public IPv6-literal URL but rejects loopback/NAT64/6to4 literals', async () => {
    const ok = await webhookService.create(ORG, 'u1', { name: 'v6', url: 'http://[2606:4700:4700::1111]/hook', events: [] })
    expect(ok.url).toBe('http://[2606:4700:4700::1111]/hook')
    for (const bad of ['http://[::1]:9200/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::]/']) {
      await expect(webhookService.create(ORG, 'u1', { name: 'x', url: bad, events: [] })).rejects.toThrow()
    }
  })
})
