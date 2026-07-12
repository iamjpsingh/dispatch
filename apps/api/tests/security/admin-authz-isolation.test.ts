// P8 T5 — admin RBAC hardening (H1 team-remove cross-tenant IDOR, H2 change-role priv-esc,
// H3 add-member priv-esc, M3 permission-grant confused-deputy). Drives the REAL adminRoutes
// through the REAL auth + rbac middleware and REAL services on PGlite. Each "escalation
// blocked" / "cross-tenant blocked" case is a bypass detector: if a bound is skipped it flips
// to 201/200. Positive cases guard against over-restriction.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

// auditService writes to a separate logs.db (bun:sqlite) — irrelevant to the authz gates.
vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { seedSystemRoles } from '../../src/db/pg/seed'
import { organizations, users, sessions, org_members, teams, team_members, user_permissions } from '../../src/db/pg/schema'
import { authMiddleware } from '../../src/middleware/auth'
import { rbacService } from '../../src/services/rbacService'
import { teamService } from '../../src/services/teamService'
import adminRoutes from '../../src/routes/admin'
import { and, eq } from 'drizzle-orm'

const ORG_A = 'org_a'
const ORG_B = 'org_b'
const TOK_ADMIN_A = 'tok_admin_a'
const future = () => new Date(Date.now() + 86_400_000).toISOString()

async function seed(db: TestDb) {
  await seedSystemRoles(db)
  await db.insert(organizations).values([
    { id: ORG_A, name: 'Org A', slug: 'org-a' },
    { id: ORG_B, name: 'Org B', slug: 'org-b' },
  ])
  await db.insert(users).values([
    { id: 'u_admin_a', email: 'admin_a@test.com', name: 'Admin A', password_hash: 'x' },
    { id: 'u_member_a', email: 'member_a@test.com', name: 'Member A', password_hash: 'x' },
    { id: 'u_puppet', email: 'puppet@test.com', name: 'Puppet', password_hash: 'x' },
    { id: 'u_victim_b', email: 'victim_b@test.com', name: 'Victim B', password_hash: 'x' },
  ])
  await db.insert(org_members).values([
    { id: 'om_admin_a', org_id: ORG_A, user_id: 'u_admin_a', role: 'admin', status: 'active' },
    { id: 'om_member_a', org_id: ORG_A, user_id: 'u_member_a', role: 'member', status: 'active' },
    { id: 'om_victim_b', org_id: ORG_B, user_id: 'u_victim_b', role: 'member', status: 'active' },
  ])
  await db.insert(sessions).values([
    { id: 's_admin_a', user_id: 'u_admin_a', token: TOK_ADMIN_A, org_id: ORG_A, expires_at: future() },
  ])
  // team_a belongs to org A (admin's own); team_b belongs to org B (cross-tenant target)
  await db.insert(teams).values([
    { id: 'team_a', org_id: ORG_A, name: 'Team A', created_by: 'u_admin_a' },
    { id: 'team_b', org_id: ORG_B, name: 'Team B', created_by: 'u_victim_b' },
  ])
  await db.insert(team_members).values([
    { id: 'tm_a', team_id: 'team_a', user_id: 'u_member_a', role: 'member' },
    { id: 'tm_b', team_id: 'team_b', user_id: 'u_victim_b', role: 'member' },
  ])
}

function buildApp() {
  const app = new Hono()
  app.use('*', authMiddleware)
  app.route('/', adminRoutes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

function req(method: string, path: string, body?: object) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK_ADMIN_A}` },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('P8 T5 — admin RBAC hardening (priv-esc + cross-tenant IDOR)', () => {
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

  // ---- H3: add-member privilege escalation (org_admin cannot mint an owner) ----
  it('H3: org_admin adding a member as role "owner" is REJECTED (bypass detector)', async () => {
    const res = await app.fetch(req('POST', '/admin/org/members', { email: 'puppet@test.com', role: 'owner' }))
    expect(res.status).not.toBe(201)
    expect([400, 403]).toContain(res.status)
    // security property: the puppet was NOT added as owner
    const member = await db.select().from(org_members).where(and(eq(org_members.org_id, ORG_A), eq(org_members.user_id, 'u_puppet'))).limit(1)
    expect(member.length).toBe(0)
  })
  it('H3+: org_admin can still add a member as "member" (not over-restricted)', async () => {
    const res = await app.fetch(req('POST', '/admin/org/members', { email: 'puppet@test.com', role: 'member' }))
    expect(res.status).toBe(201)
  })

  // ---- H2: change-role privilege escalation (org_admin cannot promote to owner) ----
  it('H2: org_admin changing a member to role "owner" is REJECTED (bypass detector)', async () => {
    const res = await app.fetch(req('PUT', '/admin/org/members/u_member_a/role', { role: 'owner' }))
    expect(res.status).not.toBe(200)
    expect([400, 403]).toContain(res.status)
    // security property: u_member_a is still a plain member
    const role = await rbacService.getUserRole('u_member_a', ORG_A)
    expect(role).toBe('member')
  })
  it('H2+: org_admin can still change a member to "manager" (not over-restricted)', async () => {
    const res = await app.fetch(req('PUT', '/admin/org/members/u_member_a/role', { role: 'manager' }))
    expect(res.status).toBe(200)
    expect(await rbacService.getUserRole('u_member_a', ORG_A)).toBe('manager')
  })

  // ---- M3: permission-grant confused deputy (cannot grant a permission you don't hold) ----
  it('M3: org_admin granting "billing.manage" (which it lacks) is REJECTED (bypass detector)', async () => {
    const res = await app.fetch(req('POST', '/admin/permissions/u_member_a/grant', { permission: 'billing.manage' }))
    expect(res.status).toBe(403)
    // security property: the target did NOT receive billing.manage
    const granted = await db.select().from(user_permissions)
      .where(and(eq(user_permissions.org_id, ORG_A), eq(user_permissions.user_id, 'u_member_a'), eq(user_permissions.permission, 'billing.manage'))).limit(1)
    expect(granted.length).toBe(0)
    expect(await rbacService.hasPermission('u_member_a', ORG_A, 'billing.manage' as any)).toBe(false)
  })
  it('M3+: org_admin can still grant "campaigns.manage" (which it holds) (not over-restricted)', async () => {
    const res = await app.fetch(req('POST', '/admin/permissions/u_member_a/grant', { permission: 'campaigns.manage' }))
    expect(res.status).toBe(200)
    expect(await rbacService.hasPermission('u_member_a', ORG_A, 'campaigns.manage' as any)).toBe(true)
  })

  // ---- H1: cross-tenant team-member removal (org A admin cannot touch org B's team) ----
  it('H1: org_admin in A removing a member from org B\'s team is REJECTED (bypass detector)', async () => {
    const res = await app.fetch(req('DELETE', '/admin/teams/team_b/members/u_victim_b'))
    expect(res.status).toBe(404)
    // security property: the victim is STILL a member of team_b
    const stillThere = await db.select().from(team_members).where(and(eq(team_members.team_id, 'team_b'), eq(team_members.user_id, 'u_victim_b'))).limit(1)
    expect(stillThere.length).toBe(1)
  })
  it('H1+: org_admin can still remove a member from its OWN team (not over-restricted)', async () => {
    const res = await app.fetch(req('DELETE', '/admin/teams/team_a/members/u_member_a'))
    expect(res.status).toBe(200)
    expect(await teamService.removeMember(ORG_A, 'team_a', 'nobody', 'u_admin_a')).toBe(false)
  })
})
