import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/logService', () => ({
  logService: {
    getLogs: vi.fn(),
    getStats: vi.fn(),
  },
}))

vi.mock('../../src/services/queueEngine', () => ({
  queueEngine: {
    getStats: vi.fn(),
    getJobs: vi.fn(),
  },
}))

vi.mock('../../src/services/schedulerService', () => ({
  schedulerService: {
    getScheduledJobs: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

import { logService } from '../../src/services/logService'
import { queueEngine } from '../../src/services/queueEngine'
import dashboardRoutes from '../../src/routes/dashboard'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', dashboardRoutes)
  return app
}

const SAMPLE_QUEUE_STATS = {
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

const SAMPLE_JOB = {
  id: 'job-1',
  type: 'bulk',
  status: 'running',
  subject: 'Test',
  from_email: 'sender@example.com',
  config_name: 'My Config',
  total_count: 100,
  sent_count: 50,
  failed_count: 2,
  last_processed_index: 52,
  created_at: '2025-01-01T00:00:00Z',
  started_at: '2025-01-01T00:01:00Z',
  last_error: null,
}

describe('Dashboard Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /dashboard/stats
  // ==========================================================================
  describe('GET /dashboard/stats', () => {
    it('returns dashboard statistics', async () => {
      const app = createApp()
      vi.mocked(logService.getLogs).mockReturnValue([])
      vi.mocked(logService.getStats).mockReturnValue({ sent: 100, failed: 5, total: 105 })
      vi.mocked(queueEngine.getStats).mockResolvedValue(SAMPLE_QUEUE_STATS)
      vi.mocked(queueEngine.getJobs).mockResolvedValue([])

      const res = await app.fetch(new Request('http://localhost/dashboard/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.stats).toEqual({ sent: 100, failed: 5, total: 105 })
      expect(body.data.queue.stats).toEqual(SAMPLE_QUEUE_STATS)
      expect(body.data.timestamp).toBeTruthy()
    })

    it('includes active and pending jobs', async () => {
      const app = createApp()
      vi.mocked(logService.getLogs).mockReturnValue([])
      vi.mocked(logService.getStats).mockReturnValue({ sent: 0, failed: 0, total: 0 })
      vi.mocked(queueEngine.getStats).mockResolvedValue(SAMPLE_QUEUE_STATS)
      vi.mocked(queueEngine.getJobs).mockImplementation((_userId: string, status?: string) => {
        if (status === 'running') return [SAMPLE_JOB] as any
        return []
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.queue.activeJobs).toHaveLength(1)
      expect(body.data.queue.activeJobs[0].id).toBe('job-1')
      expect(body.data.queue.activeJobs[0].progress).toBe(52)
    })

    it('returns fallback data on error', async () => {
      const app = createApp()
      vi.mocked(logService.getLogs).mockImplementation(() => {
        throw new Error('DB error')
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.stats).toEqual({ sent: 0, failed: 0, total: 0 })
      expect(body.data.queue.activeJobs).toEqual([])
    })
  })

  // ==========================================================================
  // GET /dashboard/poll-status
  // ==========================================================================
  describe('GET /dashboard/poll-status', () => {
    it('returns poll status with active jobs', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getStats).mockResolvedValue({
        ...SAMPLE_QUEUE_STATS,
        running: 2,
        pending: 1,
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/poll-status'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.pollNeeded).toBe(true)
      expect(body.data.pollInterval).toBe(3000) // Fast polling for active
      expect(body.data.hasActiveJobs).toBe(true)
      expect(body.data.activeJobCount).toBe(2)
    })

    it('returns slower polling for pending-only jobs', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getStats).mockResolvedValue({
        ...SAMPLE_QUEUE_STATS,
        running: 0,
        pending: 3,
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/poll-status'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.pollNeeded).toBe(true)
      expect(body.data.pollInterval).toBe(5000)
      expect(body.data.hasActiveJobs).toBe(false)
      expect(body.data.hasPendingJobs).toBe(true)
    })

    it('returns no-poll when idle', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getStats).mockResolvedValue({
        ...SAMPLE_QUEUE_STATS,
        running: 0,
        pending: 0,
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/poll-status'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.pollNeeded).toBe(false)
      expect(body.data.hasActiveJobs).toBe(false)
      expect(body.data.hasPendingJobs).toBe(false)
    })

    it('returns fallback data on error', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getStats).mockImplementation(() => {
        throw new Error('fail')
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/poll-status'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.pollNeeded).toBe(false)
      expect(body.data.activeJobCount).toBe(0)
    })
  })

  // ==========================================================================
  // GET /dashboard/data
  // ==========================================================================
  describe('GET /dashboard/data', () => {
    it('returns dashboard data with jobs', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockResolvedValue([SAMPLE_JOB] as any)

      const res = await app.fetch(new Request('http://localhost/dashboard/data'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.timestamp).toBeTruthy()
    })

    it('returns 500 on error', async () => {
      const app = createApp()
      vi.mocked(queueEngine.getJobs).mockImplementation(() => {
        throw new Error('fail')
      })

      const res = await app.fetch(new Request('http://localhost/dashboard/data'))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })
})
