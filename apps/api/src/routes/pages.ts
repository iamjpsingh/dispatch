// src/routes/pages.ts - Landing Page API

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { landingPageService, type LandingPageInput } from '../services/landingPageService'
import { TRACKING } from '../config'
import { success, error } from '../utils/response'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const CreatePageSchema = z.object({
  title: z.string().min(1, 'Page title is required').max(200),
  slug: z.string().min(1, 'Page slug is required').max(200),
  html_content: z.string().optional(),
  css: z.string().optional(),
  meta_description: z.string().max(500).optional(),
  meta_image: z.string().url().optional().or(z.literal('')),
  template_id: z.string().optional(),
})

const app = new Hono()

// ============================================================================
// Templates
// ============================================================================

app.get('/pages/templates', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => {
  const templates = landingPageService.getTemplates()
  return success(c, { templates })
})

// ============================================================================
// CRUD
// ============================================================================

app.post('/pages', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreatePageSchema)

  try {
    const page = landingPageService.create(orgId, user.id, body)
    return success(c, page, 'Landing page created')
  } catch (e: any) {
    return error(c, e.message || 'Failed to create page', 400)
  }
})

app.get('/pages', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const pages = landingPageService.list(orgId)
  return success(c, { pages })
})

app.get('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')
  const page = landingPageService.get(pageId)

  if (!page || page.org_id !== orgId) return error(c, 'Page not found', 404)
  return success(c, page)
})

app.put('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')
  const body = await validateBody(c, CreatePageSchema.partial())

  try {
    const updated = landingPageService.update(orgId, pageId, body)
    if (!updated) return error(c, 'Page not found', 404)
    return success(c, undefined, 'Page updated')
  } catch (e: any) {
    return error(c, e.message || 'Failed to update page', 400)
  }
})

app.delete('/pages/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')

  const deleted = landingPageService.delete(orgId, pageId)
  if (!deleted) return error(c, 'Page not found', 404)
  return success(c, undefined, 'Page deleted')
})

// ============================================================================
// Publish / Unpublish
// ============================================================================

app.post('/pages/:id/publish', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')

  const published = landingPageService.publish(orgId, pageId)
  if (!published) return error(c, 'Page not found', 404)

  const page = landingPageService.get(pageId)
  const workerUrl = TRACKING.WORKER_URL || ''
  const publicUrl = workerUrl ? `${workerUrl}/p/${page?.slug}` : `/p/${page?.slug}`

  return success(c, { url: publicUrl }, 'Page published')
})

app.post('/pages/:id/unpublish', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')

  const unpublished = landingPageService.unpublish(orgId, pageId)
  if (!unpublished) return error(c, 'Page not found', 404)
  return success(c, undefined, 'Page unpublished')
})

// ============================================================================
// Preview
// ============================================================================

app.get('/pages/:id/preview', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const pageId = c.req.param('id')
  const page = landingPageService.get(pageId)

  if (!page || page.org_id !== orgId) return error(c, 'Page not found', 404)

  const workerUrl = TRACKING.WORKER_URL || ''
  const html = landingPageService.renderPage(page, workerUrl)
  return c.html(html)
})

export default app
