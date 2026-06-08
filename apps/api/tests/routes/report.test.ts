import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/d1Service', () => ({
  d1Service: {
    isConfigured: vi.fn(),
    getLogs: vi.fn(),
    getStats: vi.fn(),
    deleteLog: vi.fn(),
    deleteLogs: vi.fn(),
  },
}))

vi.mock('../../src/services/logService', () => ({
  logService: {
    getLogs: vi.fn(),
    getStats: vi.fn(),
    deleteLog: vi.fn(),
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

import { d1Service } from '../../src/services/d1Service'
import { logService } from '../../src/services/logService'
import reportRoutes from '../../src/routes/report'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', reportRoutes)
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

const SAMPLE_LOG = {
  id: 'log-1',
  email: 'alice@example.com',
  timestamp: '2025-01-01T00:00:00Z',
  recipient_email: 'alice@example.com',
  recipient_name: 'Alice',
  subject: 'Hello',
  status: 'sent',
  send_type: 'bulk',
  provider_type: 'smtp',
  config_name: 'My Config',
  sent_at: '2025-01-01T00:00:00Z',
  opened_at: null,
  open_count: 0,
  click_count: 0,
}

const SAMPLE_STATS = { sent: 100, failed: 5, total: 105, errors: 0 }

describe('Report Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /report/logs
  // ==========================================================================
  describe('GET /report/logs', () => {
    it('returns logs from Worker API when configured', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.getLogs).mockResolvedValue({
        logs: [SAMPLE_LOG],
        stats: SAMPLE_STATS,
        pagination: { page: 1, limit: 50, total: 1 },
      })

      const res = await app.fetch(new Request('http://localhost/report/logs'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.logs).toHaveLength(1)
      expect(body.data.stats).toEqual(SAMPLE_STATS)
    })

    it('falls back to local logs when Worker API is not configured', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)
      vi.mocked(logService.getLogs).mockResolvedValue([SAMPLE_LOG])
      vi.mocked(logService.getStats).mockResolvedValue(SAMPLE_STATS)

      const res = await app.fetch(new Request('http://localhost/report/logs'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.logs).toHaveLength(1)
      expect(body.data.stats).toEqual(SAMPLE_STATS)
    })

    it('falls back to local when Worker API throws', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.getLogs).mockRejectedValue(new Error('network error'))
      vi.mocked(logService.getLogs).mockResolvedValue([])
      vi.mocked(logService.getStats).mockResolvedValue({ sent: 0, failed: 0, total: 0, errors: 0 })

      const res = await app.fetch(new Request('http://localhost/report/logs'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('passes filter query params to the service', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.getLogs).mockResolvedValue({
        logs: [],
        stats: { sent: 0, failed: 0, total: 0 },
        pagination: { page: 1, limit: 50, total: 0 },
      })

      await app.fetch(new Request('http://localhost/report/logs?status=sent&search=alice&page=2&limit=25'))

      expect(d1Service.getLogs).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          status: 'sent',
          search: 'alice',
          page: 2,
          limit: 25,
        })
      )
    })
  })

  // ==========================================================================
  // GET /report/stats
  // ==========================================================================
  describe('GET /report/stats', () => {
    it('returns stats from Worker API', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.getStats).mockResolvedValue(SAMPLE_STATS)

      const res = await app.fetch(new Request('http://localhost/report/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual(SAMPLE_STATS)
    })

    it('falls back to local stats', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)
      vi.mocked(logService.getStats).mockResolvedValue(SAMPLE_STATS)

      const res = await app.fetch(new Request('http://localhost/report/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual(SAMPLE_STATS)
    })
  })

  // ==========================================================================
  // GET /report/export/csv
  // ==========================================================================
  describe('GET /report/export/csv', () => {
    it('returns a CSV file with correct headers', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)
      vi.mocked(logService.getLogs).mockResolvedValue([SAMPLE_LOG])

      const res = await app.fetch(new Request('http://localhost/report/export/csv'))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/csv')
      expect(res.headers.get('content-disposition')).toContain('attachment')
      expect(res.headers.get('content-disposition')).toContain('.csv')

      const text = await res.text()
      expect(text).toContain('ID,Email,Name,Subject,Status')
      expect(text).toContain('alice@example.com')
    })

    it('uses Worker API for export when configured', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.getLogs).mockResolvedValue({
        logs: [SAMPLE_LOG],
        stats: SAMPLE_STATS,
        pagination: { page: 1, limit: 10000, total: 1 },
      })

      const res = await app.fetch(new Request('http://localhost/report/export/csv'))

      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain('alice@example.com')
    })
  })

  // ==========================================================================
  // GET /report/export/json
  // ==========================================================================
  describe('GET /report/export/json', () => {
    it('returns a JSON file download', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)
      vi.mocked(logService.getLogs).mockResolvedValue([SAMPLE_LOG])

      const res = await app.fetch(new Request('http://localhost/report/export/json'))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('content-disposition')).toContain('.json')

      const text = await res.text()
      const parsed = JSON.parse(text)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].recipient_email).toBe('alice@example.com')
    })
  })

  // ==========================================================================
  // DELETE /report/logs/:id
  // ==========================================================================
  describe('DELETE /report/logs/:id', () => {
    it('deletes a log via Worker API', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.deleteLog).mockResolvedValue(true)

      const res = await app.fetch(new Request('http://localhost/report/logs/log-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('deleted')
    })

    it('deletes a log via local fallback', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/report/logs/log-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(logService.deleteLog).toHaveBeenCalledWith('org-1', 'log-1')
    })

    it('returns 500 when Worker API delete fails', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.deleteLog).mockRejectedValue(new Error('fail'))

      const res = await app.fetch(new Request('http://localhost/report/logs/log-1', { method: 'DELETE' }))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // POST /report/logs/delete-bulk
  // ==========================================================================
  describe('POST /report/logs/delete-bulk', () => {
    it('bulk deletes logs via Worker API', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(true)
      vi.mocked(d1Service.deleteLogs).mockResolvedValue(undefined)

      const res = await app.fetch(
        jsonRequest('POST', '/report/logs/delete-bulk', {
          ids: ['log-1', 'log-2'],
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.deleted).toBe(2)
    })

    it('bulk deletes via local fallback', async () => {
      const app = createApp()
      vi.mocked(d1Service.isConfigured).mockReturnValue(false)

      const res = await app.fetch(
        jsonRequest('POST', '/report/logs/delete-bulk', {
          ids: ['log-1', 'log-2'],
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.deleted).toBe(2)
      expect(logService.deleteLog).toHaveBeenCalledTimes(2)
    })

    it('returns 400 when ids are missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/report/logs/delete-bulk', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when ids is empty array', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/report/logs/delete-bulk', { ids: [] }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })
})
