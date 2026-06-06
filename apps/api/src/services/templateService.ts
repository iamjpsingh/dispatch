// src/services/templateService.ts - Email Template CRUD + Management

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface Template {
  id: string
  org_id: string
  user_id: string
  name: string
  description: string | null
  category: TemplateCategory
  subject: string | null
  html_content: string
  text_content: string | null
  variables: string // JSON array
  is_starter: number
  version: number
  parent_id: string | null
  created_at: string
  updated_at: string
}

export type TemplateCategory = 'newsletter' | 'promotional' | 'transactional' | 'welcome' | 'follow_up' | 'announcement' | 'general'

export interface TemplateInput {
  name: string
  description?: string
  category?: TemplateCategory
  subject?: string
  html_content: string
  text_content?: string
  mjml_source?: string
}

export interface TemplateFilters {
  category?: TemplateCategory
  search?: string
  page?: number
  limit?: number
}

// ============================================================================
// Service
// ============================================================================

class TemplateService {
  private db: Database

  constructor() {
    const dbPath = './data/templates.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
    this.seedStarterTemplates()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'general' CHECK (category IN (
          'newsletter', 'promotional', 'transactional', 'welcome',
          'follow_up', 'announcement', 'general'
        )),
        subject TEXT,
        html_content TEXT NOT NULL,
        text_content TEXT,
        variables TEXT DEFAULT '[]',
        is_starter INTEGER DEFAULT 0,
        version INTEGER DEFAULT 1,
        parent_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tpl_user ON templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_tpl_category ON templates(category);
      CREATE INDEX IF NOT EXISTS idx_tpl_starter ON templates(is_starter);
    `)

    // Add columns to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE templates ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE templates ADD COLUMN mjml_source TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tpl_org ON templates(org_id)')

    // Reusable template sections (headers, footers, CTAs, etc.)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS template_sections (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'general' CHECK (category IN ('header', 'footer', 'cta', 'hero', 'social', 'divider', 'general')),
        html_content TEXT NOT NULL,
        thumbnail TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ts_org ON template_sections(org_id);
      CREATE INDEX IF NOT EXISTS idx_ts_category ON template_sections(category);
    `)

