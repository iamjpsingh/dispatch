// src/services/landingPageService.ts - Landing Page Management (Postgres/Drizzle, async)

import { and, eq, desc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { landing_pages } from '../db/pg/schema'
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

const now = () => new Date().toISOString()

function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ============================================================================
// Service
// ============================================================================

class LandingPageService {
  // --------------------------------------------------------------------------
  // Templates
  // --------------------------------------------------------------------------

  getTemplates(): { id: string; name: string }[] {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name }))
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: LandingPageInput): Promise<LandingPage> {
    const db = getDb()
    const id = generateId('pg')
    const slug = slugify(input.slug)

    // Check slug uniqueness within org
    const existing = await db
      .select({ id: landing_pages.id })
      .from(landing_pages)
      .where(and(eq(landing_pages.org_id, orgId), eq(landing_pages.slug, slug)))
      .limit(1)
    if (existing.length > 0) throw new Error(`Slug "${slug}" is already in use`)

    const template = TEMPLATES[input.template || 'lead_capture']
    const htmlContent = input.html_content || template?.html || ''
    const cssContent = input.css_content || template?.css || ''

    await db.insert(landing_pages).values({
      id,
      org_id: orgId,
      user_id: userId,
      slug,
      title: input.title,
      template: input.template || 'lead_capture',
      html_content: htmlContent,
      css_content: cssContent,
      meta_description: input.meta_description || null,
      meta_image: input.meta_image || null,
      form_id: input.form_id || null,
      tracking_enabled: input.tracking_enabled !== false ? 1 : 0,
    })

    const [row] = await db.select().from(landing_pages).where(eq(landing_pages.id, id)).limit(1)
    return row as LandingPage
  }

  async list(orgId: string): Promise<LandingPage[]> {
    const rows = await getDb()
      .select()
      .from(landing_pages)
      .where(eq(landing_pages.org_id, orgId))
      .orderBy(desc(landing_pages.created_at))
    return rows as LandingPage[]
  }

  async get(pageId: string): Promise<LandingPage | null> {
    const [row] = await getDb().select().from(landing_pages).where(eq(landing_pages.id, pageId)).limit(1)
    return (row as LandingPage) ?? null
  }

  async getBySlug(slug: string): Promise<LandingPage | null> {
    const [row] = await getDb()
      .select()
      .from(landing_pages)
      .where(and(eq(landing_pages.slug, slug), eq(landing_pages.published, 1)))
      .limit(1)
    return (row as LandingPage) ?? null
  }

  async update(orgId: string, pageId: string, updates: Partial<LandingPageInput>): Promise<boolean> {
    const values: Partial<typeof landing_pages.$inferInsert> = {}

    if (updates.title !== undefined) values.title = updates.title
    if (updates.slug !== undefined) {
      const slug = slugify(updates.slug)
      const existing = await getDb()
        .select({ id: landing_pages.id })
        .from(landing_pages)
        .where(and(eq(landing_pages.org_id, orgId), eq(landing_pages.slug, slug), sql`${landing_pages.id} != ${pageId}`))
        .limit(1)
      if (existing.length > 0) throw new Error(`Slug "${slug}" is already in use`)
      values.slug = slug
    }
    if (updates.html_content !== undefined) values.html_content = updates.html_content
    if (updates.css_content !== undefined) values.css_content = updates.css_content
    if (updates.meta_description !== undefined) values.meta_description = updates.meta_description
    if (updates.meta_image !== undefined) values.meta_image = updates.meta_image
    if (updates.form_id !== undefined) values.form_id = updates.form_id
    if (updates.tracking_enabled !== undefined) values.tracking_enabled = updates.tracking_enabled ? 1 : 0

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(landing_pages)
      .set(values)
      .where(and(eq(landing_pages.id, pageId), eq(landing_pages.org_id, orgId)))
      .returning({ id: landing_pages.id })
    return res.length > 0
  }

  async publish(orgId: string, pageId: string): Promise<boolean> {
    const res = await getDb()
      .update(landing_pages)
      .set({ published: 1, updated_at: now() })
      .where(and(eq(landing_pages.id, pageId), eq(landing_pages.org_id, orgId)))
      .returning({ id: landing_pages.id })
    return res.length > 0
  }

  async unpublish(orgId: string, pageId: string): Promise<boolean> {
    const res = await getDb()
      .update(landing_pages)
      .set({ published: 0, updated_at: now() })
      .where(and(eq(landing_pages.id, pageId), eq(landing_pages.org_id, orgId)))
      .returning({ id: landing_pages.id })
    return res.length > 0
  }

  async delete(orgId: string, pageId: string): Promise<boolean> {
    const res = await getDb()
      .delete(landing_pages)
      .where(and(eq(landing_pages.id, pageId), eq(landing_pages.org_id, orgId)))
      .returning({ id: landing_pages.id })
    return res.length > 0
  }

  async incrementVisits(pageId: string): Promise<void> {
    await getDb()
      .update(landing_pages)
      .set({ visit_count: sql`${landing_pages.visit_count} + 1` })
      .where(eq(landing_pages.id, pageId))
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
