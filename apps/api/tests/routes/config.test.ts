import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: {
    getUserSMTPConfigs: vi.fn(),
    getUserDefaultSMTPConfig: vi.fn(),
    createSMTPConfig: vi.fn(),
    updateSMTPConfig: vi.fn(),
    deleteSMTPConfig: vi.fn(),
  },
}))

vi.mock('../../src/services/emailService', () => ({
  emailService: {
    testConnection: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

// Bypass RBAC permission gates in route-handler unit tests.
vi.mock('../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))

import { d1UserDatabase } from '../../src/services/d1UserDatabase'
import { emailService } from '../../src/services/emailService'
import configRoutes from '../../src/routes/config'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  // Mock auth middleware — set user on every request
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', configRoutes)
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

const SAMPLE_CONFIG = {
  id: 'cfg-1',
  name: 'My SMTP',
  provider_type: 'smtp',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'user@example.com',
  password: 'secret',
  from_email: 'sender@example.com',
  from_name: 'Sender',
  is_default: true,
  oauth_email: null,
  created_at: '2025-01-01T00:00:00Z',
}

describe('Config Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /config/smtp
  // ==========================================================================
  describe('GET /config/smtp', () => {
    it('returns SMTP configs for the authenticated user', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([SAMPLE_CONFIG])
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(SAMPLE_CONFIG)

      const res = await app.fetch(new Request('http://localhost/config/smtp'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.hasConfig).toBe(true)
      expect(body.data.userConfigs).toHaveLength(1)
      expect(body.data.userId).toBe('user-1')
    })

    it('returns null data when no default config exists', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([])
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(null)

      const res = await app.fetch(new Request('http://localhost/config/smtp'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.data).toBeNull()
      expect(body.data.hasConfig).toBe(false)
    })
  })

  // ==========================================================================
  // GET /config/list
  // ==========================================================================
  describe('GET /config/list', () => {
    it('returns all configs formatted for the user', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([SAMPLE_CONFIG])

      const res = await app.fetch(new Request('http://localhost/config/list'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.configs).toHaveLength(1)
      expect(body.data.configs[0].id).toBe('cfg-1')
    })
  })

  // ==========================================================================
  // GET /config/smtp/active
  // ==========================================================================
  describe('GET /config/smtp/active', () => {
    it('returns the active config', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(SAMPLE_CONFIG)

      const res = await app.fetch(new Request('http://localhost/config/smtp/active'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.configId).toBe('cfg-1')
    })

    it('returns null when no active config', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(null)

      const res = await app.fetch(new Request('http://localhost/config/smtp/active'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.data).toBeNull()
    })
  })

  // ==========================================================================
  // POST /config/smtp
  // ==========================================================================
  describe('POST /config/smtp', () => {
    const validPayload = {
      host: 'smtp.example.com',
      user: 'user@example.com',
      pass: 'secret',
      fromEmail: 'sender@example.com',
      port: 587,
    }

    it('creates a new SMTP config', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.createSMTPConfig).mockResolvedValue('cfg-new')

      const res = await app.fetch(jsonRequest('POST', '/config/smtp', validPayload))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.configId).toBe('cfg-new')
    })

    it('returns 400 for missing host', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp', {
          user: 'user@example.com',
          pass: 'secret',
          fromEmail: 'sender@example.com',
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 400 for missing username', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp', {
          host: 'smtp.example.com',
          pass: 'secret',
          fromEmail: 'sender@example.com',
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 400 for missing password', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp', {
          host: 'smtp.example.com',
          user: 'user@example.com',
          fromEmail: 'sender@example.com',
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 400 for missing from email', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp', {
          host: 'smtp.example.com',
          user: 'user@example.com',
          pass: 'secret',
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 500 when createSMTPConfig fails', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.createSMTPConfig).mockResolvedValue(null)

      const res = await app.fetch(jsonRequest('POST', '/config/smtp', validPayload))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // PUT /config/smtp/:configId
  // ==========================================================================
  describe('PUT /config/smtp/:configId', () => {
    it('updates an existing config', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.updateSMTPConfig).mockResolvedValue(true)

      const res = await app.fetch(jsonRequest('PUT', '/config/smtp/cfg-1', { host: 'new-host.example.com' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('updated')
    })

    it('returns 404 when config not found', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.updateSMTPConfig).mockResolvedValue(false)

      const res = await app.fetch(jsonRequest('PUT', '/config/smtp/nonexistent', { host: 'x.com' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })

    it('returns 400 when no valid fields are provided', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('PUT', '/config/smtp/cfg-1', { invalidField: 'value' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('No valid fields')
    })
  })

  // ==========================================================================
  // DELETE /config/smtp/:configId
  // ==========================================================================
  describe('DELETE /config/smtp/:configId', () => {
    it('deletes an existing config', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.deleteSMTPConfig).mockResolvedValue(true)

      const res = await app.fetch(new Request('http://localhost/config/smtp/cfg-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('deleted')
    })

    it('returns 404 when config not found', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.deleteSMTPConfig).mockResolvedValue(false)

      const res = await app.fetch(new Request('http://localhost/config/smtp/nonexistent', { method: 'DELETE' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // POST /config/smtp/test
  // ==========================================================================
  describe('POST /config/smtp/test', () => {
    it('returns valid: true when connection succeeds', async () => {
      const app = createApp()
      vi.mocked(emailService.testConnection).mockResolvedValue(true)

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp/test', {
          host: 'smtp.example.com',
          port: 587,
          user: 'u',
          pass: 'p',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.valid).toBe(true)
      expect(body.message).toContain('successful')
    })

    it('returns valid: false when connection fails', async () => {
      const app = createApp()
      vi.mocked(emailService.testConnection).mockResolvedValue(false)

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp/test', {
          host: 'smtp.bad.com',
          user: 'u',
          pass: 'p',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.valid).toBe(false)
      expect(body.message).toContain('failed')
    })

    it('returns 500 on exception', async () => {
      const app = createApp()
      vi.mocked(emailService.testConnection).mockRejectedValue(new Error('timeout'))

      const res = await app.fetch(
        jsonRequest('POST', '/config/smtp/test', {
          host: 'smtp.example.com',
          user: 'u',
          pass: 'p',
        })
      )

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // POST /config/smtp/:configId/default
  // ==========================================================================
  describe('POST /config/smtp/:configId/default', () => {
    it('sets a config as default', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.updateSMTPConfig).mockResolvedValue(true)

      const res = await app.fetch(new Request('http://localhost/config/smtp/cfg-1/default', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('Default')
    })

    it('returns 404 when config not found', async () => {
      const app = createApp()
      vi.mocked(d1UserDatabase.updateSMTPConfig).mockResolvedValue(false)

      const res = await app.fetch(new Request('http://localhost/config/smtp/nonexistent/default', { method: 'POST' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })
})
