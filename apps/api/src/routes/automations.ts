// src/routes/automations.ts - Automation Management API

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { automationService } from '../services/automationService'
import { success, error } from '../utils/response'

// ============================================================================
// Schemas
// ============================================================================

const CreateAutomationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  trigger_type: z.string().min(1, 'trigger_type is required'),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(z.object({
    type: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    delay_minutes: z.number().optional(),
  })).optional(),
})

const EnrollSchema = z.object({
  contact_id: z.string().min(1, 'contact_id is required'),
})

const GoalSchema = z.object({
  field: z.string().min(1),
  operator: z.string().min(1),
  value: z.string(),
})

const automationsRoutes = new Hono()
  // ==========================================================================
  // Automation CRUD
  // ==========================================================================
  .get('/automations', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const automations = await automationService.list(orgId)
    return success(c, { automations })
  })
  .post('/automations', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), zValidator('json', CreateAutomationSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    const automation = await automationService.create(orgId, user.id, body)
    return success(c, automation, 'Automation created', 201)
  })
  .get('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    const steps = await automationService.getSteps(automationId)
    return success(c, { ...automation, steps })
  })
  .put('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), zValidator('json', CreateAutomationSchema.partial()), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await automationService.update(orgId, automationId, body)
    if (!updated) return error(c, 'Automation not found or cannot be edited while active', 404)

    return success(c, undefined, 'Automation updated')
  })
  .delete('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const deleted = await automationService.delete(orgId, automationId)
    if (!deleted) return error(c, 'Automation not found or is currently active', 404)

    return success(c, undefined, 'Automation deleted')
  })
  // ==========================================================================
  // Automation Lifecycle
  // ==========================================================================
  .post('/automations/:id/activate', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const activated = await automationService.activate(orgId, automationId)
    if (!activated) return error(c, 'Automation not found or cannot be activated', 404)

    return success(c, undefined, 'Automation activated')
  })
  .post('/automations/:id/pause', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const paused = await automationService.pause(orgId, automationId)
    if (!paused) return error(c, 'Automation not found or not active', 404)

    return success(c, undefined, 'Automation paused')
  })
  .post('/automations/:id/deactivate', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const deactivated = await automationService.deactivate(orgId, automationId)
    if (!deactivated) return error(c, 'Automation not found', 404)

    return success(c, undefined, 'Automation deactivated')
  })
  // ==========================================================================
  // Enrollments
  // ==========================================================================
  .get('/automations/:id/enrollments', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    const enrollments = await automationService.getEnrollments(automationId, limit, offset)
    return success(c, { enrollments })
  })
  .post('/automations/:id/enroll', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), zValidator('json', EnrollSchema), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')
    const { contact_id } = c.req.valid('json')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    const enrolled = await automationService.enrollContact(automationId, contact_id)
    if (!enrolled) return error(c, 'Could not enroll contact (already enrolled or no steps)', 400)

    return success(c, undefined, 'Contact enrolled')
  })
  .delete('/automations/:id/enrollments/:contactId', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')
    const contactId = c.req.param('contactId')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    const exited = await automationService.exitContact(automationId, contactId, 'manual')
    if (!exited) return error(c, 'Enrollment not found or not active', 404)

    return success(c, undefined, 'Contact removed from automation')
  })
  // ==========================================================================
  // Automation Stats
  // ==========================================================================
  .get('/automations/:id/stats', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    const stats = await automationService.getStats(automationId)
    return success(c, stats)
  })
  // ==========================================================================
  // Goal-Based Exit
  // ==========================================================================
  /** Set goal condition for an automation */
  .put('/automations/:id/goal', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), zValidator('json', GoalSchema), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')
    const body = c.req.valid('json')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    await automationService.update(orgId, automationId, { goal_condition: JSON.stringify(body) })
    return success(c, undefined, 'Goal condition set')
  })
  /** Remove goal condition */
  .delete('/automations/:id/goal', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const automationId = c.req.param('id')

    const automation = await automationService.get(orgId, automationId)
    if (!automation) return error(c, 'Automation not found', 404)

    await automationService.update(orgId, automationId, { goal_condition: null })
    return success(c, undefined, 'Goal condition removed')
  })

export default automationsRoutes
export type AutomationsRoutes = typeof automationsRoutes
