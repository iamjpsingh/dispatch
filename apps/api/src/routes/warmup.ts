// src/routes/warmup.ts - Email Warmup Endpoints

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { success, error } from '../utils/response'
import { warmupService } from '../services/warmupService'
import { validateBody } from '../utils/validate'

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

const app = new Hono()

// List warmup plans
app.get('/warmup', async (c) => {
  const user = requireAuth(c)
  const status = c.req.query('status')
  const plans = await warmupService.list(user.id, status || undefined)
  return success(c, { plans })
})

// Get warmup plan
app.get('/warmup/:id', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')
  const plan = await warmupService.get(user.id, planId)

  if (!plan) return error(c, 'Warmup plan not found', 404)
  return success(c, plan)
})

// Get warmup progress with schedule and logs
app.get('/warmup/:id/progress', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')
  const progress = await warmupService.getProgress(user.id, planId)

  if (!progress) return error(c, 'Warmup plan not found', 404)
  return success(c, progress)
})

// Create warmup plan
app.post('/warmup', async (c) => {
  const user = requireAuth(c)
  const body = await validateBody(c, CreateWarmupSchema)

  const plan = await warmupService.create(user.id, {
    config_id: body.config_id,
    config_name: body.config_name || '',
    schedule_type: body.schedule_type,
    starting_volume: body.starting_volume,
    target_volume: body.target_volume,
    custom_schedule: body.custom_schedule,
  })

  return success(c, plan, 'Warmup plan created', 201)
})

// Pause warmup
app.post('/warmup/:id/pause', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')

  if (!(await warmupService.pause(user.id, planId))) {
    return error(c, 'Cannot pause plan (not active or not found)', 404)
  }

  return success(c, null, 'Warmup plan paused')
})

// Resume warmup
app.post('/warmup/:id/resume', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')

  if (!(await warmupService.resume(user.id, planId))) {
    return error(c, 'Cannot resume plan (not paused or not found)', 404)
  }

  return success(c, null, 'Warmup plan resumed')
})

// Cancel warmup
app.post('/warmup/:id/cancel', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')

  if (!(await warmupService.cancel(user.id, planId))) {
    return error(c, 'Cannot cancel plan', 404)
  }

  return success(c, null, 'Warmup plan cancelled')
})

// Delete warmup (only completed/cancelled)
app.delete('/warmup/:id', async (c) => {
  const user = requireAuth(c)
  const planId = c.req.param('id')

  if (!(await warmupService.delete(user.id, planId))) {
    return error(c, 'Cannot delete active warmup plan', 400)
  }

  return success(c, null, 'Warmup plan deleted')
})

// Check warmup status for a config
app.get('/warmup/config/:configId', async (c) => {
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

export default app
