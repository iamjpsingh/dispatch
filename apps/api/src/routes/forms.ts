// src/routes/forms.ts - Universal Form Connector API

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { formService, type FormInput } from '../services/formService'
import { contactService } from '../services/contactService'
import { eventBus } from '../services/eventBus'
import { TRACKING } from '../config'
import { success, error } from '../utils/response'
import { validateBody } from '../utils/validate'

// ============================================================================
// Schemas
// ============================================================================

const CreateFormSchema = z.object({
  name: z.string().min(1, 'Form name is required').max(200),
  list_id: z.string().min(1, 'List ID is required'),
  required_fields: z.array(z.string()).optional(),
  field_mapping: z.record(z.string(), z.string()).optional(),
  allowed_domains: z.array(z.string()).optional(),
  redirect_url: z.string().url().optional().or(z.literal('')),
  success_message: z.string().max(500).optional(),
  actions: z.array(z.object({
    type: z.string(),
    tag: z.string().optional(),
  })).optional(),
})

const app = new Hono()

// ============================================================================
// Form Endpoints CRUD
// ============================================================================

app.post('/forms', requirePermission(PERMISSIONS.CONTACTS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateFormSchema)

  // Verify list exists
  const list = await contactService.getList(orgId, body.list_id)
  if (!list) return error(c, 'List not found', 404)

  const form = formService.create(orgId, user.id, body)
  return success(c, form, 'Form endpoint created')
})

app.get('/forms', requirePermission(PERMISSIONS.CONTACTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const forms = formService.list(orgId)
  return success(c, { forms })
})

app.get('/forms/:id', requirePermission(PERMISSIONS.CONTACTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')
  const form = formService.get(formId)

  if (!form || form.org_id !== orgId) return error(c, 'Form not found', 404)
  return success(c, form)
})

app.put('/forms/:id', requirePermission(PERMISSIONS.CONTACTS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')
  const body = await validateBody(c, CreateFormSchema.partial())

  const updated = formService.update(orgId, formId, body)
  if (!updated) return error(c, 'Form not found', 404)
  return success(c, undefined, 'Form updated')
})

app.delete('/forms/:id', requirePermission(PERMISSIONS.CONTACTS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')

  const deleted = formService.delete(orgId, formId)
  if (!deleted) return error(c, 'Form not found', 404)
  return success(c, undefined, 'Form deleted')
})

// ============================================================================
// Embed Code
// ============================================================================

app.get('/forms/:id/embed', requirePermission(PERMISSIONS.CONTACTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')
  const form = formService.get(formId)

  if (!form || form.org_id !== orgId) return error(c, 'Form not found', 404)

  const workerUrl = TRACKING.WORKER_URL || c.req.url.replace(/\/api\/forms\/.*/, '')
  const embedCode = formService.getEmbedCode(form, workerUrl)
  return success(c, embedCode)
})

// ============================================================================
// Submissions (view from dashboard)
// ============================================================================

app.get('/forms/:id/submissions', requirePermission(PERMISSIONS.CONTACTS_VIEW), (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')
  const form = formService.get(formId)

  if (!form || form.org_id !== orgId) return error(c, 'Form not found', 404)

  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const result = formService.getSubmissions(formId, limit, offset)
  return success(c, result)
})

// ============================================================================
// Public Form Submission (no auth — called by external websites)
// ============================================================================

app.post('/forms/:id/submit', async (c) => {
  const formId = c.req.param('id')
  const form = formService.get(formId)

  if (!form) return error(c, 'Form not found', 404)
  if (form.status !== 'active') return error(c, 'Form is not active', 403)

  // CORS origin check
  const allowedDomains: string[] = JSON.parse(form.allowed_domains || '[]')
  if (allowedDomains.length > 0) {
    const origin = c.req.header('Origin') || c.req.header('Referer') || ''
    const allowed = allowedDomains.some(d => origin.startsWith(d))
    if (!allowed) return error(c, 'Origin not allowed', 403)
  }

  // Parse submission data
  let data: Record<string, unknown>
  const contentType = c.req.header('Content-Type') || ''
  if (contentType.includes('application/json')) {
    data = await c.req.json()
  } else {
    // URL-encoded form data
    const formData = await c.req.parseBody()
    data = formData as Record<string, unknown>
  }

  // Validate required fields
  const requiredFields: string[] = JSON.parse(form.required_fields || '["email"]')
  for (const field of requiredFields) {
    if (!data[field] || String(data[field]).trim() === '') {
      return error(c, `Missing required field: ${field}`, 400)
    }
  }

  // Record submission
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || ''
  const ua = c.req.header('User-Agent') || ''
  formService.recordSubmission(formId, data, ip, ua)

  // Map fields and add contact to list
  const fieldMapping: Record<string, string> = JSON.parse(form.field_mapping || '{}')
  const contactData: Record<string, string> = {}
  for (const [formField, contactField] of Object.entries(fieldMapping)) {
    if (data[formField] !== undefined) {
      contactData[contactField] = String(data[formField])
    }
  }

  if (contactData.email) {
    try {
      await contactService.addContact(form.org_id, form.user_id, form.list_id, {
        email: contactData.email,
        first_name: contactData.first_name || '',
        last_name: contactData.last_name || '',
        company: contactData.company || '',
        phone: contactData.phone || '',
        source: 'form',
      })
    } catch {
      // Contact may already exist — that's fine
    }
  }

  // Emit event for automation triggers
  eventBus.emit('form:submitted', {
    formId,
    orgId: form.org_id,
    data: contactData,
  })

  // Execute form actions (tag contacts, etc.)
  const actions = JSON.parse(form.actions || '[]')
  if (actions.length > 0 && contactData.email) {
    const tagsToAdd = actions
      .filter((a: any) => a.type === 'add_tag' && a.tag)
      .map((a: any) => a.tag)
    if (tagsToAdd.length > 0) {
      try {
        const result = await contactService.getContacts(form.org_id, form.list_id, {
          search: contactData.email, limit: 1,
        })
        const match = result.contacts.find(ct => ct.email === contactData.email)
        if (match) {
          await contactService.tagContacts(form.org_id, [match.id], tagsToAdd)
        }
      } catch {
        // Non-critical
      }
    }
  }

  // Redirect or return JSON
  if (form.redirect_url) {
    return c.redirect(form.redirect_url)
  }

  return c.json({ success: true, message: form.success_message })
})

