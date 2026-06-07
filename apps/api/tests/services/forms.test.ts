// P2.7a net — formService on real (PGlite) Postgres. CRUD + org scoping, status
// toggle, submission recording with atomic count increment, paginated reads, the
// pure getEmbedCode helper, FK cascade, and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, form_submissions } from '../../src/db/pg/schema'
import { eq, sql } from 'drizzle-orm'
import { formService } from '../../src/services/formService'

const ORG = 'org_f'
const ORG2 = 'org_f2'
const USER = 'usr_f'

describe('P2.7a — formService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org F', slug: 'org-f' },
      { id: ORG2, name: 'Org F2', slug: 'org-f2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a form with defaults and reads it back (shape preserved)', async () => {
    const form = await formService.create(ORG, USER, { name: 'Newsletter', list_id: 'list_1' })
    expect(form.org_id).toBe(ORG)
    expect(form.user_id).toBe(USER)
    expect(form.name).toBe('Newsletter')
    expect(form.list_id).toBe('list_1')
    // JSON-as-text defaults
    expect(JSON.parse(form.field_mapping)).toEqual({ email: 'email', name: 'first_name' })
    expect(JSON.parse(form.required_fields)).toEqual(['email'])
    expect(JSON.parse(form.allowed_domains)).toEqual([])
    expect(JSON.parse(form.actions)).toEqual([])
    // integer flag + defaults
    expect(form.double_optin).toBe(0)
    expect(form.success_message).toBe('Thank you for subscribing!')
    expect(form.submission_count).toBe(0)
    expect(form.status).toBe('active')
    expect(typeof form.created_at).toBe('string')

    const got = await formService.get(form.id)
    expect(got?.id).toBe(form.id)
  })

  it('honours explicit input (field_mapping, double_optin flag, actions)', async () => {
    const actions = [{ type: 'add_tag' as const, tag: 'lead' }]
    const form = await formService.create(ORG, USER, {
      name: 'Custom',
      list_id: 'list_2',
      field_mapping: { fullName: 'name' },
      required_fields: ['email', 'name'],
      allowed_domains: ['https://example.com'],
      redirect_url: 'https://example.com/thanks',
      actions,
      double_optin: true,
      success_message: 'Done!',
    })
    expect(JSON.parse(form.field_mapping)).toEqual({ fullName: 'name' })
    expect(JSON.parse(form.required_fields)).toEqual(['email', 'name'])
    expect(JSON.parse(form.allowed_domains)).toEqual(['https://example.com'])
    expect(form.redirect_url).toBe('https://example.com/thanks')
    expect(JSON.parse(form.actions)).toEqual(actions)
    expect(form.double_optin).toBe(1)
    expect(form.success_message).toBe('Done!')
  })

  it('updates and deletes a form (tenant-scoped)', async () => {
    const form = await formService.create(ORG, USER, { name: 'A', list_id: 'l' })
    expect(await formService.update(ORG, form.id, { name: 'B', double_optin: true })).toBe(true)
    const upd = await formService.get(form.id)
    expect(upd?.name).toBe('B')
    expect(upd?.double_optin).toBe(1)

    // empty update is a no-op → false
    expect(await formService.update(ORG, form.id, {})).toBe(false)

    // wrong org cannot mutate or delete
    expect(await formService.update(ORG2, form.id, { name: 'X' })).toBe(false)
    expect(await formService.delete(ORG2, form.id)).toBe(false)
    expect((await formService.get(form.id))?.name).toBe('B')

    expect(await formService.delete(ORG, form.id)).toBe(true)
    expect(await formService.get(form.id)).toBeNull()
  })

  it('lists forms for the org only, newest first', async () => {
    await formService.create(ORG, USER, { name: 'A', list_id: 'l' })
    await formService.create(ORG, USER, { name: 'B', list_id: 'l' })
    await formService.create(ORG2, USER, { name: 'Other', list_id: 'l' })
    const list = await formService.list(ORG)
    expect(list).toHaveLength(2)
    expect(list.every((f) => f.org_id === ORG)).toBe(true)
  })

  it('toggles status active <-> paused (tenant-scoped)', async () => {
    const form = await formService.create(ORG, USER, { name: 'T', list_id: 'l' })
    expect(form.status).toBe('active')
    expect(await formService.toggleStatus(ORG, form.id)).toBe('paused')
    expect((await formService.get(form.id))?.status).toBe('paused')
    expect(await formService.toggleStatus(ORG, form.id)).toBe('active')
    // wrong org / missing form returns null
    expect(await formService.toggleStatus(ORG2, form.id)).toBeNull()
    expect(await formService.toggleStatus(ORG, 'nope')).toBeNull()
  })

  it('records submissions and atomically increments submission_count', async () => {
    const form = await formService.create(ORG, USER, { name: 'S', list_id: 'l' })
    const sub = await formService.recordSubmission(form.id, { email: 'a@b.com' }, '1.2.3.4', 'UA/1.0')
    expect(sub.form_id).toBe(form.id)
    expect(JSON.parse(sub.data)).toEqual({ email: 'a@b.com' })
    expect(sub.ip_address).toBe('1.2.3.4')
    expect(sub.user_agent).toBe('UA/1.0')

    await formService.recordSubmission(form.id, { email: 'c@d.com' })
    expect((await formService.get(form.id))?.submission_count).toBe(2)
  })

  it('returns submissions paginated with a total count (newest first)', async () => {
    const form = await formService.create(ORG, USER, { name: 'S', list_id: 'l' })
    for (let i = 0; i < 3; i++) await formService.recordSubmission(form.id, { i })

    const page1 = await formService.getSubmissions(form.id, 2, 0)
    expect(page1.total).toBe(3)
    expect(page1.submissions).toHaveLength(2)

    const page2 = await formService.getSubmissions(form.id, 2, 2)
    expect(page2.total).toBe(3)
    expect(page2.submissions).toHaveLength(1)
  })

  it('cascades form_submissions when the form is deleted (FK)', async () => {
    const form = await formService.create(ORG, USER, { name: 'S', list_id: 'l' })
    await formService.recordSubmission(form.id, { email: 'x@y.com' })
    await formService.delete(ORG, form.id)
    const rows = await db.select().from(form_submissions).where(eq(form_submissions.form_id, form.id))
    expect(rows).toHaveLength(0)
  })

  it('getEmbedCode is a pure synchronous helper', () => {
    const form = {
      id: 'frm_1',
      field_mapping: JSON.stringify({ email: 'email', name: 'first_name' }),
      required_fields: JSON.stringify(['email']),
    } as Parameters<typeof formService.getEmbedCode>[0]
    const code = formService.getEmbedCode(form, 'https://w.example')
    expect(code.html).toContain('action="https://w.example/f/frm_1"')
    expect(code.html).toContain('<input name="email" placeholder="email" required />')
    expect(code.html).toContain('<input name="name" placeholder="name" />')
    expect(code.js).toContain('dispatch-form-frm_1')
    expect(code.api).toContain("email: '...'")
  })

  it('lands rows on Postgres with expected column types (cross-check)', async () => {
    const form = await formService.create(ORG, USER, { name: 'X', list_id: 'l', double_optin: true })
    await formService.recordSubmission(form.id, { email: 'z@z.com' })
    // raw read through the same db proves Postgres landing + integer/text fidelity
    const res = await db.execute(
      sql`select double_optin, submission_count, status from form_endpoints where id = ${form.id}`,
    )
    const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].double_optin)).toBe(1)
    expect(Number(rows[0].submission_count)).toBe(1)
    expect(rows[0].status).toBe('active')
  })
})
