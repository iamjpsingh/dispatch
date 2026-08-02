// src/routes/segments.ts - Segmentation API

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { segmentService } from '../services/segmentService'
import { success, error } from '../utils/response'
import { auditFromContext, activityFromContext } from '../services/audit/context'

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

const segmentsRoutes = new Hono()
  // ==========================================================================
  // Segment CRUD
  // ==========================================================================
  .get('/segments', requirePermission(PERMISSIONS.SEGMENTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const segments = await segmentService.list(orgId)
    return success(c, { segments })
  })
  .post('/segments', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), zValidator('json', CreateSegmentSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    const segment = await segmentService.create(orgId, user.id, body)
    auditFromContext(c, { action: 'segment.created', entityType: 'segment', entityId: segment.id })
    activityFromContext(c, { action: 'segment.created', entityType: 'segment', entityId: segment.id, description: `Created segment ${segment.id}` })
    return success(c, segment, 'Segment created', 201)
  })
  .get('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')

    const segment = await segmentService.get(orgId, segmentId)
    if (!segment) return error(c, 'Segment not found', 404)

    return success(c, segment)
  })
  .put('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), zValidator('json', CreateSegmentSchema.partial()), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await segmentService.update(orgId, segmentId, body)
    if (!updated) return error(c, 'Segment not found', 404)

    auditFromContext(c, { action: 'segment.updated', entityType: 'segment', entityId: segmentId })
    activityFromContext(c, { action: 'segment.updated', entityType: 'segment', entityId: segmentId, description: `Updated segment ${segmentId}` })
    return success(c, undefined, 'Segment updated')
  })
  .delete('/segments/:id', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')

    const deleted = await segmentService.delete(orgId, segmentId)
    if (!deleted) return error(c, 'Segment not found', 404)

    auditFromContext(c, { action: 'segment.deleted', entityType: 'segment', entityId: segmentId })
    activityFromContext(c, { action: 'segment.deleted', entityType: 'segment', entityId: segmentId, description: `Deleted segment ${segmentId}` })
    return success(c, undefined, 'Segment deleted')
  })
  // ==========================================================================
  // Static Segment Members
  // ==========================================================================
  .post('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), zValidator('json', ContactIdsSchema), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')
    const { contact_ids } = c.req.valid('json')

    const segment = await segmentService.get(orgId, segmentId)
    if (!segment) return error(c, 'Segment not found', 404)
    if (segment.type !== 'static') return error(c, 'Can only add contacts to static segments', 400)

    const added = await segmentService.addContacts(segmentId, contact_ids)
    auditFromContext(c, { action: 'segment.members_added', entityType: 'segment', entityId: segmentId, metadata: { count: added } })
    activityFromContext(c, { action: 'segment.updated', entityType: 'segment', entityId: segmentId, description: `Added ${added} contact(s) to segment ${segmentId}`, metadata: { count: added } })
    return success(c, { added }, `${added} contact(s) added to segment`)
  })
  .delete('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_MANAGE), zValidator('json', ContactIdsSchema), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')
    const { contact_ids } = c.req.valid('json')

    const segment = await segmentService.get(orgId, segmentId)
    if (!segment) return error(c, 'Segment not found', 404)

    const removed = await segmentService.removeContacts(segmentId, contact_ids)
    auditFromContext(c, { action: 'segment.members_removed', entityType: 'segment', entityId: segmentId, metadata: { count: removed } })
    activityFromContext(c, { action: 'segment.updated', entityType: 'segment', entityId: segmentId, description: `Removed ${removed} contact(s) from segment ${segmentId}`, metadata: { count: removed } })
    return success(c, { removed }, `${removed} contact(s) removed from segment`)
  })
  .get('/segments/:id/contacts', requirePermission(PERMISSIONS.SEGMENTS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const segmentId = c.req.param('id')
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')

    const segment = await segmentService.get(orgId, segmentId)
    if (!segment) return error(c, 'Segment not found', 404)

    const contactIds = await segmentService.getStaticMembers(segmentId, limit, offset)
    return success(c, { contact_ids: contactIds, total: segment.contact_count })
  })

export default segmentsRoutes
export type SegmentsRoutes = typeof segmentsRoutes
