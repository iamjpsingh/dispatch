// src/routes/segments.ts - Segmentation API

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { segmentService } from '../services/segmentService'
import { success, error } from '../utils/response'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const CreateSegmentSchema = z.object({
  name: z.string().min(1, 'Segment name is required').max(200),
  type: z.enum(['static', 'dynamic']).optional(),
  rules_json: z.string().optional(),
  description: z.string().max(1000).optional(),
})

const ContactIdsSchema = z.object({
  contact_ids: z.array(z.string()).min(1, 'contact_ids array is required'),
})

const app = new Hono()

// ============================================================================
// Segment CRUD
// ============================================================================

app.get('/segments', requirePermission(PERMISSIONS.SEGMENTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const segments = segmentService.list(orgId)
  return success(c, { segments })
})

app.post('/segments', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateSegmentSchema)

  const segment = segmentService.create(orgId, user.id, body)
  return success(c, segment, 'Segment created', 201)
})

app.get('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')

  const segment = segmentService.get(orgId, segmentId)
  if (!segment) return error(c, 'Segment not found', 404)

  return success(c, segment)
})

app.put('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')
  const body = await validateBody(c, CreateSegmentSchema.partial())

  const updated = segmentService.update(orgId, segmentId, body)
  if (!updated) return error(c, 'Segment not found', 404)

  return success(c, undefined, 'Segment updated')
})

app.delete('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')

  const deleted = segmentService.delete(orgId, segmentId)
  if (!deleted) return error(c, 'Segment not found', 404)

  return success(c, undefined, 'Segment deleted')
})

// ============================================================================
// Static Segment Members
// ============================================================================

app.post('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')
  const { contact_ids } = await validateBody(c, ContactIdsSchema)

  const segment = segmentService.get(orgId, segmentId)
  if (!segment) return error(c, 'Segment not found', 404)
  if (segment.type !== 'static') return error(c, 'Can only add contacts to static segments', 400)

  const added = segmentService.addContacts(segmentId, contact_ids)
  return success(c, { added }, `${added} contact(s) added to segment`)
})

app.delete('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')
  const { contact_ids } = await validateBody(c, ContactIdsSchema)

  const segment = segmentService.get(orgId, segmentId)
  if (!segment) return error(c, 'Segment not found', 404)

  const removed = segmentService.removeContacts(segmentId, contact_ids)
  return success(c, { removed }, `${removed} contact(s) removed from segment`)
})

app.get('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '100')
  const offset = parseInt(c.req.query('offset') || '0')

  const segment = segmentService.get(orgId, segmentId)
  if (!segment) return error(c, 'Segment not found', 404)

  const contactIds = segmentService.getStaticMembers(segmentId, limit, offset)
  return success(c, { contact_ids: contactIds, total: segment.contact_count })
})

// ============================================================================
// Dynamic Segment Query
// ============================================================================

app.post('/segments/:id/preview', requirePermission(PERMISSIONS.SEGMENTS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const segmentId = c.req.param('id')

  const segment = segmentService.get(orgId, segmentId)
  if (!segment) return error(c, 'Segment not found', 404)

  if (segment.type !== 'dynamic' || !segment.rules_json) {
    return error(c, 'Not a dynamic segment or no rules defined', 400)
  }

  const rules = JSON.parse(segment.rules_json)
  const query = segmentService.buildQuery(rules)

  return success(c, {
    sql_preview: query.sql,
    param_count: query.params.length,
    contact_count: segment.contact_count,
  })
})

export default app
