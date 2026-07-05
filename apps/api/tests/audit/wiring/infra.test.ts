// Behavioral spot-tests — whatsapp/queue/plugins/send routes fire the right audit
// action on the success path: config create, suppression add, plugin enable,
// send enqueue (all audit-only, no activity).
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
    enqueue: vi.fn(),
    getActiveJobIds: vi.fn(),
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

vi.mock('../../../src/services/sendHelpers', () => ({
  getUserConfig: vi.fn(),
  validateSendRequest: vi.fn(),
  testConnection: vi.fn(),
  buildEmailConfig: vi.fn(),
  processExcelFile: vi.fn(),
  checkProviderLimits: vi.fn(),
  processHtmlTemplate: vi.fn(),
  sendBulkOAuthEmails: vi.fn(),
}))

vi.mock('../../../src/services/schedulerService', () => ({
  schedulerService: {
    scheduleJob: vi.fn(),
    getScheduledJobs: vi.fn(),
    cancelScheduledJob: vi.fn(),
  },
}))

import { auditService } from '../../../src/services/auditService'
import { whatsappService } from '../../../src/services/whatsappService'
import { queueEngine } from '../../../src/services/queueEngine'
import { pluginManager } from '../../../src/services/pluginManager'
import * as sendHelpers from '../../../src/services/sendHelpers'
import { schedulerService } from '../../../src/services/schedulerService'
import whatsappRoutes from '../../../src/routes/whatsapp'
import queueRoutes from '../../../src/routes/queue'
import pluginsRoutes from '../../../src/routes/plugins'
import sendRoutes from '../../../src/routes/send'

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

describe('infra (whatsapp/queue/plugins/send) audit wiring', () => {
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

  it('POST /send enqueues and fires send.enqueued (audit-only)', async () => {
    vi.mocked(sendHelpers.getUserConfig).mockResolvedValue({
      id: 'cfg-1', name: 'My SMTP', provider_type: 'smtp', host: 'smtp.test.com', from_email: 'from@test.com',
    } as any)
    vi.mocked(sendHelpers.validateSendRequest).mockReturnValue(null)
    vi.mocked(sendHelpers.testConnection).mockResolvedValue(null)
    vi.mocked(sendHelpers.processExcelFile).mockResolvedValue({ contacts: [{ email: 'a@test.com' }] })
    vi.mocked(sendHelpers.checkProviderLimits).mockReturnValue(null)
    // NOTE: send.ts's spam pre-scan reads `finalHtmlContent.html`, but processHtmlTemplate's
    // real return shape is `{ content }` (pre-existing mismatch in send.ts, out of scope for
    // this audit-wiring task — see task-8 report). Mock supplies both keys so the existing
    // (unrelated) handler code path doesn't crash before reaching the enqueue call under test.
    vi.mocked(sendHelpers.processHtmlTemplate).mockResolvedValue({ content: '<p>Hi</p>', html: '<p>Hi</p>' } as any)
    vi.mocked(sendHelpers.buildEmailConfig).mockReturnValue({
      host: 'smtp.test.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' },
    } as any)
    vi.mocked(queueEngine.enqueue).mockResolvedValue('job-999')

    const formData = new FormData()
    formData.set('configId', 'cfg-1')
    formData.set('subject', 'Hello')
    formData.set('htmlContent', '<p>Hi</p>')
    formData.set('excelFile', new File(['x'], 'contacts.xlsx'))

    const res = await appFor(sendRoutes as any).fetch(
      new Request('http://localhost/send', { method: 'POST', body: formData })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send.enqueued', entityType: 'send', entityId: 'job-999', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })

  it('POST /send (scheduled branch) fires send.enqueued with mode scheduled (audit-only)', async () => {
    vi.mocked(sendHelpers.getUserConfig).mockResolvedValue({
      id: 'cfg-1', name: 'My SMTP', provider_type: 'smtp', host: 'smtp.test.com', from_email: 'from@test.com',
    } as any)
    vi.mocked(sendHelpers.validateSendRequest).mockReturnValue(null)
    vi.mocked(sendHelpers.testConnection).mockResolvedValue(null)
    vi.mocked(sendHelpers.processExcelFile).mockResolvedValue({ contacts: [{ email: 'a@test.com' }] })
    vi.mocked(sendHelpers.checkProviderLimits).mockReturnValue(null)
    vi.mocked(sendHelpers.processHtmlTemplate).mockResolvedValue({ content: '<p>Hi</p>', html: '<p>Hi</p>' } as any)
    vi.mocked(sendHelpers.buildEmailConfig).mockReturnValue({
      host: 'smtp.test.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' },
    } as any)
    vi.mocked(schedulerService.scheduleJob).mockResolvedValue('sched-777')

    const formData = new FormData()
    formData.set('configId', 'cfg-1')
    formData.set('subject', 'Hello')
    formData.set('htmlContent', '<p>Hi</p>')
    formData.set('excelFile', new File(['x'], 'contacts.xlsx'))
    formData.set('scheduleEmail', 'on')
    // Explicit far-future literal — avoids new Date()/Date.now() in the test.
    formData.set('scheduledTime', '2099-01-01T00:00:00.000Z')

    const res = await appFor(sendRoutes as any).fetch(
      new Request('http://localhost/send', { method: 'POST', body: formData })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send.enqueued',
        entityType: 'send',
        entityId: 'sched-777',
        actorId: 'u1',
        orgId: 'org1',
        metadata: expect.objectContaining({ mode: 'scheduled' }),
      })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })

  it('POST /send (oauth branch) fires send.enqueued with mode oauth and no entityId (audit-only)', async () => {
    vi.mocked(sendHelpers.getUserConfig).mockResolvedValue({
      id: 'cfg-oauth', name: 'My Gmail', provider_type: 'google', oauth_email: 'me@gmail.com', from_email: 'me@gmail.com',
    } as any)
    vi.mocked(sendHelpers.validateSendRequest).mockReturnValue(null)
    vi.mocked(sendHelpers.testConnection).mockResolvedValue(null)
    vi.mocked(sendHelpers.processExcelFile).mockResolvedValue({ contacts: [{ email: 'a@test.com' }] })
    vi.mocked(sendHelpers.checkProviderLimits).mockReturnValue(null)
    vi.mocked(sendHelpers.processHtmlTemplate).mockResolvedValue({ content: '<p>Hi</p>', html: '<p>Hi</p>' } as any)
    vi.mocked(sendHelpers.sendBulkOAuthEmails).mockResolvedValue({ sent: 1, failed: 0, errors: [] } as any)

    const formData = new FormData()
    formData.set('configId', 'cfg-oauth')
    formData.set('subject', 'Hello')
    formData.set('htmlContent', '<p>Hi</p>')
    formData.set('excelFile', new File(['x'], 'contacts.xlsx'))

    const res = await appFor(sendRoutes as any).fetch(
      new Request('http://localhost/send', { method: 'POST', body: formData })
    )

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send.enqueued',
        entityType: 'send',
        actorId: 'u1',
        orgId: 'org1',
        metadata: expect.objectContaining({ mode: 'oauth' }),
      })
    )
    // OAuth send has no persistent job id — entityId must be absent.
    const enqueueCall = vi.mocked(auditService.log).mock.calls.find(([e]) => e.action === 'send.enqueued')
    expect(enqueueCall?.[0].entityId).toBeUndefined()
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })
})
