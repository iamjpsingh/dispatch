// Behavioral spot-tests — whatsapp/queue/plugins routes fire the right audit
// action on the success path: config create, suppression add, plugin enable
// (all audit-only, no activity). POST /send branches live in infra-send.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

vi.mock('../../../src/services/whatsappService', () => ({
  whatsappService: {
    getConfigs: vi.fn(),
    getConfig: vi.fn(),
    createConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    getTemplates: vi.fn(),
    syncTemplates: vi.fn(),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    sendTemplate: vi.fn(),
    sendText: vi.fn(),
    sendBulk: vi.fn(),
    getMessages: vi.fn(),
    getStats: vi.fn(),
    verifyToken: vi.fn(),
    processWebhook: vi.fn(),
  },
}))

vi.mock('../../../src/services/queueEngine', () => ({
  queueEngine: {
    getJobs: vi.fn(),
    getJob: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    getStats: vi.fn(),
    getDeadLetters: vi.fn(),
    getSuppressionList: vi.fn(),
    suppress: vi.fn(),
    unsuppress: vi.fn(),
  },
}))

vi.mock('../../../src/services/pluginManager', () => ({
  pluginManager: {
    list: vi.fn(),
    getAvailableProviders: vi.fn(),
    discoverLocalPlugins: vi.fn(),
    getRegisteredHooks: vi.fn(),
    get: vi.fn(),
    install: vi.fn(),
    installBuiltinProvider: vi.fn(),
    activate: vi.fn(),
    disable: vi.fn(),
    updateSettings: vi.fn(),
    uninstall: vi.fn(),
  },
}))

import { auditService } from '../../../src/services/auditService'
import { whatsappService } from '../../../src/services/whatsappService'
import { queueEngine } from '../../../src/services/queueEngine'
import { pluginManager } from '../../../src/services/pluginManager'
import whatsappRoutes from '../../../src/routes/whatsapp'
import queueRoutes from '../../../src/routes/queue'
import pluginsRoutes from '../../../src/routes/plugins'

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

const json = (m: string, p: string, b?: object) =>
  new Request(`http://localhost${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  })

describe('infra (whatsapp/queue/plugins) audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('whatsapp config create fires whatsapp.config_created (audit-only)', async () => {
    vi.mocked(whatsappService.createConfig).mockResolvedValue({
      id: 'wac-1', name: 'Test', provider: 'meta', phone_number_id: '123', access_token: 'secret',
    } as any)

    const res = await appFor(whatsappRoutes as any).fetch(
      json('POST', '/whatsapp/configs', { name: 'Test', phone_number_id: '123', access_token: 'secret' })
    )

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.config_created', entityType: 'whatsapp', entityId: 'wac-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })

  it('queue suppression add fires suppression.added (audit-only)', async () => {
    const res = await appFor(queueRoutes as any).fetch(
      json('POST', '/queue/suppression', { email: 'bad@test.com', reason: 'bounce' })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'suppression.added', entityType: 'suppression', entityId: 'bad@test.com', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })

  it('plugin activate fires plugin.enabled (audit-only)', async () => {
    vi.mocked(pluginManager.activate).mockResolvedValue(true)

    const res = await appFor(pluginsRoutes as any).fetch(json('POST', '/plugins/plg-1/activate'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plugin.enabled', entityType: 'plugin', entityId: 'plg-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })
})
