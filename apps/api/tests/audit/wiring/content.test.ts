// Behavioral spot-tests — templates/automations/segments routes fire the right audit/activity
// action on the success path: template delete, automation activate, segment create.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

vi.mock('../../../src/services/templateService', () => ({
  templateService: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    duplicate: vi.fn(),
    renderPreview: vi.fn(),
    extractVariables: vi.fn(),
    getStarterTemplates: vi.fn(),
    listSections: vi.fn(),
    createSection: vi.fn(),
    getSection: vi.fn(),
    updateSection: vi.fn(),
    deleteSection: vi.fn(),
    incrementSectionUsage: vi.fn(),
  },
}))
vi.mock('../../../src/services/automationService', () => ({
  automationService: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    getSteps: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    activate: vi.fn(),
    pause: vi.fn(),
    deactivate: vi.fn(),
    getEnrollments: vi.fn(),
    enrollContact: vi.fn(),
    exitContact: vi.fn(),
    getStats: vi.fn(),
  },
}))
vi.mock('../../../src/services/segmentService', () => ({
  segmentService: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addContacts: vi.fn(),
    removeContacts: vi.fn(),
    getStaticMembers: vi.fn(),
  },
}))

import { auditService } from '../../../src/services/auditService'
import { templateService } from '../../../src/services/templateService'
import { automationService } from '../../../src/services/automationService'
import { segmentService } from '../../../src/services/segmentService'
import templatesRoutes from '../../../src/routes/templates'
import automationsRoutes from '../../../src/routes/automations'
import segmentsRoutes from '../../../src/routes/segments'

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

describe('content (templates/automations/segments) audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('template DELETE fires template.deleted (audit) + template.deleted (activity)', async () => {
    vi.mocked(templateService.delete).mockResolvedValue(true as any)

    const res = await appFor(templatesRoutes as any).fetch(json('DELETE', '/templates/tpl-1'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.deleted', entityType: 'template', entityId: 'tpl-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.deleted', entityType: 'template', entityId: 'tpl-1' })
    )
  })

  it('automation activate fires automation.activated (audit + activity)', async () => {
    vi.mocked(automationService.activate).mockResolvedValue(true as any)

    const res = await appFor(automationsRoutes as any).fetch(json('POST', '/automations/auto-1/activate'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation.activated', entityType: 'automation', entityId: 'auto-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation.activated', entityType: 'automation', entityId: 'auto-1' })
    )
  })

  it('segment create fires segment.created (audit) + segment.created (activity)', async () => {
    vi.mocked(segmentService.create).mockResolvedValue({ id: 'seg-1', name: 'VIPs' } as any)

    const res = await appFor(segmentsRoutes as any).fetch(json('POST', '/segments', { name: 'VIPs' }))

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'segment.created', entityType: 'segment', entityId: 'seg-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'segment.created', entityType: 'segment', entityId: 'seg-1' })
    )
  })
})
