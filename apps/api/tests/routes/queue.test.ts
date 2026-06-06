import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock queueEngine before importing routes
vi.mock('../../src/services/queueEngine', () => ({
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

import { queueEngine } from '../../src/services/queueEngine'
import queueRoutes from '../../src/routes/queue'

const TEST_USER_ID = 'user-1'

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('userId', TEST_USER_ID)
    ;(c as any).user = { id: TEST_USER_ID, email: 'test@test.com', name: 'Test User' }
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', queueRoutes)
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

const SAMPLE_JOB = {
  id: 'job-1',
  campaign_id: 'camp-1',
  type: 'bulk',
  status: 'running',
  priority: 5,
  subject: 'Test Subject',
  from_email: 'sender@example.com',
  config_name: 'My SMTP',
  total_count: 100,
  sent_count: 50,
  failed_count: 2,
  last_processed_index: 52,
  batch_size: 20,
  scheduled_at: null,
  created_at: '2025-01-01T00:00:00Z',
  started_at: '2025-01-01T00:01:00Z',
  completed_at: null,
  last_error: null,
  contacts_json: '[]',
  config_json: '{}',
}

const SAMPLE_STATS = {
  pending: 2,
  running: 1,
  paused: 0,
  completed: 10,
  failed: 1,
  cancelled: 0,
  total_sent: 500,
  total_failed: 5,
  dead_letters: 3,
}

describe('Queue Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /queue/jobs
  // ==========================================================================
  describe('GET /queue/jobs', () => {
    it('returns a list of jobs for the user', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockReturnValue([SAMPLE_JOB] as any)

      const res = await app.fetch(new Request('http://localhost/queue/jobs'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe('job-1')
      expect(body.data[0].progress).toBe(52) // Math.round((52/100)*100)
      // Should not include large JSON fields
      expect(body.data[0].contacts_json).toBeUndefined()
      expect(body.data[0].config_json).toBeUndefined()
    })

    it('passes status filter to queueEngine', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockReturnValue([])

      await app.fetch(new Request('http://localhost/queue/jobs?status=pending'))

      expect(queueEngine.getJobs).toHaveBeenCalledWith(TEST_USER_ID, 'pending', 20, 0)
    })

    it('passes limit and offset query params', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockReturnValue([])

      await app.fetch(new Request('http://localhost/queue/jobs?limit=10&offset=5'))

      expect(queueEngine.getJobs).toHaveBeenCalledWith(TEST_USER_ID, undefined, 10, 5)
    })

    it('returns empty array when no jobs exist', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockReturnValue([])

      const res = await app.fetch(new Request('http://localhost/queue/jobs'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })
  })

  // ==========================================================================
  // GET /queue/jobs/:id
  // ==========================================================================
  describe('GET /queue/jobs/:id', () => {
    it('returns a specific job', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJob).mockReturnValue(SAMPLE_JOB as any)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('job-1')
      expect(body.data.progress).toBe(52)
      // Should not include raw contacts/config JSON
      expect(body.data.contacts_json).toBeUndefined()
      expect(body.data.config_json).toBeUndefined()
    })

    it('returns 404 when job not found', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJob).mockReturnValue(undefined as any)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/nonexistent'))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // POST /queue/jobs/:id/pause
  // ==========================================================================
  describe('POST /queue/jobs/:id/pause', () => {
    it('pauses a running job', async () => {
      const app = createApp()
      vi.mocked(queueEngine.pause).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1/pause', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('paused')
    })

    it('returns 400 when job is not running', async () => {
      const app = createApp()
      vi.mocked(queueEngine.pause).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1/pause', { method: 'POST' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not running')
    })
  })

  // ==========================================================================
  // POST /queue/jobs/:id/resume
  // ==========================================================================
  describe('POST /queue/jobs/:id/resume', () => {
    it('resumes a paused job', async () => {
      const app = createApp()
      vi.mocked(queueEngine.resume).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1/resume', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('resumed')
    })

    it('returns 400 when job is not paused', async () => {
      const app = createApp()
      vi.mocked(queueEngine.resume).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1/resume', { method: 'POST' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not paused')
    })
  })

  // ==========================================================================
  // DELETE /queue/jobs/:id
  // ==========================================================================
  describe('DELETE /queue/jobs/:id', () => {
    it('cancels a job', async () => {
      const app = createApp()
      vi.mocked(queueEngine.cancel).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('cancelled')
    })

    it('returns 400 when job cannot be cancelled', async () => {
      const app = createApp()
      vi.mocked(queueEngine.cancel).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/queue/jobs/job-1', { method: 'DELETE' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('cannot be cancelled')
    })
  })

  // ==========================================================================
  // GET /queue/stats
  // ==========================================================================
  describe('GET /queue/stats', () => {
    it('returns queue statistics', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getStats).mockReturnValue(SAMPLE_STATS)

      const res = await app.fetch(new Request('http://localhost/queue/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.pending).toBe(2)
      expect(body.data.running).toBe(1)
      expect(body.data.total_sent).toBe(500)
    })
  })

  // ==========================================================================
  // GET /queue/dead-letters
  // ==========================================================================
  describe('GET /queue/dead-letters', () => {
    it('returns dead letters', async () => {
      const app = createApp()
      const deadLetters = [{ id: 'dl-1', job_id: 'job-1', email: 'bad@test.com', error: 'bounced' }]
      vi.mocked(queueEngine.getDeadLetters).mockReturnValue(deadLetters)

      const res = await app.fetch(new Request('http://localhost/queue/dead-letters'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('passes job_id filter', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getDeadLetters).mockReturnValue([])

      await app.fetch(new Request('http://localhost/queue/dead-letters?job_id=job-1&limit=10'))

      expect(queueEngine.getDeadLetters).toHaveBeenCalledWith('job-1', 10, 0)
    })
  })

  // ==========================================================================
  // GET /queue/suppression
  // ==========================================================================
  describe('GET /queue/suppression', () => {
    it('returns suppression list', async () => {
      const app = createApp()
      const list = [{ email: 'spam@test.com', reason: 'bounce', source: 'auto' }]
      vi.mocked(queueEngine.getSuppressionList).mockReturnValue(list)

      const res = await app.fetch(new Request('http://localhost/queue/suppression'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })
  })

  // ==========================================================================
  // POST /queue/suppression
  // ==========================================================================
  describe('POST /queue/suppression', () => {
    it('adds an email to the suppression list', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/queue/suppression', {
          email: 'bad@test.com',
          reason: 'bounce',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('bad@test.com')
      expect(queueEngine.suppress).toHaveBeenCalledWith(TEST_USER_ID, 'bad@test.com', 'bounce', 'manual')
    })

    it('returns 400 when email is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/queue/suppression', { reason: 'bounce' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('required')
    })

    it('returns 400 when reason is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/queue/suppression', { email: 'bad@test.com' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('required')
    })
  })

  // ==========================================================================
  // DELETE /queue/suppression/:email
  // ==========================================================================
  describe('DELETE /queue/suppression/:email', () => {
    it('removes an email from the suppression list', async () => {
      const app = createApp()
      vi.mocked(queueEngine.unsuppress).mockReturnValue(true)

      const res = await app.fetch(
        new Request('http://localhost/queue/suppression/bad@test.com', {
          method: 'DELETE',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('removed')
    })

    it('returns 404 when email not in suppression list', async () => {
      const app = createApp()
      vi.mocked(queueEngine.unsuppress).mockReturnValue(false)

      const res = await app.fetch(
        new Request('http://localhost/queue/suppression/unknown@test.com', {
          method: 'DELETE',
        })
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })
})
