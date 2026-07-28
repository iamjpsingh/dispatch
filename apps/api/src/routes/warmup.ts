// src/routes/warmup.ts - Email Warmup Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { warmupService } from '../services/warmupService'
import { auditFromContext } from '../services/audit/context'

// ============================================================================
// Schemas
// ============================================================================

const CreateWarmupSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
  config_name: z.string().optional(),
  schedule_type: z.enum(['conservative', 'moderate', 'aggressive', 'custom'], {
    errorMap: () => ({ message: 'Valid schedule_type required: conservative, moderate, aggressive, or custom' }),
  }),
  starting_volume: z.number().optional(),
  target_volume: z.number().optional(),
  custom_schedule: z.array(z.object({
    day: z.number(),
    volume: z.number(),
  })).optional(),
})

const warmupRoutes = new Hono()
  // List warmup plans
  .get('/warmup', async (c) => {
    const user = requireAuth(c)
    const status = c.req.query('status')
    const plans = await warmupService.list(user.id, status || undefined)
    return success(c, { plans })
  })
  // Get warmup plan
  .get('/warmup/:id', async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')
    const plan = await warmupService.get(user.id, planId)

    if (!plan) return error(c, 'Warmup plan not found', 404)
    return success(c, plan)
  })
  // Get warmup progress with schedule and logs
  .get('/warmup/:id/progress', async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')
    const progress = await warmupService.getProgress(user.id, planId)

    if (!progress) return error(c, 'Warmup plan not found', 404)
    return success(c, progress)
  })
  // Create warmup plan
  .post('/warmup', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', CreateWarmupSchema), async (c) => {
    const user = requireAuth(c)
    const body = c.req.valid('json')

    const plan = await warmupService.create(user.id, {
      config_id: body.config_id,
      config_name: body.config_name || '',
      schedule_type: body.schedule_type,
      starting_volume: body.starting_volume,
      target_volume: body.target_volume,
      custom_schedule: body.custom_schedule,
    })

    auditFromContext(c, { action: 'warmup.created', entityType: 'warmup', entityId: plan.id })
    return success(c, plan, 'Warmup plan created', 201)
  })
  // Pause warmup
  .post('/warmup/:id/pause', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')

    if (!(await warmupService.pause(user.id, planId))) {
      return error(c, 'Cannot pause plan (not active or not found)', 404)
    }

    auditFromContext(c, { action: 'warmup.paused', entityType: 'warmup', entityId: planId })
    return success(c, null, 'Warmup plan paused')
  })
  // Resume warmup
  .post('/warmup/:id/resume', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')

    if (!(await warmupService.resume(user.id, planId))) {
      return error(c, 'Cannot resume plan (not paused or not found)', 404)
    }

    auditFromContext(c, { action: 'warmup.resumed', entityType: 'warmup', entityId: planId })
    return success(c, null, 'Warmup plan resumed')
  })
  // Cancel warmup
  .post('/warmup/:id/cancel', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')

    if (!(await warmupService.cancel(user.id, planId))) {
      return error(c, 'Cannot cancel plan', 404)
    }

    auditFromContext(c, { action: 'warmup.cancelled', entityType: 'warmup', entityId: planId })
    return success(c, null, 'Warmup plan cancelled')
  })
  // Delete warmup (only completed/cancelled)
  .delete('/warmup/:id', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    const user = requireAuth(c)
    const planId = c.req.param('id')

    if (!(await warmupService.delete(user.id, planId))) {
      return error(c, 'Cannot delete active warmup plan', 400)
    }

    auditFromContext(c, { action: 'warmup.deleted', entityType: 'warmup', entityId: planId })
    return success(c, null, 'Warmup plan deleted')
  })
  // Check warmup status for a config
  .get('/warmup/config/:configId', async (c) => {
    const user = requireAuth(c)
    const configId = c.req.param('configId')

    const plan = await warmupService.getActivePlanForConfig(user.id, configId)
    const sendStatus = await warmupService.canSendMore(user.id, configId)

    return success(c, {
      hasWarmup: !!plan,
      plan,
      canSend: sendStatus.allowed,
      remaining: sendStatus.remaining,
      dailyLimit: sendStatus.limit,
    })
  })

export default warmupRoutes
export type WarmupRoutes = typeof warmupRoutes
