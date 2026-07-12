// P8 T5 — M1: POST /campaigns/:id/ab/winner was the only A/B endpoint missing the
// campaignService.get(orgId, campaignId) ownership guard, and declareWinner has no org
// predicate — so an org-A manager could clear/flip another org's A/B winner. Drives the REAL
// campaignsRoutes + REAL campaignService on PGlite. The cross-tenant case is a bypass detector.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

// Stub connection-prone peripherals so importing campaignsRoutes is side-effect-free.
vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))
vi.mock('../../src/services/queueEngine', () => ({ queueEngine: { enqueue: vi.fn() } }))
vi.mock('../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: { getUserDefaultSMTPConfig: vi.fn(), getUserSMTPConfigs: vi.fn() },
}))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { seedSystemRoles } from '../../src/db/pg/seed'
import { organizations, users, sessions, org_members } from '../../src/db/pg/schema'
import { authMiddleware } from '../../src/middleware/auth'
import { campaignService } from '../../src/services/campaignService'
import campaignsRoutes from '../../src/routes/campaigns'

const ORG_A = 'org_a'
const ORG_B = 'org_b'
const TOK_A = 'tok_a'
const future = () => new Date(Date.now() + 86_400_000).toISOString()
const baseInput = { name: 'C', subject: 'S', from_name: 'N', from_email: 'e@t.co' }

async function seed(db: TestDb) {
  await seedSystemRoles(db)
  await db.insert(organizations).values([
    { id: ORG_A, name: 'A', slug: 'a' },
    { id: ORG_B, name: 'B', slug: 'b' },
  ])
  await db.insert(users).values([
    { id: 'u_a', email: 'a@t.co', name: 'A', password_hash: 'x' },
    { id: 'u_b', email: 'b@t.co', name: 'B', password_hash: 'x' },
  ])
  await db.insert(org_members).values([
    { id: 'om_a', org_id: ORG_A, user_id: 'u_a', role: 'admin', status: 'active' },
  ])
  await db.insert(sessions).values([
    { id: 's_a', user_id: 'u_a', token: TOK_A, org_id: ORG_A, expires_at: future() },
  ])
}

function buildApp() {
  const app = new Hono()
  app.use('*', authMiddleware)
  app.route('/', campaignsRoutes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

function req(method: string, path: string, body?: object) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK_A}` },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('P8 T5 — campaign A/B winner cross-tenant isolation (M1)', () => {
  let app: Hono
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seed(db)
    app = buildApp()
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('M1: declaring a winner on another org\'s A/B campaign is REJECTED (bypass detector)', async () => {
    const camp = await campaignService.create(ORG_B, 'u_b', { ...baseInput, type: 'ab_test' })
    const vA = await campaignService.createABVariant(camp.id, 'A', 50, { subject: 'SA' })
    const vB = await campaignService.createABVariant(camp.id, 'B', 50, { subject: 'SB' })
    await campaignService.declareWinner(camp.id, vA.id) // org B's current winner

    const res = await app.fetch(req('POST', `/campaigns/${camp.id}/ab/winner`, { variant_id: vB.id }))
    expect(res.status).toBe(404)
    // security property: org B's winner is UNCHANGED
    const variants = await campaignService.getABVariants(camp.id)
    expect(variants.find((v) => v.id === vA.id)?.is_winner).toBe(1)
    expect(variants.find((v) => v.id === vB.id)?.is_winner).toBe(0)
  })

  it('M1+: declaring a winner on your OWN org campaign still works (not over-restricted)', async () => {
    const camp = await campaignService.create(ORG_A, 'u_a', { ...baseInput, type: 'ab_test' })
    const vA = await campaignService.createABVariant(camp.id, 'A', 50, { subject: 'SA' })
    const vB = await campaignService.createABVariant(camp.id, 'B', 50, { subject: 'SB' })
    const res = await app.fetch(req('POST', `/campaigns/${camp.id}/ab/winner`, { variant_id: vB.id }))
    expect(res.status).toBe(200)
    const variants = await campaignService.getABVariants(camp.id)
    expect(variants.find((v) => v.id === vB.id)?.is_winner).toBe(1)
    expect(variants.find((v) => v.id === vA.id)?.is_winner).toBe(0)
  })
})
