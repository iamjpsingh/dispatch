// src/routes/templates.ts - Template Management API

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { templateService, type TemplateCategory } from '../services/templateService'
import mjml2html from 'mjml'
import { d1UserDatabase } from '../services/d1UserDatabase'
import { createTransport, configFromRecord } from '../services/transports'
import { htmlToText } from '../utils/htmlToText'
import { success, error } from '../utils/response'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  html_content: z.string().trim().min(1, 'HTML content is required'),
  subject: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
  variables: z.array(z.string()).optional(),
})

const UpdateTemplateSchema = CreateTemplateSchema.partial()

const PreviewSchema = z.object({
  data: z.record(z.string(), z.string()).optional(),
  html: z.string().optional(),
})

const TestSendSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().max(500).optional(),
  data: z.record(z.string(), z.string()).optional(),
})

const app = new Hono()

// ============================================================================
// Template CRUD
// ============================================================================

app.get('/templates', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
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

app.post('/templates', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateTemplateSchema)

  const template = await templateService.create(orgId, user.id, body)
  return success(c, template, 'Template created', 201)
})

app.get('/templates/starters', async (c) => {
  const starters = await templateService.getStarterTemplates()
  return success(c, { templates: starters })
})

app.get('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')

  if (templateId === 'starters') return c.notFound()

  const template = await templateService.get(orgId, templateId)
  if (!template) return error(c, 'Template not found', 404)

  return success(c, template)
})

app.put('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')
  const body = await validateBody(c, UpdateTemplateSchema)

  const updated = await templateService.update(orgId, templateId, body)
  if (!updated) return error(c, 'Template not found or is a starter template', 404)

  return success(c, undefined, 'Template updated')
})

app.delete('/templates/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')

  const deleted = await templateService.delete(orgId, templateId)
  if (!deleted) return error(c, 'Template not found or cannot be deleted', 404)

  return success(c, undefined, 'Template deleted')
})

// ============================================================================
// Template Operations
// ============================================================================

app.post('/templates/:id/duplicate', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const newName = body.name || 'Copy'

  const duplicate = await templateService.duplicate(orgId, user.id, templateId, newName)
  if (!duplicate) return error(c, 'Template not found', 404)

  return success(c, duplicate, 'Template duplicated', 201)
})

app.post('/templates/:id/preview', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')
  const body = await validateBody(c, PreviewSchema)

  const template = await templateService.get(orgId, templateId)
  if (!template) return error(c, 'Template not found', 404)

  const rendered = templateService.renderPreview(template.html_content, body.data || {})
  return success(c, { html: rendered, variables: JSON.parse(template.variables) })
})

app.post('/templates/preview', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const body = await validateBody(c, PreviewSchema.extend({ html: z.string().min(1, 'HTML content is required') }))

  const rendered = templateService.renderPreview(body.html, body.data || {})
  const variables = templateService.extractVariables(body.html)
  return success(c, { html: rendered, variables })
})

// ============================================================================
// Test Send
// ============================================================================

app.post('/templates/:id/test-send', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const templateId = c.req.param('id')
  const { to, subject, data } = await validateBody(c, TestSendSchema)

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

// ============================================================================
// Reusable Template Sections
// ============================================================================

const SectionSchema = z.object({
  name: z.string().min(1, 'Section name is required').max(200),
  category: z.enum(['header', 'footer', 'cta', 'hero', 'social', 'divider', 'general']).optional(),
  html_content: z.string().min(1, 'HTML content is required'),
})

app.get('/templates/sections', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const category = c.req.query('category')
  const sections = await templateService.listSections(orgId, category || undefined)
  return success(c, { sections })
})

app.post('/templates/sections', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, SectionSchema)
  const section = await templateService.createSection(orgId, user.id, body)
  return success(c, section, 'Section created', 201)
})

app.get('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const section = await templateService.getSection(orgId, c.req.param('id'))
  if (!section) return error(c, 'Section not found', 404)
  return success(c, section)
})

app.put('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, SectionSchema.partial())
  const updated = await templateService.updateSection(orgId, c.req.param('id'), body)
  if (!updated) return error(c, 'Section not found', 404)
  return success(c, undefined, 'Section updated')
})

app.delete('/templates/sections/:id', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const deleted = await templateService.deleteSection(orgId, c.req.param('id'))
  if (!deleted) return error(c, 'Section not found', 404)
  return success(c, undefined, 'Section deleted')
})

app.post('/templates/sections/:id/use', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const section = await templateService.getSection(orgId, c.req.param('id'))
  if (!section) return error(c, 'Section not found', 404)
  await templateService.incrementSectionUsage(c.req.param('id'))
  return success(c, { html_content: section.html_content })
})

// ============================================================================
// MJML Compilation
// ============================================================================

const MjmlSchema = z.object({
  mjml: z.string().min(1, 'MJML source is required'),
})

/** Compile MJML source to responsive HTML */
app.post('/templates/compile', requirePermission(PERMISSIONS.TEMPLATES_VIEW), async (c) => {
  const body = await validateBody(c, MjmlSchema)

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
app.post('/templates/from-mjml', requirePermission(PERMISSIONS.TEMPLATES_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)

  const FromMjmlSchema = z.object({
    name: z.string().min(1).max(200),
    mjml: z.string().min(1),
    subject: z.string().max(500).optional(),
    category: z.string().max(50).optional() as any,
    description: z.string().max(1000).optional(),
  })

  const body = await validateBody(c, FromMjmlSchema)

  try {
    const result = mjml2html(body.mjml, { validationLevel: 'soft' })
    const template = await templateService.create(orgId, user.id, {
      name: body.name,
      html_content: result.html,
      subject: body.subject,
      category: body.category,
      description: body.description,
      mjml_source: body.mjml,
    })
    return success(c, template, 'Template created from MJML')
  } catch (err: any) {
    return error(c, `MJML compilation failed: ${err.message}`, 400)
  }
})

export default app
