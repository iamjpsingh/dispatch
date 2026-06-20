// src/routes/templates.ts - Template Management API

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  PreviewSchema,
  PreviewHtmlSchema,
  TestSendSchema,
  DuplicateTemplateSchema,
  SectionSchema,
  UpdateSectionSchema,
  MjmlSchema,
  FromMjmlSchema,
} from '@dispatch/shared/templates'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { templateService, type TemplateCategory } from '../services/templateService'
import mjml2html from 'mjml'
import { d1UserDatabase } from '../services/d1UserDatabase'
import { createTransport, configFromRecord } from '../services/transports'
import { htmlToText } from '../utils/htmlToText'
import { success, error } from '../utils/response'

const templatesRoutes = new Hono()
  // ==========================================================================
  // Template CRUD
  // ==========================================================================
  .get('/templates', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
    const orgId = getOrgId(c)

    const filters = {
      category: c.req.query('category') as TemplateCategory | undefined,
      search: c.req.query('search'),
      page: parseInt(c.req.query('page') || '1'),
      limit: parseInt(c.req.query('limit') || '50'),
    }

    const { templates, total } = await templateService.list(orgId, filters)

    return c.json({
      success: true,
      data: templates,
      meta: {
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
          hasMore: filters.page * filters.limit < total,
        },
      },
    })
  })
  .post('/templates', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', CreateTemplateSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    const template = await templateService.create(orgId, user.id, body)
    return success(c, template, 'Template created', 201)
  })
  .get('/templates/starters', async (c) => {
    const starters = await templateService.getStarterTemplates()
    return success(c, { templates: starters })
  })
  .get('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')

    if (templateId === 'starters') return error(c, 'Template not found', 404)

    const template = await templateService.get(orgId, templateId)
    if (!template) return error(c, 'Template not found', 404)

    return success(c, template)
  })
  .put('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', UpdateTemplateSchema), async (c) => {
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')
    const body = c.req.valid('json')

    const updated = await templateService.update(orgId, templateId, body)
    if (!updated) return error(c, 'Template not found or is a starter template', 404)

    return success(c, undefined, 'Template updated')
  })
  .delete('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')

    const deleted = await templateService.delete(orgId, templateId)
    if (!deleted) return error(c, 'Template not found or cannot be deleted', 404)

    return success(c, undefined, 'Template deleted')
  })
  // ==========================================================================
  // Template Operations
  // ==========================================================================
  .post('/templates/:id/duplicate', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', DuplicateTemplateSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')
    const body = c.req.valid('json')
    const newName = body.name || 'Copy'

    const duplicate = await templateService.duplicate(orgId, user.id, templateId, newName)
    if (!duplicate) return error(c, 'Template not found', 404)

    return success(c, duplicate, 'Template duplicated', 201)
  })
  .post('/templates/:id/preview', requirePermission(PERMISSIONS.TEMPLATES_VIEW), zValidator('json', PreviewSchema), async (c) => {
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')
    const body = c.req.valid('json')

    const template = await templateService.get(orgId, templateId)
    if (!template) return error(c, 'Template not found', 404)

    const rendered = templateService.renderPreview(template.html_content, body.data || {})
    return success(c, { html: rendered, variables: JSON.parse(template.variables) })
  })
  .post('/templates/preview', requirePermission(PERMISSIONS.TEMPLATES_VIEW), zValidator('json', PreviewHtmlSchema), async (c) => {
    const body = c.req.valid('json')

    const rendered = templateService.renderPreview(body.html, body.data || {})
    const variables = templateService.extractVariables(body.html)
    return success(c, { html: rendered, variables })
  })
  // ==========================================================================
  // Test Send
  // ==========================================================================
  .post('/templates/:id/test-send', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', TestSendSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const templateId = c.req.param('id')
    const { to, subject, data } = c.req.valid('json')

    const recipientEmail = to || user.email
    if (!recipientEmail) return error(c, 'Recipient email is required', 400)

    const template = await templateService.get(orgId, templateId)
    if (!template) return error(c, 'Template not found', 404)

    // Render template with test data
    const html = templateService.renderPreview(template.html_content, data || {})
    const text = htmlToText(html)

    // Get first available SMTP config
    const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
    if (!configs || configs.length === 0) {
      return error(c, 'No email configuration found. Add one in Settings.', 400)
    }

    const config = configs[0]
    try {
      const transportConfig = configFromRecord({
        provider_type: config.provider_type || 'smtp',
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        password: config.password,
        from_email: config.from_email,
        from_name: config.from_name,
        api_key: config.api_key,
        api_secret: config.api_secret,
        api_region: config.api_region,
        api_domain: config.api_domain,
      })

      const transport = createTransport(transportConfig)
      const result = await transport.send({
        from: { name: config.from_name || 'Test', email: config.from_email || user.email },
        to: recipientEmail,
        subject: subject || `[TEST] ${template.name}`,
        html,
        text,
      })

      return success(c, { messageId: result.messageId }, `Test email sent to ${recipientEmail}`)
    } catch (err: any) {
      return error(c, `Failed to send test: ${err.message}`, 500)
    }
  })
  // ==========================================================================
  // Reusable Template Sections
  // ==========================================================================
  .get('/templates/sections', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const category = c.req.query('category')
    const sections = await templateService.listSections(orgId, category || undefined)
    return success(c, { sections })
  })
  .post('/templates/sections', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', SectionSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const section = await templateService.createSection(orgId, user.id, body)
    return success(c, section, 'Section created', 201)
  })
  .get('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const section = await templateService.getSection(orgId, c.req.param('id'))
    if (!section) return error(c, 'Section not found', 404)
    return success(c, section)
  })
  .put('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', UpdateSectionSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const updated = await templateService.updateSection(orgId, c.req.param('id'), body)
    if (!updated) return error(c, 'Section not found', 404)
    return success(c, undefined, 'Section updated')
  })
  .delete('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const deleted = await templateService.deleteSection(orgId, c.req.param('id'))
    if (!deleted) return error(c, 'Section not found', 404)
    return success(c, undefined, 'Section deleted')
  })
  .post('/templates/sections/:id/use', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const section = await templateService.getSection(orgId, c.req.param('id'))
    if (!section) return error(c, 'Section not found', 404)
    await templateService.incrementSectionUsage(c.req.param('id'))
    return success(c, { html_content: section.html_content })
  })
  // ==========================================================================
  // MJML Compilation
  // ==========================================================================
  /** Compile MJML source to responsive HTML */
  .post('/templates/compile', requirePermission(PERMISSIONS.TEMPLATES_VIEW), zValidator('json', MjmlSchema), async (c) => {
    const body = c.req.valid('json')

    try {
      const result = mjml2html(body.mjml, {
        validationLevel: 'soft',
        minify: false,
      })

      return success(c, {
        html: result.html,
        errors: result.errors?.map((e: any) => ({ line: e.line, message: e.message, tagName: e.tagName })) || [],
      })
    } catch (err: any) {
      return error(c, `MJML compilation failed: ${err.message}`, 400)
    }
  })
  /** Compile MJML and save as template */
  .post('/templates/from-mjml', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), zValidator('json', FromMjmlSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)

    const body = c.req.valid('json')

    try {
      const result = mjml2html(body.mjml, { validationLevel: 'soft' })
      const template = await templateService.create(orgId, user.id, {
        name: body.name,
        html_content: result.html,
        subject: body.subject,
        category: body.category as any,
        description: body.description,
        mjml_source: body.mjml,
      })
      return success(c, template, 'Template created from MJML')
    } catch (err: any) {
      return error(c, `MJML compilation failed: ${err.message}`, 400)
    }
  })

export default templatesRoutes
export type TemplatesRoutes = typeof templatesRoutes