// ============================================================================
// Toggle Form Status
// ============================================================================

app.post('/forms/:id/toggle', requirePermission(PERMISSIONS.CONTACTS_MANAGE), (c) => {
  const orgId = getOrgId(c)
  const formId = c.req.param('id')

  const newStatus = formService.toggleStatus(orgId, formId)
  if (!newStatus) return error(c, 'Form not found', 404)
  return success(c, { status: newStatus }, `Form ${newStatus}`)
})

// ============================================================================
// Webhook Receiver (connect external form services: Typeform, JotForm, Zapier)
// ============================================================================

app.post('/forms/:id/webhook', async (c) => {
  const formId = c.req.param('id')
  const form = formService.get(formId)

  if (!form) return error(c, 'Form not found', 404)
  if (form.status !== 'active') return error(c, 'Form is not active', 403)

  let data: Record<string, unknown>
  try {
    const raw = await c.req.json()
    // Support common webhook payload formats
    // Typeform: { form_response: { answers: [...] } }
    // JotForm: { rawRequest: "...", formID: "..." }
    // Zapier/Make: flat object { email: "...", name: "..." }
    // Generic: { data: { ... } }
    if (raw.form_response?.answers) {
      // Typeform format
      data = {}
      for (const answer of raw.form_response.answers) {
        const fieldId = answer.field?.ref || answer.field?.id || `field_${answer.field?.type}`
        data[fieldId] = answer.text || answer.email || answer.number || answer.choice?.label || answer.url || ''
      }
    } else if (raw.rawRequest) {
      // JotForm format
      try { data = JSON.parse(raw.rawRequest) } catch { data = raw }
    } else if (raw.data && typeof raw.data === 'object') {
      // Wrapped format
      data = raw.data as Record<string, unknown>
    } else {
      // Flat format (Zapier, Make, direct API)
      data = raw
    }
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  // Record submission
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || ''
  const ua = c.req.header('User-Agent') || ''
  formService.recordSubmission(formId, data, ip, ua)

  // Map fields and add contact
  const fieldMapping: Record<string, string> = JSON.parse(form.field_mapping || '{}')
  const contactData: Record<string, string> = {}
  for (const [formField, contactField] of Object.entries(fieldMapping)) {
    if (data[formField] !== undefined) contactData[contactField] = String(data[formField])
  }

  if (contactData.email) {
    try {
      await contactService.addContact(form.org_id, form.user_id, form.list_id, {
        email: contactData.email,
        first_name: contactData.first_name || '',
        last_name: contactData.last_name || '',
        company: contactData.company || '',
        phone: contactData.phone || '',
        source: 'webhook',
      })
    } catch { /* duplicate OK */ }
  }

  // Execute actions
  const actions = JSON.parse(form.actions || '[]')
  if (actions.length > 0 && contactData.email) {
    for (const action of actions) {
      if (action.type === 'add_tag' && action.tag) {
        try {
          const result = await contactService.getContacts(form.org_id, form.list_id, { search: contactData.email, limit: 1 })
          const match = result.contacts.find(ct => ct.email === contactData.email)
          if (match) await contactService.tagContacts(form.org_id, [match.id], [action.tag])
        } catch { /* non-critical */ }
      }
    }
  }

  eventBus.emit('form:submitted', { formId, orgId: form.org_id, data: contactData, source: 'webhook' })

  return c.json({ success: true, message: form.success_message })
})

export default app
