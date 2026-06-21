// src/routes/queue.ts - Queue Management API Routes

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { queueEngine } from '../services/queueEngine'
import type { JobStatus } from '../services/queueEngine'
import { success, error } from '../utils/response'

const queueRoutes = new Hono()
  // ==========================================================================
  // Job Queue Management
  // ==========================================================================
  /**
   * GET /queue/jobs - List jobs for the authenticated user
   * Query params: status, limit, offset
   */
  .get('/queue/jobs', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const status = c.req.query('status') as JobStatus | undefined
    const limit = parseInt(c.req.query('limit') || '20')
    const offset = parseInt(c.req.query('offset') || '0')

    const jobs = await queueEngine.getJobs(user.id, status, limit, offset)

    // Strip large JSON fields from list view
    const jobSummaries = jobs.map((job) => ({
      id: job.id,
      campaign_id: job.campaign_id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      subject: job.subject,
      from_email: job.from_email,
      config_name: job.config_name,
      total_count: job.total_count,
      sent_count: job.sent_count,
      failed_count: job.failed_count,
      last_processed_index: job.last_processed_index,
      batch_size: job.batch_size,
      progress: job.total_count > 0 ? Math.round((job.last_processed_index / job.total_count) * 100) : 0,
      scheduled_at: job.scheduled_at,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      last_error: job.last_error,
    }))

    return success(c, jobSummaries)
  })
  /**
   * GET /queue/jobs/:id - Get a specific job
   */
  .get('/queue/jobs/:id', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const jobId = c.req.param('id')
    const job = await queueEngine.getJob(jobId, user.id)

    if (!job) {
      return error(c, 'Job not found', 404)
    }

    // Return job without raw contacts JSON (can be huge)
    const { contacts_json, config_json, ...jobData } = job

    return success(c, {
      ...jobData,
      progress: job.total_count > 0 ? Math.round((job.last_processed_index / job.total_count) * 100) : 0,
    })
  })
  /**
   * POST /queue/jobs/:id/pause - Pause a running job
   */
  .post('/queue/jobs/:id/pause', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const jobId = c.req.param('id')
    const paused = await queueEngine.pause(jobId, user.id)

    if (!paused) {
      return error(c, 'Job is not running or does not exist', 400)
    }

    return success(c, undefined, 'Job paused')
  })
  /**
   * POST /queue/jobs/:id/resume - Resume a paused job
   */
  .post('/queue/jobs/:id/resume', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const jobId = c.req.param('id')
    const resumed = await queueEngine.resume(jobId, user.id)

    if (!resumed) {
      return error(c, 'Job is not paused or does not exist', 400)
    }

    return success(c, undefined, 'Job resumed — will be picked up by worker')
  })
  /**
   * DELETE /queue/jobs/:id - Cancel a job
   */
  .delete('/queue/jobs/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const jobId = c.req.param('id')
    const cancelled = await queueEngine.cancel(jobId, user.id)

    if (!cancelled) {
      return error(c, 'Job cannot be cancelled (already completed or does not exist)', 400)
    }

    return success(c, undefined, 'Job cancelled')
  })
  // ==========================================================================
  // Queue Stats
  // ==========================================================================
  /**
   * GET /queue/stats - Get queue statistics for the authenticated user
   */
  .get('/queue/stats', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const stats = await queueEngine.getStats(user.id)
    return success(c, stats)
  })
  // ==========================================================================
  // Dead Letter Queue
  // ==========================================================================
  /**
   * GET /queue/dead-letters - List dead letters
   * Query params: job_id, limit, offset
   */
  .get('/queue/dead-letters', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const jobId = c.req.query('job_id')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    const deadLetters = await queueEngine.getDeadLetters(user.id, jobId || undefined, limit, offset)
    return success(c, deadLetters)
  })
  // ==========================================================================
  // Suppression List
  // ==========================================================================
  /**
   * GET /queue/suppression - Get suppression list
   */
  .get('/queue/suppression', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const user = requireAuth(c)
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    const list = await queueEngine.getSuppressionList(user.id, limit, offset)
    return success(c, list)
  })
  /**
   * POST /queue/suppression - Add email to suppression list
   */
  .post('/queue/suppression', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const body = await c.req.json()
    const { email, reason } = body

    if (!email || !reason) {
      return error(c, 'email and reason are required', 400)
    }

    await queueEngine.suppress(user.id, email, reason, 'manual')
    return success(c, undefined, `${email} added to suppression list`)
  })
  /**
   * DELETE /queue/suppression/:email - Remove email from suppression list
   */
  .delete('/queue/suppression/:email', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const user = requireAuth(c)
    const email = decodeURIComponent(c.req.param('email'))

    const removed = await queueEngine.unsuppress(user.id, email)
    if (!removed) {
      return error(c, 'Email not found in suppression list', 404)
    }

    return success(c, undefined, `${email} removed from suppression list`)
  })

export default queueRoutes
export type QueueRoutes = typeof queueRoutes
