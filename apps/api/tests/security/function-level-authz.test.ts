// P9 T2 — M4: routing.ts, warmup.ts, oauth.ts, plugins.ts gated every handler on requireAuth
// only, so a readonly/member role could mutate sending infrastructure (routing config,
// provider health, warmup plans, OAuth connections, plugins). This adds requirePermission(...)
// to the mutating handlers. The "denies" case below is a bypass detector — it walks EVERY
// guarded mutation; if a guard is missing or misplaced, that route flips from 403 to
// 2xx/4xx-not-403 and fails with its method+path. The guard runs before zValidator, so an
// unauthorized readonly caller is rejected regardless of body shape (empty bodies are fine).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { seedSystemRoles } from '../../src/db/pg/seed'
import { organizations, users, sessions, org_members } from '../../src/db/pg/schema'
import { authMiddleware } from '../../src/middleware/auth'
import routingRoutes from '../../src/routes/routing'
import warmupRoutes from '../../src/routes/warmup'
import oauthRoutes from '../../src/routes/oauth'
import pluginsRoutes from '../../src/routes/plugins'

const ORG = 'org_a'
const TOK_READONLY = 'tok_ro'
const future = () => new Date(Date.now() + 86_400_000).toISOString()

// Every mutating handler guarded by M4 — SMTP_MANAGE (routing/warmup/oauth) + SETTINGS_MANAGE (plugins).
const MUTATIONS: ReadonlyArray<readonly [string, string]> = [
  ['PUT', '/routing/config'],
  ['POST', '/routing/providers/init'],
  ['POST', '/routing/providers/cfg1/health'],
  ['POST', '/routing/failover'],
  ['POST', '/warmup'],
  ['POST', '/warmup/p1/pause'],
  ['POST', '/warmup/p1/resume'],
  ['POST', '/warmup/p1/cancel'],
  ['DELETE', '/warmup/p1'],
  ['DELETE', '/oauth/cfg1/disconnect'],
  ['POST', '/oauth/cfg1/test'],
  ['POST', '/plugins'],
  ['POST', '/plugins/pl1/activate'],
  ['POST', '/plugins/pl1/disable'],
  ['PUT', '/plugins/pl1/settings'],
  ['DELETE', '/plugins/pl1'],
]

async function seed(db: TestDb) {
  await seedSystemRoles(db)
  await db.insert(organizations).values({ id: ORG, name: 'A', slug: 'a' })
  await db.insert(users).values({ id: 'u_ro', email: 'ro@t.co', name: 'RO', password_hash: 'x' })
  await db.insert(org_members).values({ id: 'om_ro', org_id: ORG, user_id: 'u_ro', role: 'readonly', status: 'active' })
  await db.insert(sessions).values({ id: 's_ro', user_id: 'u_ro', token: TOK_READONLY, org_id: ORG, expires_at: future() })
}

function app() {
  const a = new Hono()
  a.use('*', authMiddleware)
  a.route('/', routingRoutes); a.route('/', warmupRoutes); a.route('/', oauthRoutes); a.route('/', pluginsRoutes)
  a.onError((_e, c) => c.json({ success: false }, 500))
  return a
}
const req = (m: string, p: string, b: object = {}) => new Request(`http://localhost${p}`, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK_READONLY}` }, body: JSON.stringify(b),
})

describe('P9 M4 — readonly cannot mutate sending infrastructure', () => {
  let a: Hono
  beforeEach(async () => { const db = await freshDbMigrated(); __setTestDb(db); await seed(db); a = app() }, 30_000)
  afterEach(() => { __setTestDb(null); vi.clearAllMocks() })

  it('denies readonly on every routing / warmup / oauth / plugins mutation (403)', async () => {
    for (const [method, path] of MUTATIONS) {
      const res = await a.fetch(req(method, path))
      expect(res.status, `${method} ${path} should be 403 for readonly`).toBe(403)
    }
  })
})
