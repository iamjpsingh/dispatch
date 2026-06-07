// P2.1b SAFETY NET — exercises the REAL auth + RBAC middleware against the REAL
// identity services on a real (PGlite) Postgres. This is the net for the sync→async
// Drizzle swap: a missed `await` in a gate turns a boolean check into an always-truthy
// Promise, which `tsc` cannot catch. The "DENIED" cases below are bypass detectors —
// if a permission/membership/platform-admin gate is silently skipped, they flip to 200.
//
// Fixtures are inserted directly via Drizzle (not register()/login(), which need Bun.password
// — unavailable under the Node/vitest runtime). The gate methods under test
// (validateSession, hasPermission, isPlatformAdmin, isMember, ...) don't use Bun.password.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

// auditService writes to a separate logs.db (bun:sqlite) and is irrelevant to the gate.
vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { seedSystemRoles } from '../../src/db/pg/seed'
import { organizations, users, sessions, org_members } from '../../src/db/pg/schema'
import { authMiddleware } from '../../src/middleware/auth'
import {
  requirePermission,
  requireAnyPermission,
  requirePlatformAdmin,
  requireOrgMember,
} from '../../src/middleware/rbac'
import { PERMISSIONS } from '../../src/services/rbacService'

const ORG = 'org_test'
const future = () => new Date(Date.now() + 86_400_000).toISOString()

const TOKENS = {
  owner: 'tok_owner', // org_owner role in ORG → full permissions
  member: 'tok_member', // readonly role in ORG → view-only
  admin: 'tok_admin', // platform admin; session points at ORG but NOT a member
  outsider: 'tok_outsider', // session points at ORG but NOT a member, not admin
}

async function seed(db: TestDb) {
  await seedSystemRoles(db)
  await db.insert(organizations).values({ id: ORG, name: 'Test Org', slug: 'test-org' })
  await db.insert(users).values([
    { id: 'u_owner', email: 'owner@test.com', name: 'Owner', password_hash: 'x' },
    { id: 'u_member', email: 'member@test.com', name: 'Member', password_hash: 'x' },
    { id: 'u_admin', email: 'admin@test.com', name: 'Admin', password_hash: 'x', is_platform_admin: 1 },
    { id: 'u_outsider', email: 'outsider@test.com', name: 'Outsider', password_hash: 'x' },
  ])
  await db.insert(org_members).values([
    { id: 'om_owner', org_id: ORG, user_id: 'u_owner', role: 'owner', status: 'active' },
    { id: 'om_member', org_id: ORG, user_id: 'u_member', role: 'readonly', status: 'active' },
  ])
  await db.insert(sessions).values([
    { id: 's_owner', user_id: 'u_owner', token: TOKENS.owner, org_id: ORG, expires_at: future() },
    { id: 's_member', user_id: 'u_member', token: TOKENS.member, org_id: ORG, expires_at: future() },
    { id: 's_admin', user_id: 'u_admin', token: TOKENS.admin, org_id: ORG, expires_at: future() },
    { id: 's_outsider', user_id: 'u_outsider', token: TOKENS.outsider, org_id: ORG, expires_at: future() },
  ])
}

function buildApp() {
  const app = new Hono()
  app.use('*', authMiddleware)
  app.get('/perm/manage', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), (c) => c.json({ ok: true }))
  app.get('/perm/view', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => c.json({ ok: true }))
  app.get('/perm/multi', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CONTACTS_MANAGE), (c) => c.json({ ok: true }))
  app.get('/perm/any', requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.BILLING_MANAGE), (c) => c.json({ ok: true }))
  app.get('/platform', requirePlatformAdmin(), (c) => c.json({ ok: true }))
  app.get('/member', requireOrgMember(), (c) => c.json({ ok: true }))
  return app
}

function call(app: Hono, path: string, token?: string) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  return app.fetch(new Request(`http://localhost${path}`, { headers }))
}

describe('P2.1b — auth + RBAC gate integration (real middleware + real services on PGlite)', () => {
  let app: Hono
  beforeEach(async () => {
    const db = await freshDbMigrated()
    __setTestDb(db)
    await seed(db)
    app = buildApp()
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  // ---- authMiddleware (validateSession) ----
  it('rejects a request with no token (401)', async () => {
    expect((await call(app, '/perm/view')).status).toBe(401)
  })
  it('rejects an invalid/unknown token (401)', async () => {
    expect((await call(app, '/perm/view', 'garbage')).status).toBe(401)
  })
  it('accepts a valid session (200)', async () => {
    expect((await call(app, '/perm/view', TOKENS.owner)).status).toBe(200)
  })

  // ---- requirePermission (single) ----
  it('owner has campaigns.manage (200)', async () => {
    expect((await call(app, '/perm/manage', TOKENS.owner)).status).toBe(200)
  })
  it('readonly member is DENIED campaigns.manage (403) — bypass detector', async () => {
    expect((await call(app, '/perm/manage', TOKENS.member)).status).toBe(403)
  })
  it('readonly member has campaigns.view (200)', async () => {
    expect((await call(app, '/perm/view', TOKENS.member)).status).toBe(200)
  })

  // ---- requirePermission (multi / hasAllPermissions) ----
  it('owner passes a multi-permission gate (200)', async () => {
    expect((await call(app, '/perm/multi', TOKENS.owner)).status).toBe(200)
  })
  it('readonly member is DENIED a multi-permission gate (403) — bypass detector', async () => {
    expect((await call(app, '/perm/multi', TOKENS.member)).status).toBe(403)
  })

  // ---- requireAnyPermission ----
  it('owner passes requireAnyPermission (200)', async () => {
    expect((await call(app, '/perm/any', TOKENS.owner)).status).toBe(200)
  })
  it('readonly member is DENIED requireAnyPermission (403) — bypass detector', async () => {
    expect((await call(app, '/perm/any', TOKENS.member)).status).toBe(403)
  })

  // ---- requirePlatformAdmin ----
  it('non-admin is DENIED a platform-admin route (403) — bypass detector', async () => {
    expect((await call(app, '/platform', TOKENS.member)).status).toBe(403)
  })
  it('platform admin passes a platform-admin route (200)', async () => {
    expect((await call(app, '/platform', TOKENS.admin)).status).toBe(200)
  })

  // ---- requireOrgMember (compound !isPlatformAdmin && !isMember) ----
  it('an org member passes requireOrgMember (200)', async () => {
    expect((await call(app, '/member', TOKENS.member)).status).toBe(200)
  })
  it('a non-member (session pointed at the org) is DENIED requireOrgMember (403) — bypass detector', async () => {
    expect((await call(app, '/member', TOKENS.outsider)).status).toBe(403)
  })
  it('a platform admin bypasses org membership (200)', async () => {
    expect((await call(app, '/member', TOKENS.admin)).status).toBe(200)
  })
})
