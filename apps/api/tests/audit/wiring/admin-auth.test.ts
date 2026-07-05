// Behavioral spot-tests — admin (platform/org) + auth routes fire the right audit
// action on the success path (audit-only slice, no activity calls).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../../src/services/rbacService', () => ({
  PERMISSIONS: new Proxy({}, { get: () => 'x' }),
  rbacService: { canManageUser: vi.fn(), isMember: vi.fn(), isPlatformAdmin: vi.fn() },
}))
vi.mock('../../../src/services/orgService', () => ({
  orgService: { updateMemberRole: vi.fn(), getMember: vi.fn() },
}))
vi.mock('../../../src/services/teamService', () => ({
  teamService: { update: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), get: vi.fn() },
}))
vi.mock('../../../src/services/sendingDomainService', () => ({
  sendingDomainService: { addDomain: vi.fn(), getDnsRecords: vi.fn(() => []) },
}))
const dbChain: any = {
  update: () => dbChain,
  set: () => dbChain,
  where: () => dbChain,
  returning: () => Promise.resolve([{ id: 'org-1' }]),
}
vi.mock('../../../src/db/pg/client', () => ({ getDb: () => dbChain }))
vi.mock('../../../src/services/authLocalService', () => ({
  authLocalService: { validateSession: vi.fn(), switchOrg: vi.fn() },
}))

import { auditService } from '../../../src/services/auditService'
import { rbacService } from '../../../src/services/rbacService'
import { orgService } from '../../../src/services/orgService'
import { teamService } from '../../../src/services/teamService'
import { sendingDomainService } from '../../../src/services/sendingDomainService'
import { authLocalService } from '../../../src/services/authLocalService'
import adminRoutes from '../../../src/routes/admin'
import authRoutes from '../../../src/routes/auth'

function appFor(routes: Hono) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = { id: 'u1', email: 'u@t.co' } as any
    c.set('orgId', 'org1')
    await next()
  })
  app.route('/', routes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

const json = (m: string, p: string, b?: object, headers?: Record<string, string>) =>
  new Request(`http://localhost${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: b ? JSON.stringify(b) : undefined,
  })

describe('admin/auth audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('PUT /admin/platform/orgs/:orgId/status fires org.status_changed', async () => {
    const res = await appFor(adminRoutes).fetch(
      json('PUT', '/admin/platform/orgs/org-1/status', { status: 'suspended' })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.status_changed', entityType: 'org', entityId: 'org-1' })
    )
  })

  it('POST /admin/org/domains fires domain.created', async () => {
    vi.mocked(sendingDomainService.addDomain).mockResolvedValue({ id: 'dom-1', domain: 'example.com' } as any)

    const res = await appFor(adminRoutes).fetch(json('POST', '/admin/org/domains', { domain: 'example.com' }))

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'domain.created', entityType: 'domain', entityId: 'dom-1' })
    )
  })

  it('PUT /admin/org/members/:userId/role fires member.role_changed', async () => {
    vi.mocked(rbacService.canManageUser).mockResolvedValue(true)
    vi.mocked(orgService.updateMemberRole).mockResolvedValue(true)

    const res = await appFor(adminRoutes).fetch(json('PUT', '/admin/org/members/user-2/role', { role: 'admin' }))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.role_changed', entityType: 'member', entityId: 'user-2' })
    )
  })

  it('PUT /admin/teams/:teamId fires team.updated', async () => {
    vi.mocked(teamService.update).mockResolvedValue(true)

    const res = await appFor(adminRoutes).fetch(json('PUT', '/admin/teams/team-9', { name: 'Renamed' }))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.updated', entityType: 'team', entityId: 'team-9' })
    )
  })

  it('POST /admin/teams/:teamId/members fires team.member_added', async () => {
    vi.mocked(teamService.get).mockResolvedValue({ id: 'team-9' } as any)
    vi.mocked(orgService.getMember).mockResolvedValue({ id: 'om-1' } as any)
    vi.mocked(teamService.addMember).mockResolvedValue(true)

    const res = await appFor(adminRoutes).fetch(json('POST', '/admin/teams/team-9/members', { userId: 'user-7' }))

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.member_added',
        entityType: 'team',
        metadata: expect.objectContaining({ userId: 'user-7' }),
      })
    )
  })

  it('DELETE /admin/teams/:teamId/members/:userId fires team.member_removed', async () => {
    vi.mocked(teamService.removeMember).mockResolvedValue(true)

    const res = await appFor(adminRoutes).fetch(json('DELETE', '/admin/teams/team-9/members/user-7'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.member_removed',
        entityType: 'team',
        metadata: expect.objectContaining({ userId: 'user-7' }),
      })
    )
  })

  it('POST /auth/switch-org fires session.org_switched with toOrgId metadata', async () => {
    vi.mocked(authLocalService.validateSession).mockResolvedValue({
      user: { id: 'u1', email: 'u@t.co', name: 'U', status: 'active', is_platform_admin: 0 },
      orgId: 'org1',
    })
    vi.mocked(rbacService.isMember).mockResolvedValue(true)
    vi.mocked(rbacService.isPlatformAdmin).mockResolvedValue(false)
    vi.mocked(authLocalService.switchOrg).mockResolvedValue(true)

    const res = await appFor(authRoutes).fetch(
      json('POST', '/auth/switch-org', { orgId: 'org2' }, { Cookie: 'session_token=tok123' })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'session.org_switched', entityType: 'org', entityId: 'org2' })
    )
    const loggedArg = vi.mocked(auditService.log).mock.calls[0][0]
    expect(loggedArg.metadata).toEqual({ toOrgId: 'org2' })
  })
})
