/**
 * Dashboard Routes
 * Stats, polling status, and real-time data
 */
import { Hono } from 'hono'
import { requireAuth, getOrgId } from '../middleware/auth'
import { logService } from '../services/logService'
import { queueEngine } from '../services/queueEngine'
import type { QueueJob } from '../services/queueEngine'
import { success, error } from '../utils/response'
import { logger } from '../utils/logger'

// ============================================================================
// Types
// ============================================================================

interface SchedulerServiceLike {
  getScheduledJobs(): Promise<Array<{ status: string | null; [key: string]: unknown }>>
}

// Lazy-loaded services
let schedulerService: SchedulerServiceLike | null = null

function getSchedulerService(): SchedulerServiceLike | null {
  if (!schedulerService) {
    try {
      schedulerService = require('../services/schedulerService').schedulerService
    } catch {
      return null
    }
  }
  return schedulerService
}

const dashboardRoutes = new Hono()
  /**
   * Get dashboard stats
   * GET /dashboard/stats
   */
  .get('/dashboard/stats', async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)

    try {
      const scheduler = getSchedulerService()
      const scheduledJobs = (await scheduler?.getScheduledJobs()) ?? []
      const allLogs = (await logService.getLogs(orgId)) ?? []

      // Queue stats from persistent engine
      const queueStats = await queueEngine.getStats(user.id)
      const activeJobs = await queueEngine.getJobs(user.id, 'running', 10)
      const pendingJobs = await queueEngine.getJobs(user.id, 'pending', 10)
      const recentJobs = await queueEngine.getJobs(user.id, undefined, 5)
      const logStats = await logService.getStats(orgId)

      return success(c, {
        stats: logStats,
        queue: {
          stats: queueStats,
          activeJobs: activeJobs.map(formatJobSummary),
          pendingJobs: pendingJobs.map(formatJobSummary),
          recentJobs: recentJobs.map(formatJobSummary),
        },
        scheduledJobs,
        recentLogs: allLogs.slice(0, 10),
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('Dashboard stats error:', err)
      return success(c, {
        stats: { sent: 0, failed: 0, total: 0 },
        queue: {
          stats: {
            pending: 0,
            running: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total_sent: 0,
            total_failed: 0,
            dead_letters: 0,
          },
          activeJobs: [],
          pendingJobs: [],
          recentJobs: [],
        },
        scheduledJobs: [],
        recentLogs: [],
        timestamp: new Date().toISOString(),
      })
    }
  })
  /**
   * Get polling status (lightweight)
   * GET /dashboard/poll-status
   */
  .get('/dashboard/poll-status', async (c) => {
    const user = requireAuth(c)

    try {
      const scheduler = getSchedulerService()
      const scheduledJobs = (await scheduler?.getScheduledJobs()) ?? []

      const queueStats = await queueEngine.getStats(user.id)
      const hasActiveJobs = queueStats.running > 0
      const hasPendingJobs = queueStats.pending > 0
      const hasScheduledJobs = scheduledJobs.length > 0
      const hasRunningScheduledJobs = scheduledJobs.some((j) => j.status === 'running')

      // Determine polling interval
      let pollNeeded = false
      let pollInterval = 30000

      if (hasActiveJobs) {
        pollNeeded = true
        pollInterval = 3000 // Fast: 3s for active jobs
      } else if (hasPendingJobs) {
        pollNeeded = true
        pollInterval = 5000 // 5s for pending
      } else if (hasRunningScheduledJobs) {
        pollNeeded = true
        pollInterval = 10000
      } else if (hasScheduledJobs) {
        pollNeeded = true
        pollInterval = 30000
      }

      return success(c, {
        pollNeeded,
        pollInterval,
        hasActiveJobs,
        hasPendingJobs,
        hasScheduledJobs,
        hasRunningScheduledJobs,
        activeJobCount: queueStats.running,
        pendingJobCount: queueStats.pending,
        pausedJobCount: queueStats.paused,
        scheduledJobCount: scheduledJobs.length,
        lastUpdated: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('Poll status error:', err)
      return success(c, {
        pollNeeded: false,
        pollInterval: 30000,
        hasActiveJobs: false,
        hasPendingJobs: false,
        hasScheduledJobs: false,
        hasRunningScheduledJobs: false,
        activeJobCount: 0,
        pendingJobCount: 0,
        pausedJobCount: 0,
        scheduledJobCount: 0,
        lastUpdated: new Date().toISOString(),
      })
    }
  })
  /**
   * Get dashboard data (optimized)
   * GET /dashboard/data
   */
  .get('/dashboard/data', async (c) => {
    const user = requireAuth(c)

    try {
      const scheduler = getSchedulerService()
      const scheduledJobs = ((await scheduler?.getScheduledJobs()) ?? [])
        .filter((j) => j.status === 'scheduled' || j.status === 'running')
        .slice(0, 5)

      const activeJobs = await queueEngine.getJobs(user.id, 'running', 5)
      const pendingJobs = await queueEngine.getJobs(user.id, 'pending', 5)

      return success(c, {
        queue: {
          activeJobs: activeJobs.map(formatJobSummary),
          pendingJobs: pendingJobs.map(formatJobSummary),
        },
        scheduledJobs,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('Dashboard data error:', err)
      return error(c, 'Failed to fetch dashboard data', 500)
    }
  })

/**
 * Format job for dashboard display (strip large fields)
 */
function formatJobSummary(job: QueueJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    subject: job.subject,
    from_email: job.from_email,
    config_name: job.config_name,
    total_count: job.total_count,
    sent_count: job.sent_count,
    failed_count: job.failed_count,
    last_processed_index: job.last_processed_index,
    progress: job.total_count > 0 ? Math.round((job.last_processed_index / job.total_count) * 100) : 0,
    created_at: job.created_at,
    started_at: job.started_at,
    last_error: job.last_error,
  }
}

export default dashboardRoutes
export type DashboardRoutes = typeof dashboardRoutes
