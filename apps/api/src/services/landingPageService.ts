// src/services/landingPageService.ts - Landing Page Management

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface LandingPage {
  id: string
  org_id: string
  user_id: string
  slug: string
  title: string
  template: string
  html_content: string
  css_content: string
  meta_description: string | null
  meta_image: string | null
  form_id: string | null
  tracking_enabled: number
  published: number
  visit_count: number
  created_at: string
  updated_at: string
}

export interface LandingPageInput {
  title: string
  slug: string
  template?: string
  html_content: string
  css_content?: string
  meta_description?: string
  meta_image?: string
  form_id?: string
  tracking_enabled?: boolean
}

// ============================================================================
// Templates
// ============================================================================

const TEMPLATES: Record<string, { name: string; html: string; css: string }> = {
  lead_capture: {
    name: 'Lead Capture',
    html: `<div class="hero">
  <h1>Get Started Today</h1>
  <p>Sign up for our newsletter and get exclusive updates.</p>
  <div id="dispatch-form"></div>
</div>`,
    css: `.hero{text-align:center;padding:80px 20px;max-width:600px;margin:0 auto}
h1{font-size:36px;margin-bottom:16px}p{font-size:18px;color:#555;margin-bottom:32px}`,
  },
  webinar: {
    name: 'Webinar Registration',
    html: `<div class="page">
  <div class="details">
    <span class="badge">Live Webinar</span>
    <h1>Webinar Title</h1>
    <p class="desc">Join us for an insightful session about...</p>
    <ul>
      <li>Key takeaway 1</li>
      <li>Key takeaway 2</li>
      <li>Key takeaway 3</li>
    </ul>
  </div>
  <div class="form-section">
    <h2>Register Now</h2>
    <div id="dispatch-form"></div>
  </div>
</div>`,
    css: `.page{display:flex;gap:40px;padding:60px 20px;max-width:960px;margin:0 auto;flex-wrap:wrap}
.details{flex:1;min-width:300px}.form-section{flex:1;min-width:300px}
.badge{background:#3b82f6;color:#fff;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600}
h1{font-size:32px;margin:16px 0}h2{font-size:22px;margin-bottom:16px}
.desc{color:#555;font-size:16px;line-height:1.6}ul{padding-left:20px;line-height:2}`,
  },
  coming_soon: {
    name: 'Coming Soon',
    html: `<div class="center">
  <h1>Something Big is Coming</h1>
  <p>Be the first to know when we launch.</p>
  <div id="dispatch-form"></div>
</div>`,
    css: `.center{text-align:center;padding:120px 20px;max-width:500px;margin:0 auto}
h1{font-size:40px;margin-bottom:16px}p{font-size:18px;color:#666;margin-bottom:40px}`,
  },
  thank_you: {
    name: 'Thank You',
    html: `<div class="center">
  <div class="check">&#10003;</div>
  <h1>Thank You!</h1>
  <p>Your submission has been received. We'll be in touch soon.</p>
</div>`,
    css: `.center{text-align:center;padding:100px 20px;max-width:500px;margin:0 auto}
.check{width:64px;height:64px;background:#22c55e;color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:24px}
h1{font-size:30px;margin-bottom:12px}p{font-size:16px;color:#555}`,
  },
}

// ============================================================================
// Service
// ============================================================================

class LandingPageService {
  private db: Database

