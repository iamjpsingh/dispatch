// Behavioral spot-tests — forms/pages/webhooks routes fire the right audit/activity
// action on the success path: page publish, form delete, webhook create (audit-only).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

vi.mock('../../../src/services/formService', () => ({
  formService: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggleStatus: vi.fn(),
    recordSubmission: vi.fn(),
    getSubmissions: vi.fn(),
    getEmbedCode: vi.fn(),
  },
}))
vi.mock('../../../src/services/landingPageService', () => ({
  landingPageService: {
    getTemplates: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    getBySlug: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    delete: vi.fn(),
    incrementVisits: vi.fn(),
    renderPage: vi.fn(),
  },
}))
vi.mock('../../../src/services/webhookService', () => ({
  webhookService: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    toggleEnabled: vi.fn(),
    getLogs: vi.fn(),
    clearLogs: vi.fn(),
    testWebhook: vi.fn(),
  },
}))

import { auditService } from '../../../src/services/auditService'
import { formService } from '../../../src/services/formService'
import { landingPageService } from '../../../src/services/landingPageService'
import { webhookService } from '../../../src/services/webhookService'
import formsRoutes from '../../../src/routes/forms'
import pagesRoutes from '../../../src/routes/pages'
import webhooksRoutes from '../../../src/routes/webhooks'

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

describe('channels (forms/pages/webhooks) audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('page publish fires page.published (audit-only)', async () => {
    vi.mocked(landingPageService.publish).mockResolvedValue(true)
    vi.mocked(landingPageService.get).mockResolvedValue({ id: 'page-1', slug: 'my-page' } as any)

    const res = await appFor(pagesRoutes as any).fetch(json('POST', '/pages/page-1/publish'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'page.published', entityType: 'page', entityId: 'page-1', actorId: 'u1', orgId: 'org1' })
    )
  })

  it('form DELETE fires form.deleted (audit) + form.deleted (activity)', async () => {
    vi.mocked(formService.delete).mockResolvedValue(true)

    const res = await appFor(formsRoutes as any).fetch(json('DELETE', '/forms/form-1'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form.deleted', entityType: 'form', entityId: 'form-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form.deleted', entityType: 'form', entityId: 'form-1' })
    )
  })

  it('webhook create fires webhook.created (audit-only, no activity)', async () => {
    vi.mocked(webhookService.create).mockResolvedValue({
      id: 'wh-1', name: 'Test Webhook', url: 'https://example.com/hook', events: ['bounce'], secret: 'supersecretvalue',
    } as any)

    const res = await appFor(webhooksRoutes as any).fetch(
      json('POST', '/webhooks', { name: 'Test Webhook', url: 'https://example.com/hook', events: ['bounce'] })
    )

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.created', entityType: 'webhook', entityId: 'wh-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })
})
