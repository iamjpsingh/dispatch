// src/services/formService.ts - Universal Form Connector (Postgres/Drizzle, async)

import { and, eq, desc, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { form_endpoints, form_submissions } from '../db/pg/schema'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface FormAction {
  // Free-text in the DB (actions are stored as JSON); the action handler dispatches on known
  // values and ignores the rest. Validated loosely by the route's zod schema.
  type: string
  listId?: string
  tag?: string
  automationId?: string
  templateId?: string
  url?: string
  amount?: number
}

export interface FormEndpoint {
  id: string
  org_id: string
  user_id: string
  name: string
  list_id: string
  field_mapping: string      // JSON: { "name": "first_name", "email": "email" }
  required_fields: string    // JSON: ["email"]
  allowed_domains: string    // JSON: ["https://example.com"]
  redirect_url: string | null
  actions: string            // JSON: FormAction[]
  double_optin: number       // 0 or 1
  success_message: string
  submission_count: number
  status: 'active' | 'paused'
  created_at: string
  updated_at: string
}

export interface FormSubmission {
  id: string
  form_id: string
  data: string               // JSON
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface FormInput {
  name: string
  list_id: string
  field_mapping?: Record<string, string>
  required_fields?: string[]
  allowed_domains?: string[]
  redirect_url?: string
  actions?: FormAction[]
  double_optin?: boolean
  success_message?: string
}

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class FormService {
  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: FormInput): Promise<FormEndpoint> {
    const db = getDb()
    const id = generateId('frm')

    await db.insert(form_endpoints).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      list_id: input.list_id,
      field_mapping: JSON.stringify(input.field_mapping || { email: 'email', name: 'first_name' }),
      required_fields: JSON.stringify(input.required_fields || ['email']),
      allowed_domains: JSON.stringify(input.allowed_domains || []),
      redirect_url: input.redirect_url || null,
      actions: JSON.stringify(input.actions || []),
      double_optin: input.double_optin ? 1 : 0,
      success_message: input.success_message || 'Thank you for subscribing!',
    })

    const [row] = await db.select().from(form_endpoints).where(eq(form_endpoints.id, id)).limit(1)
    return row as FormEndpoint
  }

  async list(orgId: string): Promise<FormEndpoint[]> {
    const rows = await getDb()
      .select()
      .from(form_endpoints)
      .where(eq(form_endpoints.org_id, orgId))
      .orderBy(desc(form_endpoints.created_at))
    return rows as FormEndpoint[]
  }

  async get(formId: string): Promise<FormEndpoint | null> {
    const [row] = await getDb().select().from(form_endpoints).where(eq(form_endpoints.id, formId)).limit(1)
    return (row as FormEndpoint) ?? null
  }

  async update(orgId: string, formId: string, updates: Partial<FormInput>): Promise<boolean> {
    const u = updates
    const values: Partial<typeof form_endpoints.$inferInsert> = {}

    if (u.name !== undefined) values.name = u.name
    if (u.list_id !== undefined) values.list_id = u.list_id
    if (u.field_mapping !== undefined) values.field_mapping = JSON.stringify(u.field_mapping)
    if (u.required_fields !== undefined) values.required_fields = JSON.stringify(u.required_fields)
    if (u.allowed_domains !== undefined) values.allowed_domains = JSON.stringify(u.allowed_domains)
    if (u.redirect_url !== undefined) values.redirect_url = u.redirect_url
    if (u.actions !== undefined) values.actions = JSON.stringify(u.actions)
    if (u.double_optin !== undefined) values.double_optin = u.double_optin ? 1 : 0
    if (u.success_message !== undefined) values.success_message = u.success_message

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(form_endpoints)
      .set(values)
      .where(and(eq(form_endpoints.id, formId), eq(form_endpoints.org_id, orgId)))
      .returning({ id: form_endpoints.id })
    return res.length > 0
  }

  async toggleStatus(orgId: string, formId: string): Promise<'active' | 'paused' | null> {
    const db = getDb()
    const [form] = await db
      .select({ status: form_endpoints.status })
      .from(form_endpoints)
      .where(and(eq(form_endpoints.id, formId), eq(form_endpoints.org_id, orgId)))
      .limit(1)
    if (!form) return null
    const newStatus = form.status === 'active' ? 'paused' : 'active'
    await db
      .update(form_endpoints)
      .set({ status: newStatus, updated_at: now() })
      .where(and(eq(form_endpoints.id, formId), eq(form_endpoints.org_id, orgId)))
    return newStatus as 'active' | 'paused'
  }

  async delete(orgId: string, formId: string): Promise<boolean> {
    const res = await getDb()
      .delete(form_endpoints)
      .where(and(eq(form_endpoints.id, formId), eq(form_endpoints.org_id, orgId)))
      .returning({ id: form_endpoints.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Submissions
  // --------------------------------------------------------------------------

  async recordSubmission(formId: string, data: Record<string, unknown>, ipAddress?: string, userAgent?: string): Promise<FormSubmission> {
    const db = getDb()
    const id = generateId('sub')

    await db.insert(form_submissions).values({
      id,
      form_id: formId,
      data: JSON.stringify(data),
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    })

    // Increment submission count
    await db
      .update(form_endpoints)
      .set({ submission_count: sql`${form_endpoints.submission_count} + 1` })
      .where(eq(form_endpoints.id, formId))

    const [row] = await db.select().from(form_submissions).where(eq(form_submissions.id, id)).limit(1)
    return row as FormSubmission
  }

  async getSubmissions(formId: string, limit = 50, offset = 0): Promise<{ submissions: FormSubmission[]; total: number }> {
    const db = getDb()
    const [tot] = await db.select({ value: count() }).from(form_submissions).where(eq(form_submissions.form_id, formId))
    const submissions = await db
      .select()
      .from(form_submissions)
      .where(eq(form_submissions.form_id, formId))
      .orderBy(desc(form_submissions.created_at))
      .limit(limit)
      .offset(offset)

    return { submissions: submissions as FormSubmission[], total: tot?.value ?? 0 }
  }

  // --------------------------------------------------------------------------
  // Embed Code Generation (pure helper)
  // --------------------------------------------------------------------------

  getEmbedCode(form: FormEndpoint, workerUrl: string): { html: string; js: string; api: string } {
    const fieldMapping: Record<string, string> = JSON.parse(form.field_mapping)
    const requiredFields: string[] = JSON.parse(form.required_fields)

    const inputFields = Object.keys(fieldMapping)
      .map(f => {
        const required = requiredFields.includes(f) ? ' required' : ''
        return `  <input name="${f}" placeholder="${f}"${required} />`
      })
      .join('\n')

    const html = `<form action="${workerUrl}/f/${form.id}" method="POST">
${inputFields}
  <button type="submit">Subscribe</button>
</form>`

    const js = `<script src="${workerUrl}/f/${form.id}.js"></script>
<div id="dispatch-form-${form.id}"></div>`

    const fields = Object.keys(fieldMapping).map(f => `${f}: '...'`).join(', ')
    const api = `fetch('${workerUrl}/f/${form.id}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ${fields} })
})`

    return { html, js, api }
  }
}

export const formService = new FormService()
