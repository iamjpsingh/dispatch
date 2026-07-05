// Behavioral spot-tests — config/SMTP, api-keys, and oauth routes fire the right audit
// action on the success path (audit-only slice, no activity calls). R9 proof: the
// POST /config/smtp case asserts the logged call contains NO trace of the plaintext
// password sent in the request body.
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
vi.mock('../../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: {
    getUserSMTPConfigs: vi.fn(),
    getUserDefaultSMTPConfig: vi.fn(),
    createSMTPConfig: vi.fn(),
    updateSMTPConfig: vi.fn(),
    deleteSMTPConfig: vi.fn(),
  },
}))
vi.mock('../../../src/services/apiKeyService', () => ({
  apiKeyService: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
    toggle: vi.fn(),
    updateScopes: vi.fn(),
    validate: vi.fn(),
  },
}))

import { auditService } from '../../../src/services/auditService'
import { d1UserDatabase } from '../../../src/services/d1UserDatabase'
import { apiKeyService } from '../../../src/services/apiKeyService'
import configRoutes from '../../../src/routes/config'
import apiKeysRoutes from '../../../src/routes/apikeys'
import oauthRoutes from '../../../src/routes/oauth'

const TEST_USER = { id: 'u1', email: 'u@t.co' }

function appFor(routes: Hono) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org1')
    await next()
  })
  app.route('/', routes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

const json = (m: string, p: string, b?: object) =>
  new Request(`http://localhost${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  })

describe('config/apikeys/oauth audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('POST /config/smtp fires smtp.created with no password anywhere in the logged call', async () => {
    vi.mocked(d1UserDatabase.createSMTPConfig).mockResolvedValue('cfg-new')
    const SENTINEL_PASSWORD = 'SUPERSECRET_pw_123'

    const res = await appFor(configRoutes).fetch(
      json('POST', '/config/smtp', {
        host: 'smtp.example.com',
        user: 'user@example.com',
        pass: SENTINEL_PASSWORD,
        fromEmail: 'sender@example.com',
        port: 587,
      })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'smtp.created', entityType: 'smtp', entityId: 'cfg-new', actorId: 'u1', orgId: 'org1' })
    )
    // R9 proof: the sentinel password must not appear anywhere in the logged call args.
    const loggedArg = vi.mocked(auditService.log).mock.calls[0][0]
    expect(JSON.stringify(loggedArg)).not.toContain(SENTINEL_PASSWORD)
    expect(loggedArg.metadata).toEqual({ secretChanged: true })
  })

  it('DELETE /api-keys/:id fires apikey.revoked', async () => {
    vi.mocked(apiKeyService.revoke).mockResolvedValue(true)

    const res = await appFor(apiKeysRoutes).fetch(json('DELETE', '/api-keys/key-1'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apikey.revoked', entityType: 'apikey', entityId: 'key-1', actorId: 'u1', orgId: 'org1' })
    )
  })

  it('DELETE /oauth/:configId/disconnect fires provider.disconnected', async () => {
    vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([
      { id: 'cfg-1', provider_type: 'google', oauth_email: 'a@b.co' } as any,
    ])
    vi.mocked(d1UserDatabase.deleteSMTPConfig).mockResolvedValue(true)

    const res = await appFor(oauthRoutes).fetch(json('DELETE', '/oauth/cfg-1/disconnect'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'provider.disconnected', entityType: 'smtp', entityId: 'cfg-1', actorId: 'u1', orgId: 'org1' })
    )
  })
})
