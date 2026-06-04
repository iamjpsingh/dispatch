// src/routes/automations.ts - Automation Management API

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { automationService } from '../services/automationService'
import { success, error } from '../utils/response'
import { validateBody } from '../utils/validate'

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

const app = new Hono()

// ============================================================================
// Automation CRUD
// ============================================================================

app.get('/automations', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const automations = automationService.list(orgId)
  return success(c, { automations })
})

app.post('/automations', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateAutomationSchema)

  const automation = automationService.create(orgId, user.id, body)
  return success(c, automation, 'Automation created', 201)
})

app.get('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  const steps = automationService.getSteps(automationId)
  return success(c, { ...automation, steps })
})

app.put('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')
  const body = await validateBody(c, CreateAutomationSchema.partial())

  const updated = automationService.update(orgId, automationId, body)
  if (!updated) return error(c, 'Automation not found or cannot be edited while active', 404)

  return success(c, undefined, 'Automation updated')
})

app.delete('/automations/:id', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const deleted = automationService.delete(orgId, automationId)
  if (!deleted) return error(c, 'Automation not found or is currently active', 404)

  return success(c, undefined, 'Automation deleted')
})

// ============================================================================
// Automation Lifecycle
// ============================================================================

app.post('/automations/:id/activate', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const activated = automationService.activate(orgId, automationId)
  if (!activated) return error(c, 'Automation not found or cannot be activated', 404)

  return success(c, undefined, 'Automation activated')
})

app.post('/automations/:id/pause', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const paused = automationService.pause(orgId, automationId)
  if (!paused) return error(c, 'Automation not found or not active', 404)

  return success(c, undefined, 'Automation paused')
})

app.post('/automations/:id/deactivate', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const deactivated = automationService.deactivate(orgId, automationId)
  if (!deactivated) return error(c, 'Automation not found', 404)

  return success(c, undefined, 'Automation deactivated')
})

// ============================================================================
// Enrollments
// ============================================================================

app.get('/automations/:id/enrollments', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  const enrollments = automationService.getEnrollments(automationId, limit, offset)
  return success(c, { enrollments })
})

app.post('/automations/:id/enroll', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')
  const { contact_id } = await validateBody(c, EnrollSchema)

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  const enrolled = automationService.enrollContact(automationId, contact_id)
  if (!enrolled) return error(c, 'Could not enroll contact (already enrolled or no steps)', 400)

  return success(c, undefined, 'Contact enrolled')
})

app.delete('/automations/:id/enrollments/:contactId', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')
  const contactId = c.req.param('contactId')

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  const exited = automationService.exitContact(automationId, contactId, 'manual')
  if (!exited) return error(c, 'Enrollment not found or not active', 404)

  return success(c, undefined, 'Contact removed from automation')
})

// ============================================================================
// Automation Stats
// ============================================================================

app.get('/automations/:id/stats', requirePermission(PERMISSIONS.AUTOMATIONS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  const stats = automationService.getStats(automationId)
  return success(c, stats)
})

// ============================================================================
// Goal-Based Exit
// ============================================================================

const GoalSchema = z.object({
  field: z.string().min(1),
  operator: z.string().min(1),
  value: z.string(),
})

/** Set goal condition for an automation */
app.put('/automations/:id/goal', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')
  const body = await validateBody(c, GoalSchema)

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  automationService.update(orgId, automationId, { goal_condition: JSON.stringify(body) })
  return success(c, undefined, 'Goal condition set')
})

/** Remove goal condition */
app.delete('/automations/:id/goal', requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const automationId = c.req.param('id')

  const automation = automationService.get(orgId, automationId)
  if (!automation) return error(c, 'Automation not found', 404)

  automationService.update(orgId, automationId, { goal_condition: null })
  return success(c, undefined, 'Goal condition removed')
})

export default app
