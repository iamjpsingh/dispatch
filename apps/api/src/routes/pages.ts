// src/routes/pages.ts - Landing Page API

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { CreatePageSchema } from '@dispatch/shared/pages'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { landingPageService } from '../services/landingPageService'
import { TRACKING } from '../config'
import { success, error } from '../utils/response'
import { auditFromContext, activityFromContext } from '../services/audit/context'

const pagesRoutes = new Hono()
  // ==========================================================================
  // Templates
  // ==========================================================================
  .get('/pages/templates', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => {
    const templates = landingPageService.getTemplates()
    return success(c, { templates })
  })
  // ==========================================================================
  // CRUD
  // ==========================================================================
  .post('/pages', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', CreatePageSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    try {
      const page = await landingPageService.create(orgId, user.id, body)
      auditFromContext(c, { action: 'page.created', entityType: 'page', entityId: page.id })
      activityFromContext(c, { action: 'page.created', entityType: 'page', entityId: page.id, description: `Created page ${page.id}` })
      return success(c, page, 'Landing page created')
    } catch (e: any) {
      return error(c, e.message || 'Failed to create page', 400)
    }
  })
  .get('/pages', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const pages = await landingPageService.list(orgId)
    return success(c, { pages })
  })
  .get('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')
    const page = await landingPageService.get(pageId)

    if (!page || page.org_id !== orgId) return error(c, 'Page not found', 404)
    return success(c, page)
  })
  .put('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), zValidator('json', CreatePageSchema.partial()), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')
    const body = c.req.valid('json')

    try {
      const updated = await landingPageService.update(orgId, pageId, body)
      if (!updated) return error(c, 'Page not found', 404)
      auditFromContext(c, { action: 'page.updated', entityType: 'page', entityId: pageId })
      activityFromContext(c, { action: 'page.updated', entityType: 'page', entityId: pageId, description: `Updated page ${pageId}` })
      return success(c, undefined, 'Page updated')
    } catch (e: any) {
      return error(c, e.message || 'Failed to update page', 400)
    }
  })
  .delete('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')

    const deleted = await landingPageService.delete(orgId, pageId)
    if (!deleted) return error(c, 'Page not found', 404)
    auditFromContext(c, { action: 'page.deleted', entityType: 'page', entityId: pageId })
    activityFromContext(c, { action: 'page.deleted', entityType: 'page', entityId: pageId, description: `Deleted page ${pageId}` })
    return success(c, undefined, 'Page deleted')
  })
  // ==========================================================================
  // Publish / Unpublish
  // ==========================================================================
  .post('/pages/:id/publish', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')

    const published = await landingPageService.publish(orgId, pageId)
    if (!published) return error(c, 'Page not found', 404)

    const page = await landingPageService.get(pageId)
    const workerUrl = TRACKING.WORKER_URL || ''
    const publicUrl = workerUrl ? `${workerUrl}/p/${page?.slug}` : `/p/${page?.slug}`

    auditFromContext(c, { action: 'page.published', entityType: 'page', entityId: pageId })
    return success(c, { url: publicUrl }, 'Page published')
  })
  .post('/pages/:id/unpublish', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')

    const unpublished = await landingPageService.unpublish(orgId, pageId)
    if (!unpublished) return error(c, 'Page not found', 404)
    auditFromContext(c, { action: 'page.unpublished', entityType: 'page', entityId: pageId })
    return success(c, undefined, 'Page unpublished')
  })
  // ==========================================================================
  // Preview
  // ==========================================================================
  .get('/pages/:id/preview', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const pageId = c.req.param('id')
    const page = await landingPageService.get(pageId)

    if (!page || page.org_id !== orgId) return error(c, 'Page not found', 404)

    const workerUrl = TRACKING.WORKER_URL || ''
    const html = landingPageService.renderPage(page, workerUrl)
    return c.html(html)
  })

export default pagesRoutes
export type PagesRoutes = typeof pagesRoutes
