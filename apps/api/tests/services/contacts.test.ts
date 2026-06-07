// P2.2 net — contactService on real (PGlite) Postgres. Exercises CRUD, filters,
// import dedup, dedup/merge, bulk ops, sending projection, and tenant isolation.
// Pre-swap the service owns ./data/contacts.db (sqlite) and ignores the injected db,
// so the "lands in Postgres" cross-checks + per-test isolation give a clean RED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, contacts } from '../../src/db/pg/schema'
import { contactService } from '../../src/services/contactService'

const ORG = 'org_c'
const ORG2 = 'org_c2'
const USER = 'usr_c'

async function seedTenants(db: TestDb) {
  await db.insert(organizations).values([
    { id: ORG, name: 'Org C', slug: 'org-c' },
    { id: ORG2, name: 'Org C2', slug: 'org-c2' },
  ])
  await db.insert(users).values({ id: USER, email: 'c@test.com', name: 'C', password_hash: 'x' })
}

describe('P2.2 — contactService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seedTenants(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a list and the row lands in Postgres', async () => {
    const list = await contactService.createList(ORG, USER, 'Newsletter', 'desc')
    expect(list.name).toBe('Newsletter')
    expect(list.org_id).toBe(ORG)
    // cross-check: it is actually in the injected Postgres db (RED anchor pre-swap)
    const rows = await db.select().from(contacts)
    expect(rows.length).toBe(0)
    const fetched = await contactService.getList(ORG, list.id)
    expect(fetched?.id).toBe(list.id)
  })

  it('adds a contact with defaults and reads it back', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    const c = await contactService.addContact(ORG, USER, list.id, { email: 'A@X.com' })
    expect(c.email).toBe('a@x.com') // lowercased
    expect(c.status).toBe('active')
    expect(c.engagement_score).toBe(50)
    expect(c.tags).toBe('[]')
    expect(c.custom_fields).toBe('{}')
    const got = await contactService.getContact(ORG, c.id)
    expect(got?.id).toBe(c.id)
  })

  it('enforces tenant isolation on reads', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    await contactService.addContact(ORG, USER, list.id, { email: 'a@x.com' })
    // org2 cannot see org1's list or its contacts
    expect(await contactService.getList(ORG2, list.id)).toBeNull()
    const { contacts: c2, total } = await contactService.getContacts(ORG2, list.id)
    expect(total).toBe(0)
    expect(c2).toEqual([])
  })

  it('getLists computes contact_count via subquery', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    await contactService.addContact(ORG, USER, list.id, { email: 'a@x.com' })
    await contactService.addContact(ORG, USER, list.id, { email: 'b@x.com' })
    const lists = await contactService.getLists(ORG)
    expect(lists).toHaveLength(1)
    expect(lists[0].contact_count).toBe(2)
  })

  it('filters by search, status, and paginates', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    await contactService.addContact(ORG, USER, list.id, { email: 'alice@x.com', first_name: 'Alice' })
    await contactService.addContact(ORG, USER, list.id, { email: 'bob@x.com', first_name: 'Bob', status: 'unsubscribed' })
    const search = await contactService.getContacts(ORG, list.id, { search: 'alice' })
    expect(search.total).toBe(1)
    expect(search.contacts[0].email).toBe('alice@x.com')
    const active = await contactService.getContacts(ORG, list.id, { status: 'active' })
    expect(active.total).toBe(1)
    const page = await contactService.getContacts(ORG, list.id, { limit: 1, page: 1 })
    expect(page.contacts).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('filters by tag case-insensitively (ilike, matching old SQLite LIKE)', async () => {
    const l = await contactService.createList(ORG, USER, 'L')
    await contactService.addContact(ORG, USER, l.id, { email: 'a@x.com', tags: ['VIP'] })
    await contactService.addContact(ORG, USER, l.id, { email: 'b@x.com', tags: ['other'] })
    const res = await contactService.getContacts(ORG, l.id, { tags: ['vip'] })
    expect(res.total).toBe(1)
    expect(res.contacts[0].email).toBe('a@x.com')
  })

  it('updates a contact and deletes by ids (tenant-scoped)', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    const c = await contactService.addContact(ORG, USER, list.id, { email: 'a@x.com' })
    expect(await contactService.updateContact(ORG, c.id, { first_name: 'Ann', tags: ['vip'] })).toBe(true)
    const got = await contactService.getContact(ORG, c.id)
    expect(got?.first_name).toBe('Ann')
    expect(JSON.parse(got!.tags)).toEqual(['vip'])
    // wrong org cannot delete
    expect(await contactService.deleteContacts(ORG2, [c.id])).toBe(0)
    expect(await contactService.deleteContacts(ORG, [c.id])).toBe(1)
    expect(await contactService.getContact(ORG, c.id)).toBeNull()
  })

  it('imports rows with dedup + invalid handling, and records history', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    const rows = [
      { Email: 'one@x.com', First: 'One' },
      { Email: 'two@x.com', First: 'Two' },
      { Email: 'one@x.com', First: 'Dup' }, // duplicate
      { Email: 'not-an-email', First: 'Bad' }, // invalid
    ]
    const mapping = { Email: 'email', First: 'first_name' }
    const res = await contactService.importContacts(ORG, USER, list.id, rows, mapping)
    expect(res.total).toBe(4)
    expect(res.imported).toBe(2)
    expect(res.duplicates).toBe(1)
    expect(res.invalid).toBe(1)
    await contactService.recordImport(ORG, USER, list.id, 'f.csv', 'csv', res, mapping)
    const history = await contactService.getImportHistory(ORG)
    expect(history).toHaveLength(1)
    expect(history[0].imported).toBe(2)
  })

  it('getContactsForSending returns only active contacts in projected shape', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    await contactService.addContact(ORG, USER, list.id, { email: 'a@x.com', first_name: 'A', company: 'Acme' })
    await contactService.addContact(ORG, USER, list.id, { email: 'b@x.com', status: 'unsubscribed' })
    const sending = await contactService.getContactsForSending(ORG, list.id)
    expect(sending).toHaveLength(1)
    expect(sending[0]).toMatchObject({ Email: 'a@x.com', FirstName: 'A', Company: 'Acme' })
  })

  it('tags and moves contacts in bulk', async () => {
    const l1 = await contactService.createList(ORG, USER, 'L1')
    const l2 = await contactService.createList(ORG, USER, 'L2')
    const a = await contactService.addContact(ORG, USER, l1.id, { email: 'a@x.com', tags: ['x'] })
    const tagged = await contactService.tagContacts(ORG, [a.id], ['y'])
    expect(tagged).toBe(1)
    const got = await contactService.getContact(ORG, a.id)
    expect(new Set(JSON.parse(got!.tags))).toEqual(new Set(['x', 'y']))
    const moved = await contactService.moveContacts(ORG, [a.id], l2.id)
    expect(moved).toBe(1)
    const inL2 = await contactService.getContacts(ORG, l2.id)
    expect(inL2.total).toBe(1)
  })

  it('finds duplicates across lists and merges them', async () => {
    const l1 = await contactService.createList(ORG, USER, 'L1')
    const l2 = await contactService.createList(ORG, USER, 'L2')
    const a = await contactService.addContact(ORG, USER, l1.id, { email: 'dup@x.com', first_name: 'A' })
    const b = await contactService.addContact(ORG, USER, l2.id, { email: 'dup@x.com', company: 'Acme' })
    const dups = await contactService.findDuplicates(ORG)
    expect(dups).toHaveLength(1)
    expect(dups[0].email).toBe('dup@x.com')
    expect(dups[0].count).toBe(2)
    const merged = await contactService.mergeContacts(ORG, a.id, [b.id])
    expect(merged).toBe(true)
    expect(await contactService.getContact(ORG, b.id)).toBeNull()
    const primary = await contactService.getContact(ORG, a.id)
    expect(primary?.company).toBe('Acme') // merged non-empty value
  })

  it('mergeContacts picks the chronologically newest across mixed timestamp formats', async () => {
    const l = await contactService.createList(ORG, USER, 'L')
    // `a` gets an explicit ISO-format updated_at (via update), earlier in time
    const a = await contactService.addContact(ORG, USER, l.id, { email: 'a@x.com' })
    await contactService.updateContact(ORG, a.id, { company: 'OldCo' })
    await new Promise((r) => setTimeout(r, 50))
    // `b` is created later (DB-native timestamp format) — it is the true newest
    const b = await contactService.addContact(ORG, USER, l.id, { email: 'b@x.com', company: 'NewCo' })
    await contactService.mergeContacts(ORG, a.id, [b.id])
    const merged = await contactService.getContact(ORG, a.id)
    // b is newest, so its non-empty company must win (a localeCompare on raw
    // strings would wrongly pick the ISO-formatted `a` because 'T' > ' ').
    expect(merged?.company).toBe('NewCo')
  })

  it('cascades contacts when their list is deleted (FK)', async () => {
    const list = await contactService.createList(ORG, USER, 'L')
    const c = await contactService.addContact(ORG, USER, list.id, { email: 'a@x.com' })
    expect(await contactService.deleteList(ORG, list.id)).toBe(true)
    const rows = await db.select().from(contacts)
    expect(rows.find((r) => r.id === c.id)).toBeUndefined()
  })
})
