// src/services/formService.ts - Universal Form Connector

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import { eventBus } from './eventBus'

// ============================================================================
// Types
// ============================================================================

export interface FormAction {
  type: 'add_to_list' | 'add_tag' | 'enroll_automation' | 'send_email' | 'webhook' | 'update_score'
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

// ============================================================================
// Service
// ============================================================================

class FormService {
  private db: Database

  constructor() {
    const dbPath = './data/contacts.db' // Share DB with contacts
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS form_endpoints (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        list_id TEXT NOT NULL,
        field_mapping TEXT DEFAULT '{}',
        required_fields TEXT DEFAULT '["email"]',
        allowed_domains TEXT DEFAULT '[]',
        redirect_url TEXT,
        actions TEXT DEFAULT '[]',
        double_optin INTEGER DEFAULT 0,
        success_message TEXT DEFAULT 'Thank you for subscribing!',
        submission_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_fe_org ON form_endpoints(org_id);
      CREATE INDEX IF NOT EXISTS idx_fe_status ON form_endpoints(status);

      CREATE TABLE IF NOT EXISTS form_submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        data TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (form_id) REFERENCES form_endpoints(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_fs_form ON form_submissions(form_id);
    `)
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: FormInput): FormEndpoint {
    const id = generateId('frm')

    this.db.prepare(`
      INSERT INTO form_endpoints (id, org_id, user_id, name, list_id, field_mapping, required_fields, allowed_domains, redirect_url, actions, double_optin, success_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId,
      input.name,
      input.list_id,
      JSON.stringify(input.field_mapping || { email: 'email', name: 'first_name' }),
      JSON.stringify(input.required_fields || ['email']),
      JSON.stringify(input.allowed_domains || []),
      input.redirect_url || null,
      JSON.stringify(input.actions || []),
      input.double_optin ? 1 : 0,
      input.success_message || 'Thank you for subscribing!'
    )

    return this.db.prepare('SELECT * FROM form_endpoints WHERE id = ?').get(id) as FormEndpoint
  }

  list(orgId: string): FormEndpoint[] {
    return this.db.prepare(`
      SELECT * FROM form_endpoints WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId) as FormEndpoint[]
  }

  get(formId: string): FormEndpoint | null {
    return this.db.prepare('SELECT * FROM form_endpoints WHERE id = ?').get(formId) as FormEndpoint | null
  }

  update(orgId: string, formId: string, updates: Partial<FormInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.list_id !== undefined) { sets.push('list_id = ?'); params.push(updates.list_id) }
    if (updates.field_mapping !== undefined) { sets.push('field_mapping = ?'); params.push(JSON.stringify(updates.field_mapping)) }
    if (updates.required_fields !== undefined) { sets.push('required_fields = ?'); params.push(JSON.stringify(updates.required_fields)) }
    if (updates.allowed_domains !== undefined) { sets.push('allowed_domains = ?'); params.push(JSON.stringify(updates.allowed_domains)) }
    if (updates.redirect_url !== undefined) { sets.push('redirect_url = ?'); params.push(updates.redirect_url) }
    if (updates.actions !== undefined) { sets.push('actions = ?'); params.push(JSON.stringify(updates.actions)) }
    if (updates.double_optin !== undefined) { sets.push('double_optin = ?'); params.push(updates.double_optin ? 1 : 0) }
    if (updates.success_message !== undefined) { sets.push('success_message = ?'); params.push(updates.success_message) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(formId, orgId)

    const result = this.db.prepare(`
      UPDATE form_endpoints SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params)
    return result.changes > 0
  }

  toggleStatus(orgId: string, formId: string): 'active' | 'paused' | null {
    const form = this.db.prepare('SELECT status FROM form_endpoints WHERE id = ? AND org_id = ?').get(formId, orgId) as { status: string } | null
    if (!form) return null
    const newStatus = form.status === 'active' ? 'paused' : 'active'
    this.db.prepare("UPDATE form_endpoints SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?").run(newStatus, formId, orgId)
    return newStatus as 'active' | 'paused'
  }

  delete(orgId: string, formId: string): boolean {
    const result = this.db.prepare('DELETE FROM form_endpoints WHERE id = ? AND org_id = ?').run(formId, orgId)
    return result.changes > 0
  }

  // --------------------------------------------------------------------------
  // Submissions
  // --------------------------------------------------------------------------

  recordSubmission(formId: string, data: Record<string, unknown>, ipAddress?: string, userAgent?: string): FormSubmission {
    const id = generateId('sub')

    this.db.prepare(`
      INSERT INTO form_submissions (id, form_id, data, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, formId, JSON.stringify(data), ipAddress || null, userAgent || null)

    // Increment submission count
    this.db.prepare('UPDATE form_endpoints SET submission_count = submission_count + 1 WHERE id = ?').run(formId)

    return this.db.prepare('SELECT * FROM form_submissions WHERE id = ?').get(id) as FormSubmission
  }

  getSubmissions(formId: string, limit = 50, offset = 0): { submissions: FormSubmission[]; total: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM form_submissions WHERE form_id = ?').get(formId) as any).count
    const submissions = this.db.prepare(`
      SELECT * FROM form_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(formId, limit, offset) as FormSubmission[]

    return { submissions, total }
  }

  // --------------------------------------------------------------------------
  // Embed Code Generation
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
