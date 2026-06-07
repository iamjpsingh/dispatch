// landingPageService net — Drizzle/PGlite. CRUD, slug uniqueness/normalization,
// org scoping, publish gates, atomic visit increment, and a raw Postgres cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { sql } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { landingPageService } from '../../src/services/landingPageService'

const ORG = 'org_lp'
const ORG2 = 'org_lp2'
const USER = 'usr_lp'

describe('landingPageService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org LP', slug: 'org-lp' },
      { id: ORG2, name: 'Org LP2', slug: 'org-lp2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('getTemplates is a pure synchronous helper', () => {
    const templates = landingPageService.getTemplates()
    expect(templates.find((t) => t.id === 'lead_capture')?.name).toBe('Lead Capture')
    expect(templates.length).toBeGreaterThan(0)
  })

  it('creates a page with defaults, normalizes the slug, and reads it back', async () => {
    const page = await landingPageService.create(ORG, USER, {
      title: 'Launch',
      slug: 'My Cool Page!!',
      html_content: '',
    })
    expect(page.org_id).toBe(ORG)
    expect(page.user_id).toBe(USER)
    expect(page.slug).toBe('my-cool-page') // lowercased, non-alnum -> '-', collapsed, trimmed
    expect(page.template).toBe('lead_capture') // default
    expect(page.tracking_enabled).toBe(1) // default flag (integer)
    expect(page.published).toBe(0)
    expect(page.visit_count).toBe(0)
    // empty html_content falls back to the template body
    expect(page.html_content).toContain('dispatch-form')
    expect(page.css_content.length).toBeGreaterThan(0)

    const got = await landingPageService.get(page.id)
    expect(got?.id).toBe(page.id)
  })

  it('honors explicit content and tracking_enabled=false', async () => {
    const page = await landingPageService.create(ORG, USER, {
      title: 'Custom',
      slug: 'custom',
      template: 'webinar',
      html_content: '<h1>Hi</h1>',
      css_content: 'h1{color:red}',
      tracking_enabled: false,
    })
    expect(page.template).toBe('webinar')
    expect(page.html_content).toBe('<h1>Hi</h1>')
    expect(page.css_content).toBe('h1{color:red}')
    expect(page.tracking_enabled).toBe(0)
  })

  it('rejects a duplicate slug within the same org', async () => {
    await landingPageService.create(ORG, USER, { title: 'A', slug: 'dup', html_content: 'x' })
    await expect(
      landingPageService.create(ORG, USER, { title: 'B', slug: 'DUP', html_content: 'y' })
    ).rejects.toThrow(/already in use/)
    // same slug in a different org is allowed (UNIQUE is per org)
    const other = await landingPageService.create(ORG2, USER, { title: 'C', slug: 'dup', html_content: 'z' })
    expect(other.slug).toBe('dup')
  })

  it('lists pages for the org only, newest first', async () => {
    const a = await landingPageService.create(ORG, USER, { title: 'A', slug: 'a', html_content: 'x' })
    const b = await landingPageService.create(ORG, USER, { title: 'B', slug: 'b', html_content: 'x' })
    await landingPageService.create(ORG2, USER, { title: 'Other', slug: 'other', html_content: 'x' })
    // force a distinct created_at ordering so DESC is deterministic
    await db.update((await import('../../src/db/pg/schema')).landing_pages)
      .set({ created_at: '2020-01-01T00:00:00.000Z' })
      .where(sql`id = ${a.id}`)

    const list = await landingPageService.list(ORG)
    expect(list).toHaveLength(2)
    expect(list.every((p) => p.org_id === ORG)).toBe(true)
    expect(list[0].id).toBe(b.id) // newest first
  })

  it('updates fields, normalizes slug on update, and is org-scoped', async () => {
    const page = await landingPageService.create(ORG, USER, { title: 'A', slug: 'a', html_content: 'x' })

    expect(await landingPageService.update(ORG, page.id, { title: 'B', slug: 'New Slug', tracking_enabled: false })).toBe(true)
    const got = await landingPageService.get(page.id)
    expect(got?.title).toBe('B')
    expect(got?.slug).toBe('new-slug')
    expect(got?.tracking_enabled).toBe(0)

    // empty updates -> false
    expect(await landingPageService.update(ORG, page.id, {})).toBe(false)
    // wrong org cannot mutate
    expect(await landingPageService.update(ORG2, page.id, { title: 'X' })).toBe(false)
    expect((await landingPageService.get(page.id))?.title).toBe('B')
  })

  it('rejects an update slug that collides with another page in the org', async () => {
    await landingPageService.create(ORG, USER, { title: 'A', slug: 'taken', html_content: 'x' })
    const b = await landingPageService.create(ORG, USER, { title: 'B', slug: 'free', html_content: 'x' })
    await expect(landingPageService.update(ORG, b.id, { slug: 'taken' })).rejects.toThrow(/already in use/)
    // updating a page to its own slug is fine (id != self exclusion)
    expect(await landingPageService.update(ORG, b.id, { slug: 'free' })).toBe(true)
  })

  it('publish/unpublish gates getBySlug and is org-scoped', async () => {
    const page = await landingPageService.create(ORG, USER, { title: 'P', slug: 'pub', html_content: 'x' })
    expect(await landingPageService.getBySlug('pub')).toBeNull() // unpublished -> not visible

    // wrong org cannot publish
    expect(await landingPageService.publish(ORG2, page.id)).toBe(false)
    expect(await landingPageService.publish(ORG, page.id)).toBe(true)
    expect((await landingPageService.getBySlug('pub'))?.id).toBe(page.id)
    expect((await landingPageService.get(page.id))?.published).toBe(1)

    expect(await landingPageService.unpublish(ORG, page.id)).toBe(true)
    expect(await landingPageService.getBySlug('pub')).toBeNull()
  })

  it('increments visit_count atomically and unscoped by org', async () => {
    const page = await landingPageService.create(ORG, USER, { title: 'V', slug: 'v', html_content: 'x' })
    await landingPageService.incrementVisits(page.id)
    await landingPageService.incrementVisits(page.id)
    expect((await landingPageService.get(page.id))?.visit_count).toBe(2)
  })

  it('deletes a page (org-scoped)', async () => {
    const page = await landingPageService.create(ORG, USER, { title: 'D', slug: 'd', html_content: 'x' })
    expect(await landingPageService.delete(ORG2, page.id)).toBe(false)
    expect(await landingPageService.delete(ORG, page.id)).toBe(true)
    expect(await landingPageService.get(page.id)).toBeNull()
  })

  it('renderPage is pure and embeds form + escapes title', () => {
    const page = {
      id: 'pg_1', org_id: ORG, user_id: USER, slug: 's',
      title: 'A & B <x>', template: 'lead_capture',
      html_content: '<div>body</div>', css_content: '.x{}',
      meta_description: null, meta_image: null, form_id: 'frm_1',
      tracking_enabled: 1, published: 1, visit_count: 0,
      created_at: 'now', updated_at: 'now',
    }
    const html = landingPageService.renderPage(page, 'https://w.example')
    expect(html).toContain('A &amp; B &lt;x&gt;')
    expect(html).toContain('<script src="https://w.example/f/frm_1.js">')
    expect(html).toContain('<div>body</div>')
  })

  it('cross-check: raw Postgres sees the inserted row with FK org and integer flags', async () => {
    const page = await landingPageService.create(ORG, USER, {
      title: 'Raw', slug: 'raw', html_content: 'x', tracking_enabled: false,
    })
    const res = await db.execute(
      sql`select org_id, published, tracking_enabled, visit_count from landing_pages where id = ${page.id}`
    )
    const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].org_id).toBe(ORG)
    expect(Number(rows[0].published)).toBe(0)
    expect(Number(rows[0].tracking_enabled)).toBe(0)
    expect(Number(rows[0].visit_count)).toBe(0)
  })
})
