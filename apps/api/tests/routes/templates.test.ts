import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/templateService', () => ({
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
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

// Bypass RBAC permission gates in route-handler unit tests (authorization is
// covered separately; these tests exercise handler logic, not the rbac layer).
vi.mock('../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))

import { templateService, type TemplateCategory } from '../../src/services/templateService'
import templateRoutes from '../../src/routes/templates'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).user = TEST_USER
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', templateRoutes)
  // Replicate src/app.ts onError: route handlers throw AppError(status); without
  // this handler those throws surface as uncaught 500s in the test harness.
  app.onError((err: any, c) => {
    if (err?.name === 'AppError' && 'status' in err) {
      return c.json({ success: false, message: err.message }, err.status)
    }
    return c.json({ success: false, message: 'Internal Server Error' }, 500)
  })
  return app
}

function jsonRequest(method: string, path: string, body?: object) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(body)
  return new Request(`http://localhost${path}`, init)
}

const SAMPLE_TEMPLATE = {
  id: 'tpl-1',
  user_id: 'user-1',
  name: 'Welcome Email',
  description: 'A welcome email template',
  category: 'welcome' as TemplateCategory,
  subject: 'Welcome {{FirstName}}!',
  html_content: '<h1>Hello {{FirstName}}</h1>',
  text_content: 'Hello {{FirstName}}',
  variables: '["FirstName"]',
  is_starter: 0,
  version: 1,
  parent_id: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

describe('Template Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /templates
  // ==========================================================================
  describe('GET /templates', () => {
    it('returns a paginated list of templates', async () => {
      const app = createApp()
      vi.mocked(templateService.list).mockReturnValue({
        templates: [SAMPLE_TEMPLATE],
        total: 1,
      })

      const res = await app.fetch(new Request('http://localhost/templates'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.meta.pagination.total).toBe(1)
      expect(body.meta.pagination.page).toBe(1)
    })

    it('passes filter params to the service', async () => {
      const app = createApp()
      vi.mocked(templateService.list).mockReturnValue({ templates: [], total: 0 })

      await app.fetch(new Request('http://localhost/templates?category=newsletter&search=hello&page=2&limit=10'))

      expect(templateService.list).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          category: 'newsletter',
          search: 'hello',
          page: 2,
          limit: 10,
        })
      )
    })

    it('returns empty array when no templates exist', async () => {
      const app = createApp()
      vi.mocked(templateService.list).mockReturnValue({ templates: [], total: 0 })

      const res = await app.fetch(new Request('http://localhost/templates'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toEqual([])
      expect(body.meta.pagination.total).toBe(0)
    })
  })

  // ==========================================================================
  // POST /templates
  // ==========================================================================
  describe('POST /templates', () => {
    const validPayload = {
      name: 'New Template',
      html_content: '<h1>Hello</h1>',
      subject: 'Test Subject',
    }

    it('creates a new template', async () => {
      const app = createApp()
      vi.mocked(templateService.create).mockReturnValue({
        ...SAMPLE_TEMPLATE,
        id: 'tpl-new',
        name: 'New Template',
      })

      const res = await app.fetch(jsonRequest('POST', '/templates', validPayload))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('tpl-new')
      expect(body.message).toBe('Template created')
    })

    it('returns 400 when name is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/templates', {
          html_content: '<p>Hello</p>',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when html_content is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/templates', {
          name: 'Template',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when name is empty whitespace', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/templates', {
          name: '   ',
          html_content: '<p>Hello</p>',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when html_content is empty whitespace', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/templates', {
          name: 'Template',
          html_content: '   ',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // GET /templates/starters
  // ==========================================================================
  describe('GET /templates/starters', () => {
    it('returns starter templates', async () => {
      const app = createApp()
      vi.mocked(templateService.getStarterTemplates).mockReturnValue([
        { ...SAMPLE_TEMPLATE, id: 'starter-1', is_starter: 1 },
      ])

      const res = await app.fetch(new Request('http://localhost/templates/starters'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.templates).toHaveLength(1)
    })

    it('returns empty array when no starters exist', async () => {
      const app = createApp()
      vi.mocked(templateService.getStarterTemplates).mockReturnValue([])

      const res = await app.fetch(new Request('http://localhost/templates/starters'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.templates).toEqual([])
    })
  })

  // ==========================================================================
  // GET /templates/:id
  // ==========================================================================
  describe('GET /templates/:id', () => {
    it('returns a specific template', async () => {
      const app = createApp()
      vi.mocked(templateService.get).mockReturnValue(SAMPLE_TEMPLATE)

      const res = await app.fetch(new Request('http://localhost/templates/tpl-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('tpl-1')
      expect(body.data.name).toBe('Welcome Email')
    })

    it('returns 404 when template not found', async () => {
      const app = createApp()
      vi.mocked(templateService.get).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/templates/nonexistent'))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // PUT /templates/:id
  // ==========================================================================
  describe('PUT /templates/:id', () => {
    it('updates a template', async () => {
      const app = createApp()
      vi.mocked(templateService.update).mockReturnValue(true)

      const res = await app.fetch(
        jsonRequest('PUT', '/templates/tpl-1', {
          name: 'Updated Template',
          html_content: '<h1>Updated</h1>',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('updated')
    })

    it('returns 404 when template not found or is a starter', async () => {
      const app = createApp()
      vi.mocked(templateService.update).mockReturnValue(false)

      const res = await app.fetch(jsonRequest('PUT', '/templates/nonexistent', { name: 'X' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // DELETE /templates/:id
  // ==========================================================================
  describe('DELETE /templates/:id', () => {
    it('deletes a template', async () => {
      const app = createApp()
      vi.mocked(templateService.delete).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/templates/tpl-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('deleted')
    })

    it('returns 404 when template not found or cannot be deleted', async () => {
      const app = createApp()
      vi.mocked(templateService.delete).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/templates/nonexistent', { method: 'DELETE' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // POST /templates/:id/duplicate
  // ==========================================================================
  describe('POST /templates/:id/duplicate', () => {
    it('duplicates a template', async () => {
      const app = createApp()
      vi.mocked(templateService.duplicate).mockReturnValue({
        ...SAMPLE_TEMPLATE,
        id: 'tpl-dup',
        name: 'Welcome Email (Copy)',
      })

      const res = await app.fetch(
        jsonRequest('POST', '/templates/tpl-1/duplicate', {
          name: 'Copy',
        })
      )

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('tpl-dup')
      expect(body.message).toContain('duplicated')
    })

    it('duplicates with default name when none provided', async () => {
      const app = createApp()
      vi.mocked(templateService.duplicate).mockReturnValue({
        ...SAMPLE_TEMPLATE,
        id: 'tpl-dup',
        name: 'Welcome Email (Copy)',
      })

      const res = await app.fetch(jsonRequest('POST', '/templates/tpl-1/duplicate', {}))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(templateService.duplicate).toHaveBeenCalledWith('org-1', 'user-1', 'tpl-1', 'Copy')
    })

    it('returns 404 when template not found', async () => {
      const app = createApp()
      vi.mocked(templateService.duplicate).mockReturnValue(null)

      const res = await app.fetch(jsonRequest('POST', '/templates/nonexistent/duplicate', { name: 'Copy' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // POST /templates/:id/preview
  // ==========================================================================
  describe('POST /templates/:id/preview', () => {
    it('renders a template preview with data', async () => {
      const app = createApp()
      vi.mocked(templateService.get).mockReturnValue(SAMPLE_TEMPLATE)
      vi.mocked(templateService.renderPreview).mockReturnValue('<h1>Hello Alice</h1>')

      const res = await app.fetch(
        jsonRequest('POST', '/templates/tpl-1/preview', {
          data: { FirstName: 'Alice' },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.html).toBe('<h1>Hello Alice</h1>')
      expect(body.data.variables).toEqual(['FirstName'])
    })

    it('renders preview with empty data', async () => {
      const app = createApp()
      vi.mocked(templateService.get).mockReturnValue(SAMPLE_TEMPLATE)
      vi.mocked(templateService.renderPreview).mockReturnValue('<h1>Hello {{FirstName}}</h1>')

      const res = await app.fetch(jsonRequest('POST', '/templates/tpl-1/preview', {}))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.html).toContain('{{FirstName}}')
    })

    it('returns 404 when template not found', async () => {
      const app = createApp()
      vi.mocked(templateService.get).mockReturnValue(null)

      const res = await app.fetch(
        jsonRequest('POST', '/templates/nonexistent/preview', {
          data: { FirstName: 'Alice' },
        })
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // POST /templates/preview (inline HTML preview)
  // ==========================================================================
  describe('POST /templates/preview', () => {
    it('renders inline HTML preview', async () => {
      const app = createApp()
      vi.mocked(templateService.renderPreview).mockReturnValue('<p>Hello World</p>')
      vi.mocked(templateService.extractVariables).mockReturnValue(['Name'])

      const res = await app.fetch(
        jsonRequest('POST', '/templates/preview', {
          html: '<p>Hello {{Name}}</p>',
          data: { Name: 'World' },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.html).toBe('<p>Hello World</p>')
      expect(body.data.variables).toEqual(['Name'])
    })

    it('returns 400 when html is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/templates/preview', { data: {} }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('renders with empty data when data is not provided', async () => {
      const app = createApp()
      vi.mocked(templateService.renderPreview).mockReturnValue('<p>Hello {{Name}}</p>')
      vi.mocked(templateService.extractVariables).mockReturnValue(['Name'])

      const res = await app.fetch(
        jsonRequest('POST', '/templates/preview', {
          html: '<p>Hello {{Name}}</p>',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(templateService.renderPreview).toHaveBeenCalledWith('<p>Hello {{Name}}</p>', {})
    })
  })
})
