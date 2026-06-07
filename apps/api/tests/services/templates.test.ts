// P2.3 net — templateService on real (PGlite) Postgres. Starter seeding, CRUD with
// org-or-starter visibility, versioning, translations, reusable sections, pure helpers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, templates } from '../../src/db/pg/schema'
import { templateService } from '../../src/services/templateService'

const ORG = 'org_tpl'
const ORG2 = 'org_tpl2'
const USER = 'usr_tpl'

const input = { name: 'T1', html_content: '<p>Hello {{FirstName}} from {{Company}}</p>' }

describe('P2.3 — templateService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org', slug: 'org-tpl' },
      { id: ORG2, name: 'Org2', slug: 'org-tpl2' },
    ])
    await db.insert(users).values({ id: USER, email: 't@x.com', name: 'T', password_hash: 'x' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('seeds starter templates idempotently (system, org_id null)', async () => {
    await templateService.seedStarterTemplates()
    await templateService.seedStarterTemplates() // no-op second time
    const starters = await templateService.getStarterTemplates()
    expect(starters.length).toBeGreaterThan(0)
    expect(starters.every((t) => t.is_starter === 1)).toBe(true)
    const all = await db.select().from(templates)
    expect(all.length).toBe(starters.length)
  })

  it('creates a template, extracts variables, reads back', async () => {
    const t = await templateService.create(ORG, USER, input)
    expect(t.name).toBe('T1')
    expect(t.version).toBe(1)
    expect(new Set(JSON.parse(t.variables))).toEqual(new Set(['FirstName', 'Company']))
    expect((await templateService.get(ORG, t.id))?.id).toBe(t.id)
  })

  it('starters are visible to any org; org templates are tenant-scoped', async () => {
    await templateService.seedStarterTemplates()
    const starter = (await templateService.getStarterTemplates())[0]
    expect((await templateService.get(ORG2, starter.id))?.id).toBe(starter.id) // cross-org starter visible
    const t = await templateService.create(ORG, USER, input)
    expect(await templateService.get(ORG2, t.id)).toBeNull() // other org cannot see it
  })

  it('update bumps version; cannot delete a starter', async () => {
    await templateService.seedStarterTemplates()
    const starter = (await templateService.getStarterTemplates())[0]
    expect(await templateService.delete(ORG, starter.id)).toBe(false) // is_starter gate
    const t = await templateService.create(ORG, USER, input)
    expect(await templateService.update(ORG, t.id, { name: 'T2', html_content: '<p>{{X}}</p>' })).toBe(true)
    const updated = await templateService.get(ORG, t.id)
    expect(updated?.name).toBe('T2')
    expect(updated?.version).toBe(2)
    expect(JSON.parse(updated!.variables)).toEqual(['X'])
    expect(await templateService.delete(ORG, t.id)).toBe(true)
  })

  it('lists org + starter templates with filters', async () => {
    await templateService.seedStarterTemplates()
    await templateService.create(ORG, USER, { ...input, category: 'newsletter' })
    const starterCount = (await templateService.getStarterTemplates()).length
    const all = await templateService.list(ORG)
    expect(all.total).toBe(starterCount + 1)
    const news = await templateService.list(ORG, { category: 'newsletter' })
    expect(news.templates.some((t) => t.name === 'T1')).toBe(true)
  })

  it('duplicates a template', async () => {
    const t = await templateService.create(ORG, USER, input)
    const dup = await templateService.duplicate(ORG, USER, t.id, 'T1 Copy')
    expect(dup?.name).toBe('T1 Copy')
    expect(dup?.html_content).toBe(t.html_content)
    expect(dup?.id).not.toBe(t.id)
  })

  it('creates and lists translations', async () => {
    const t = await templateService.create(ORG, USER, input)
    const fr = await templateService.createTranslation(ORG, USER, t.id, 'fr', { name: 'T1', html_content: '<p>Bonjour {{FirstName}}</p>' })
    expect(fr?.name).toBe('T1 [FR]')
    expect(fr?.parent_id).toBe(t.id)
    const translations = await templateService.getTranslations(ORG, t.id)
    expect(translations).toHaveLength(1)
    expect((await templateService.getTemplateForLanguage(ORG, t.id, 'fr'))?.id).toBe(fr!.id)
  })

  it('manages reusable sections incl. usage count', async () => {
    const sec = await templateService.createSection(ORG, USER, { name: 'Header', category: 'header', html_content: '<h1>Hi</h1>' })
    expect(sec.name).toBe('Header')
    expect((await templateService.listSections(ORG)).length).toBe(1)
    expect((await templateService.getSection(ORG, sec.id))?.id).toBe(sec.id)
    expect(await templateService.updateSection(ORG, sec.id, { name: 'Header 2' })).toBe(true)
    await templateService.incrementSectionUsage(sec.id)
    expect((await templateService.getSection(ORG, sec.id))?.usage_count).toBe(1)
    expect(await templateService.deleteSection(ORG, sec.id)).toBe(true)
    expect(await templateService.getSection(ORG, sec.id)).toBeFalsy()
  })

  it('renderPreview and extractVariables are pure (sync)', () => {
    expect(templateService.extractVariables('<p>{{A}} {{B}} {{A}}</p>')).toEqual(['A', 'B'])
    expect(templateService.renderPreview('Hi {{Name}}', { Name: 'Sam' })).toBe('Hi Sam')
    expect(templateService.renderPreview('Hi {{Missing}}', {})).toBe('Hi [Missing]')
  })
})