    logger.info('Templates database initialized (data/templates.db)')
  }

  private seedStarterTemplates() {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM templates WHERE is_starter = 1').get() as any).c
    if (count > 0) return

    const starters: { name: string; category: TemplateCategory; subject: string; html: string; description: string }[] = [
      {
        name: 'Simple Welcome',
        category: 'welcome',
        subject: 'Welcome to {{Company}}!',
        description: 'Clean welcome email for new subscribers',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="margin:0 0 16px;color:#18181b;font-size:24px">Welcome, {{FirstName}}!</h1><p style="color:#52525b;line-height:1.6;margin:0 0 24px">We're thrilled to have you on board. You've just joined a community of people who care about great email communication.</p><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Get Started</a><p style="color:#a1a1aa;font-size:13px;margin:32px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">If you didn't sign up, you can safely ignore this email.</p></div></div></body></html>`,
      },
      {
        name: 'Newsletter',
        category: 'newsletter',
        subject: '{{Company}} Newsletter - {{Month}} Update',
        description: 'Monthly newsletter with sections for updates',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#2563eb;border-radius:12px 12px 0 0;padding:32px 40px"><h1 style="margin:0;color:#fff;font-size:22px">{{Company}} Newsletter</h1><p style="margin:8px 0 0;color:#bfdbfe;font-size:14px">Your monthly update</p></div><div style="background:#fff;padding:40px;border-radius:0 0 12px 12px"><h2 style="color:#18181b;font-size:18px;margin:0 0 12px">Hi {{FirstName}},</h2><p style="color:#52525b;line-height:1.6;margin:0 0 24px">Here's what's new this month:</p><div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:16px"><h3 style="margin:0 0 8px;color:#18181b;font-size:16px">Feature Update</h3><p style="color:#52525b;margin:0;line-height:1.5">Share your latest product updates, features, or announcements here.</p></div><div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:24px"><h3 style="margin:0 0 8px;color:#18181b;font-size:16px">Tip of the Month</h3><p style="color:#52525b;margin:0;line-height:1.5">Share a helpful tip or insight that your subscribers will find valuable.</p></div><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Read More</a><p style="color:#a1a1aa;font-size:13px;margin:32px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">You're receiving this because you subscribed to our newsletter.</p></div></div></body></html>`,
      },
      {
        name: 'Promotional Offer',
        category: 'promotional',
        subject: '{{Discount}}% Off — Limited Time Offer',
        description: 'Eye-catching promotional email with CTA',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)"><div style="background:#fef3c7;color:#92400e;display:inline-block;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:20px">LIMITED TIME</div><h1 style="margin:0 0 8px;color:#18181b;font-size:32px">{{Discount}}% Off</h1><p style="color:#52525b;font-size:18px;margin:0 0 32px">Hey {{FirstName}}, we have a special offer just for you.</p><a href="#" style="display:inline-block;background:#dc2626;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Claim Your Discount</a><p style="color:#a1a1aa;font-size:13px;margin:32px 0 0">Offer expires in 48 hours. Don't miss out!</p></div></div></body></html>`,
      },
      {
        name: 'Follow-up',
        category: 'follow_up',
        subject: 'Following up — {{Subject}}',
        description: 'Professional follow-up email template',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><p style="color:#52525b;line-height:1.7;margin:0 0 16px">Hi {{FirstName}},</p><p style="color:#52525b;line-height:1.7;margin:0 0 16px">I wanted to follow up on my previous email. I understand you're busy, so I'll keep this brief.</p><p style="color:#52525b;line-height:1.7;margin:0 0 24px">Would you have 15 minutes this week for a quick chat? I'd love to show you how we can help {{Company}} achieve better results.</p><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Schedule a Call</a><p style="color:#52525b;line-height:1.7;margin:24px 0 0">Best regards,<br>{{SenderName}}</p></div></div></body></html>`,
      },
      {
        name: 'Announcement',
        category: 'announcement',
        subject: 'Big News from {{Company}}',
        description: 'Company announcement or product launch',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:12px;padding:40px;text-align:center"><h1 style="margin:0 0 12px;color:#fff;font-size:28px">We Have News!</h1><p style="color:#c7d2fe;font-size:16px;margin:0 0 24px">Something exciting is coming to {{Company}}</p></div><div style="background:#fff;border-radius:0 0 12px 12px;padding:40px;margin-top:-2px"><p style="color:#52525b;line-height:1.7;margin:0 0 16px">Hi {{FirstName}},</p><p style="color:#52525b;line-height:1.7;margin:0 0 24px">We're excited to share some big news with you. Here's what you need to know:</p><ul style="color:#52525b;line-height:1.8;margin:0 0 24px;padding-left:20px"><li>Key highlight #1</li><li>Key highlight #2</li><li>Key highlight #3</li></ul><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Learn More</a></div></div></body></html>`,
      },
      {
        name: 'Event Invitation',
        category: 'announcement' as TemplateCategory,
        subject: 'You\'re Invited — {{EventName}}',
        description: 'Webinar or event invitation with RSVP',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)"><div style="background:#0f172a;padding:40px;text-align:center"><div style="display:inline-block;background:#6366f1;color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px">LIVE EVENT</div><h1 style="margin:0 0 8px;color:#fff;font-size:26px">{{EventName}}</h1><p style="color:#94a3b8;margin:0;font-size:15px">{{EventDate}} at {{EventTime}}</p></div><div style="padding:32px 40px"><p style="color:#52525b;line-height:1.7;margin:0 0 20px">Hi {{FirstName}},</p><p style="color:#52525b;line-height:1.7;margin:0 0 24px">You're invited to join us for an exclusive session. Don't miss this opportunity to learn and connect.</p><div style="text-align:center;margin:24px 0"><a href="#" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">RSVP Now</a></div><p style="color:#a1a1aa;font-size:13px;text-align:center;margin:24px 0 0">Spots are limited. Reserve yours today.</p></div></div></div></body></html>`,
      },
      {
        name: 'Re-engagement',
        category: 'follow_up' as TemplateCategory,
        subject: 'We Miss You, {{FirstName}}!',
        description: 'Win back inactive subscribers',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)"><div style="font-size:48px;margin-bottom:16px">👋</div><h1 style="margin:0 0 12px;color:#18181b;font-size:24px">We Miss You!</h1><p style="color:#52525b;line-height:1.6;margin:0 0 24px">Hi {{FirstName}}, it's been a while since you've opened our emails. We've been working on some great things and would love to reconnect.</p><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">See What's New</a><p style="color:#a1a1aa;font-size:13px;margin:32px 0 0">Not interested anymore? <a href="{{UnsubscribeLink}}" style="color:#6366f1">Unsubscribe</a></p></div></div></body></html>`,
      },
      {
        name: 'Product Update',
        category: 'newsletter' as TemplateCategory,
        subject: 'New in {{Company}}: {{FeatureName}}',
        description: 'Feature announcement with screenshots',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><div style="display:inline-block;background:#dbeafe;color:#1d4ed8;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-bottom:16px">PRODUCT UPDATE</div><h1 style="margin:0 0 16px;color:#18181b;font-size:24px">Introducing {{FeatureName}}</h1><p style="color:#52525b;line-height:1.7;margin:0 0 24px">Hi {{FirstName}}, we've just shipped something we think you'll love. Here's what's new:</p><img src="https://placehold.co/520x280/f0f0f0/999?text=Feature+Screenshot" style="width:100%;border-radius:8px;margin-bottom:24px" /><h3 style="color:#18181b;margin:0 0 8px">What's New</h3><ul style="color:#52525b;line-height:1.8;padding-left:20px;margin:0 0 24px"><li>Improvement #1 — describe the benefit</li><li>Improvement #2 — describe the benefit</li><li>Improvement #3 — describe the benefit</li></ul><a href="#" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Try It Now</a></div></div></body></html>`,
      },
      {
        name: 'Survey / Feedback',
        category: 'transactional' as TemplateCategory,
        subject: 'Quick question, {{FirstName}}?',
        description: 'NPS or feedback request email',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="margin:0 0 16px;color:#18181b;font-size:22px">How are we doing?</h1><p style="color:#52525b;line-height:1.7;margin:0 0 24px">Hi {{FirstName}}, your feedback helps us improve. It only takes 30 seconds.</p><p style="color:#52525b;font-weight:600;margin:0 0 12px">How likely are you to recommend us?</p><div style="text-align:center;margin:16px 0 32px"><table cellpadding="0" cellspacing="4" style="margin:0 auto"><tr><td v-for="n in 10" style="width:40px;height:40px;text-align:center;vertical-align:middle;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none" bgcolor="#f4f4f5"><a href="#" style="color:#52525b;text-decoration:none;display:block;padding:10px">1</a></td><td style="width:40px;height:40px;text-align:center;border-radius:8px;font-weight:600;font-size:14px" bgcolor="#f4f4f5"><a href="#" style="color:#52525b;text-decoration:none;display:block;padding:10px">2</a></td><td style="width:40px;height:40px;text-align:center;border-radius:8px;font-weight:600;font-size:14px" bgcolor="#f4f4f5"><a href="#" style="color:#52525b;text-decoration:none;display:block;padding:10px">3</a></td><td style="width:40px;height:40px;text-align:center;border-radius:8px;font-weight:600;font-size:14px" bgcolor="#f4f4f5"><a href="#" style="color:#52525b;text-decoration:none;display:block;padding:10px">4</a></td><td style="width:40px;height:40px;text-align:center;border-radius:8px;font-weight:600;font-size:14px" bgcolor="#f4f4f5"><a href="#" style="color:#52525b;text-decoration:none;display:block;padding:10px">5</a></td></tr></table><div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:#a1a1aa"><span>Not likely</span><span>Very likely</span></div></div><p style="color:#a1a1aa;font-size:13px;margin:0;text-align:center">Thanks for your time!</p></div></div></body></html>`,
      },
      {
        name: 'Plain Text',
        category: 'general' as TemplateCategory,
        subject: '{{Subject}}',
        description: 'Simple text-only email — no design, maximum deliverability',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><p style="color:#18181b;line-height:1.8;margin:0 0 16px">Hi {{FirstName}},</p><p style="color:#18181b;line-height:1.8;margin:0 0 16px">Your message content goes here. Plain text emails have the highest deliverability and feel personal.</p><p style="color:#18181b;line-height:1.8;margin:0 0 16px">Best,<br>{{SenderName}}</p><p style="color:#a1a1aa;font-size:12px;margin:32px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">{{Company}} | <a href="{{UnsubscribeLink}}" style="color:#6366f1">Unsubscribe</a></p></div></body></html>`,
      },
    ]

    const stmt = this.db.prepare(`
      INSERT INTO templates (id, user_id, name, description, category, subject, html_content, variables, is_starter)
      VALUES (?, '__system__', ?, ?, ?, ?, ?, ?, 1)
    `)

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < starters.length; i++) {
        const s = starters[i]
        const variables = this.extractVariables(s.html)
        stmt.run(`starter_${i + 1}`, s.name, s.description, s.category, s.subject, s.html, JSON.stringify(variables))
      }
    })

    transaction()
    logger.debug(`Seeded ${starters.length} starter templates`)
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: TemplateInput): Template {
    const id = generateId('tpl')
    const variables = this.extractVariables(input.html_content)

    this.db.prepare(`
      INSERT INTO templates (id, org_id, user_id, name, description, category, subject, html_content, text_content, variables, mjml_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId,
      input.name,
      input.description || null,
      input.category || 'general',
      input.subject || null,
      input.html_content,
      input.text_content || null,
      JSON.stringify(variables),
      input.mjml_source || null
    )

    return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Template
  }

  get(orgId: string, templateId: string): Template | null {
    return this.db.prepare(`
      SELECT * FROM templates WHERE id = ? AND (org_id = ? OR is_starter = 1)
    `).get(templateId, orgId) as Template | null
  }

  update(orgId: string, templateId: string, updates: Partial<TemplateInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description) }
    if (updates.category !== undefined) { sets.push('category = ?'); params.push(updates.category) }
    if (updates.subject !== undefined) { sets.push('subject = ?'); params.push(updates.subject) }
    if (updates.html_content !== undefined) {
      sets.push('html_content = ?')
      params.push(updates.html_content)
      sets.push('variables = ?')
      params.push(JSON.stringify(this.extractVariables(updates.html_content)))
    }
    if (updates.text_content !== undefined) { sets.push('text_content = ?'); params.push(updates.text_content) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    sets.push('version = version + 1')
    params.push(templateId, orgId)

    const result = this.db.prepare(`
      UPDATE templates SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params)

    return result.changes > 0
  }

  delete(orgId: string, templateId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM templates WHERE id = ? AND org_id = ? AND is_starter = 0
    `).run(templateId, orgId)
    return result.changes > 0
  }

  list(orgId: string, filters: TemplateFilters = {}): { templates: Template[]; total: number } {
    const page = filters.page || 1
    const limit = Math.min(filters.limit || 50, 200)
    const offset = (page - 1) * limit

    const conditions: string[] = ['(org_id = ? OR is_starter = 1)']
    const params: any[] = [orgId]

    if (filters.category) {
      conditions.push('category = ?')
      params.push(filters.category)
    }

    if (filters.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const q = `%${filters.search}%`
      params.push(q, q)
    }

    const where = conditions.join(' AND ')

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM templates WHERE ${where}`).get(...params) as any).count

    const templates = this.db.prepare(`
      SELECT * FROM templates WHERE ${where}
      ORDER BY is_starter DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Template[]

    return { templates, total }
  }

  // --------------------------------------------------------------------------
  // Operations
  // --------------------------------------------------------------------------

  duplicate(orgId: string, userId: string, templateId: string, newName: string): Template | null {
    const original = this.get(orgId, templateId)
    if (!original) return null

    return this.create(orgId, userId, {
      name: newName,
      description: original.description || undefined,
      category: original.category,
      subject: original.subject || undefined,
      html_content: original.html_content,
      text_content: original.text_content || undefined,
    })
  }

  /**
   * Render template with sample data for preview
   */
  renderPreview(html: string, data: Record<string, string>): string {
    let rendered = html
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      rendered = rendered.replace(regex, value)
    }
    // Replace any remaining placeholders with placeholder text
    rendered = rendered.replace(/\{\{(\w+)\}\}/g, '[$1]')
    return rendered
  }

  /**
   * Extract {{variable}} placeholders from HTML
   */
  extractVariables(html: string): string[] {
    const matches = html.match(/\{\{(\w+)\}\}/g)
    if (!matches) return []
    const vars = matches.map(m => m.replace(/\{\{|\}\}/g, ''))
    return [...new Set(vars)]
  }

  /**
   * Get starter templates only
   */
  getStarterTemplates(): Template[] {
    return this.db.prepare(`
      SELECT * FROM templates WHERE is_starter = 1 ORDER BY category, name
    `).all() as Template[]
  }

  // --------------------------------------------------------------------------
  // Multi-Language Support
  // --------------------------------------------------------------------------

  createTranslation(orgId: string, userId: string, templateId: string, language: string, input: TemplateInput): Template | null {
    const parent = this.get(orgId, templateId)
    if (!parent) return null

    const id = generateId('tpl')
    const variables = this.extractVariables(input.html_content)

    this.db.prepare(`
      INSERT INTO templates (id, org_id, user_id, name, description, category, subject, html_content, text_content, variables, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId,
      `${input.name} [${language.toUpperCase()}]`,
      input.description || `${language} translation of ${parent.name}`,
      parent.category,
      input.subject || parent.subject,
      input.html_content,
      input.text_content || null,
      JSON.stringify(variables),
      templateId
    )

    return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Template
  }

  getTranslations(orgId: string, templateId: string): Template[] {
    return this.db.prepare(`
      SELECT * FROM templates WHERE parent_id = ? AND (org_id = ? OR is_starter = 1)
      ORDER BY name ASC
    `).all(templateId, orgId) as Template[]
  }

  getTemplateForLanguage(orgId: string, templateId: string, language: string): Template | null {
    // Try to find translation matching the language code in the name suffix
    const langTag = `[${language.toUpperCase()}]`
    const translation = this.db.prepare(`
      SELECT * FROM templates WHERE parent_id = ? AND (org_id = ? OR is_starter = 1) AND name LIKE ?
    `).get(templateId, orgId, `%${langTag}`) as Template | null

    if (translation) return translation

    // Fallback to the original template
    return this.get(orgId, templateId)
  }

  // --------------------------------------------------------------------------
  // Reusable Template Sections
  // --------------------------------------------------------------------------

  createSection(orgId: string, userId: string, input: { name: string; category?: string; html_content: string }): any {
    const id = generateId('sec')
    this.db.prepare(`
      INSERT INTO template_sections (id, org_id, user_id, name, category, html_content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, orgId, userId, input.name, input.category || 'general', input.html_content)
    return this.db.prepare('SELECT * FROM template_sections WHERE id = ?').get(id)
  }

  listSections(orgId: string, category?: string): any[] {
    if (category) {
      return this.db.prepare('SELECT * FROM template_sections WHERE org_id = ? AND category = ? ORDER BY usage_count DESC, created_at DESC').all(orgId, category) as any[]
    }
    return this.db.prepare('SELECT * FROM template_sections WHERE org_id = ? ORDER BY usage_count DESC, created_at DESC').all(orgId) as any[]
  }

  getSection(orgId: string, sectionId: string): any {
    return this.db.prepare('SELECT * FROM template_sections WHERE id = ? AND org_id = ?').get(sectionId, orgId)
  }

  updateSection(orgId: string, sectionId: string, updates: { name?: string; category?: string; html_content?: string }): boolean {
    const sets: string[] = []
    const params: any[] = []
    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.category !== undefined) { sets.push('category = ?'); params.push(updates.category) }
    if (updates.html_content !== undefined) { sets.push('html_content = ?'); params.push(updates.html_content) }
    if (sets.length === 0) return false
    sets.push("updated_at = datetime('now')")
    params.push(sectionId, orgId)
    const result = this.db.prepare(`UPDATE template_sections SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).run(...params)
    return result.changes > 0
  }

  deleteSection(orgId: string, sectionId: string): boolean {
    const result = this.db.prepare('DELETE FROM template_sections WHERE id = ? AND org_id = ?').run(sectionId, orgId)
    return result.changes > 0
  }

  incrementSectionUsage(sectionId: string): void {
    this.db.prepare('UPDATE template_sections SET usage_count = usage_count + 1 WHERE id = ?').run(sectionId)
  }
}

export const templateService = new TemplateService()