  constructor() {
    const dbPath = './data/pages.db'
    const dbDir = dirname(dbPath)
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landing_pages (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'lead_capture',
        html_content TEXT NOT NULL DEFAULT '',
        css_content TEXT NOT NULL DEFAULT '',
        meta_description TEXT,
        meta_image TEXT,
        form_id TEXT,
        tracking_enabled INTEGER DEFAULT 1,
        published INTEGER DEFAULT 0,
        visit_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_lp_org ON landing_pages(org_id);
      CREATE INDEX IF NOT EXISTS idx_lp_slug ON landing_pages(slug);
      CREATE INDEX IF NOT EXISTS idx_lp_published ON landing_pages(published);
    `)
  }

  // --------------------------------------------------------------------------
  // Templates
  // --------------------------------------------------------------------------

  getTemplates(): { id: string; name: string }[] {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name }))
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: LandingPageInput): LandingPage {
    const id = generateId('pg')
    const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    // Check slug uniqueness within org
    const existing = this.db.prepare('SELECT id FROM landing_pages WHERE org_id = ? AND slug = ?').get(orgId, slug)
    if (existing) throw new Error(`Slug "${slug}" is already in use`)

    const template = TEMPLATES[input.template || 'lead_capture']
    const htmlContent = input.html_content || template?.html || ''
    const cssContent = input.css_content || template?.css || ''

    this.db.prepare(`
      INSERT INTO landing_pages (id, org_id, user_id, slug, title, template, html_content, css_content, meta_description, meta_image, form_id, tracking_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, slug,
      input.title,
      input.template || 'lead_capture',
      htmlContent,
      cssContent,
      input.meta_description || null,
      input.meta_image || null,
      input.form_id || null,
      input.tracking_enabled !== false ? 1 : 0
    )

    return this.db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(id) as LandingPage
  }

  list(orgId: string): LandingPage[] {
    return this.db.prepare('SELECT * FROM landing_pages WHERE org_id = ? ORDER BY created_at DESC').all(orgId) as LandingPage[]
  }

  get(pageId: string): LandingPage | null {
    return this.db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(pageId) as LandingPage | null
  }

  getBySlug(slug: string): LandingPage | null {
    return this.db.prepare('SELECT * FROM landing_pages WHERE slug = ? AND published = 1').get(slug) as LandingPage | null
  }

  update(orgId: string, pageId: string, updates: Partial<LandingPageInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title) }
    if (updates.slug !== undefined) {
      const slug = updates.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      const existing = this.db.prepare('SELECT id FROM landing_pages WHERE org_id = ? AND slug = ? AND id != ?').get(orgId, slug, pageId)
      if (existing) throw new Error(`Slug "${slug}" is already in use`)
      sets.push('slug = ?'); params.push(slug)
    }
    if (updates.html_content !== undefined) { sets.push('html_content = ?'); params.push(updates.html_content) }
    if (updates.css_content !== undefined) { sets.push('css_content = ?'); params.push(updates.css_content) }
    if (updates.meta_description !== undefined) { sets.push('meta_description = ?'); params.push(updates.meta_description) }
    if (updates.meta_image !== undefined) { sets.push('meta_image = ?'); params.push(updates.meta_image) }
    if (updates.form_id !== undefined) { sets.push('form_id = ?'); params.push(updates.form_id) }
    if (updates.tracking_enabled !== undefined) { sets.push('tracking_enabled = ?'); params.push(updates.tracking_enabled ? 1 : 0) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(pageId, orgId)

    const result = this.db.prepare(`
      UPDATE landing_pages SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params)
    return result.changes > 0
  }

  publish(orgId: string, pageId: string): boolean {
    const result = this.db.prepare(
      "UPDATE landing_pages SET published = 1, updated_at = datetime('now') WHERE id = ? AND org_id = ?"
    ).run(pageId, orgId)
    return result.changes > 0
  }

  unpublish(orgId: string, pageId: string): boolean {
    const result = this.db.prepare(
      "UPDATE landing_pages SET published = 0, updated_at = datetime('now') WHERE id = ? AND org_id = ?"
    ).run(pageId, orgId)
    return result.changes > 0
  }

  delete(orgId: string, pageId: string): boolean {
    const result = this.db.prepare('DELETE FROM landing_pages WHERE id = ? AND org_id = ?').run(pageId, orgId)
    return result.changes > 0
  }

  incrementVisits(pageId: string): void {
    this.db.prepare('UPDATE landing_pages SET visit_count = visit_count + 1 WHERE id = ?').run(pageId)
  }

  // --------------------------------------------------------------------------
  // Render Full Page HTML
  // --------------------------------------------------------------------------

  renderPage(page: LandingPage, workerUrl?: string): string {
    let formEmbed = ''
    if (page.form_id && workerUrl) {
      formEmbed = `<script src="${workerUrl}/f/${page.form_id}.js"></script>`
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  ${page.meta_description ? `<meta name="description" content="${escapeHtml(page.meta_description)}">` : ''}
  ${page.meta_image ? `<meta property="og:image" content="${escapeHtml(page.meta_image)}">` : ''}
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;background:#fff;line-height:1.6}
    a{color:#3b82f6}
    ${page.css_content}
  </style>
</head>
<body>
  ${page.html_content}
  ${formEmbed}
</body>
</html>`
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const landingPageService = new LandingPageService()
