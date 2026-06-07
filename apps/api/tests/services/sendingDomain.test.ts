// P2 net — sendingDomainService on real (PGlite) Postgres. Domain + sending-email
// CRUD, org/user scoping, verification, default-email exclusivity, the user-scoped
// join, the pure getDnsRecords helper, and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, sending_domains, sending_emails } from '../../src/db/pg/schema'
import { sendingDomainService } from '../../src/services/sendingDomainService'
import { eq } from 'drizzle-orm'

const ORG = 'org_d'
const ORG2 = 'org_d2'
const USER = 'usr_d'
const USER2 = 'usr_d2'

// org-keyed tables FK organizations; assigned_to (user_id) is loose text (no FK), so
// no users row is required.
describe('P2 — sendingDomainService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org D', slug: 'org-d' },
      { id: ORG2, name: 'Org D2', slug: 'org-d2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  // ---------- Domains ----------

  it('adds a domain (normalized, with DKIM selector + return path) and reads it back', async () => {
    const dom = await sendingDomainService.addDomain(ORG, '  Example.COM  ')
    expect(dom.domain).toBe('example.com') // lowercased + trimmed
    expect(dom.org_id).toBe(ORG)
    expect(dom.verification_status).toBe('pending') // default
    expect(dom.spf_included).toBe(0) // integer flag default
    expect(dom.dkim_selector).toMatch(/^dispatch\d+$/)
    expect(dom.return_path).toBe('bounce.example.com')
    expect(typeof dom.created_at).toBe('string') // ISO timestamp

    const got = await sendingDomainService.getDomain(ORG, dom.id)
    expect(got?.id).toBe(dom.id)
  })

  it('rejects duplicate domains within the same org', async () => {
    await sendingDomainService.addDomain(ORG, 'dup.com')
    await expect(sendingDomainService.addDomain(ORG, 'DUP.com')).rejects.toThrow(/already exists/)
    // but a different org may use the same domain name
    const other = await sendingDomainService.addDomain(ORG2, 'dup.com')
    expect(other.org_id).toBe(ORG2)
  })

  it('lists domains for the org only, newest first', async () => {
    const a = await sendingDomainService.addDomain(ORG, 'a.com')
    const b = await sendingDomainService.addDomain(ORG, 'b.com')
    await sendingDomainService.addDomain(ORG2, 'other.com')

    const list = await sendingDomainService.listDomains(ORG)
    expect(list).toHaveLength(2)
    expect(list.map((d) => d.id)).toEqual(expect.arrayContaining([a.id, b.id]))
    // wrong org cannot read this org's rows
    expect(await sendingDomainService.getDomain(ORG2, a.id)).toBeNull()
  })

  it('verifies a domain (sets status + verified_at, tenant-scoped)', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'verify.com')
    // wrong org cannot verify
    expect(await sendingDomainService.verifyDomain(ORG2, dom.id)).toBe(false)
    expect(await sendingDomainService.verifyDomain(ORG, dom.id)).toBe(true)

    const got = await sendingDomainService.getDomain(ORG, dom.id)
    expect(got?.verification_status).toBe('verified')
    expect(got?.verified_at).toBeTruthy()
  })

  it('deletes a domain (tenant-scoped) and cascades its emails', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'del.com')
    await sendingDomainService.addEmail(ORG, dom.id, 'hi@del.com')
    // wrong org cannot delete
    expect(await sendingDomainService.deleteDomain(ORG2, dom.id)).toBe(false)
    expect(await sendingDomainService.deleteDomain(ORG, dom.id)).toBe(true)
    expect(await sendingDomainService.getDomain(ORG, dom.id)).toBeNull()
    // FK cascade removed the email
    const emails = await db.select().from(sending_emails).where(eq(sending_emails.org_id, ORG))
    expect(emails).toHaveLength(0)
  })

  // ---------- Sending Emails ----------

  it('adds an email on a verified domain and reads it back', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'mail.com')
    const em = await sendingDomainService.addEmail(ORG, dom.id, 'Hello@mail.com', 'Hello Team', USER)
    expect(em.email).toBe('hello@mail.com') // lowercased
    expect(em.display_name).toBe('Hello Team')
    expect(em.assigned_to).toBe(USER)
    expect(em.is_default).toBe(0) // integer flag default
    expect(em.status).toBe('active') // default
    expect(em.domain_id).toBe(dom.id)
  })

  it('rejects an email whose domain mismatches or whose domain is missing', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'mine.com')
    await expect(sendingDomainService.addEmail(ORG, dom.id, 'x@other.com')).rejects.toThrow(/must be on domain mine.com/)
    await expect(sendingDomainService.addEmail(ORG, 'nope', 'x@mine.com')).rejects.toThrow(/Domain not found/)
    // domain belongs to a different org -> not found for this org
    await expect(sendingDomainService.addEmail(ORG2, dom.id, 'x@mine.com')).rejects.toThrow(/Domain not found/)
  })

  it('lists emails for the org, optionally filtered by domain', async () => {
    const d1 = await sendingDomainService.addDomain(ORG, 'one.com')
    const d2 = await sendingDomainService.addDomain(ORG, 'two.com')
    await sendingDomainService.addEmail(ORG, d1.id, 'a@one.com')
    await sendingDomainService.addEmail(ORG, d2.id, 'b@two.com')

    expect(await sendingDomainService.listEmails(ORG)).toHaveLength(2)
    const onlyD1 = await sendingDomainService.listEmails(ORG, d1.id)
    expect(onlyD1).toHaveLength(1)
    expect(onlyD1[0]!.email).toBe('a@one.com')
    // org scoping
    expect(await sendingDomainService.listEmails(ORG2)).toHaveLength(0)
  })

  it('updateEmail flips the single default within the org (exclusivity)', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'def.com')
    const e1 = await sendingDomainService.addEmail(ORG, dom.id, 'one@def.com')
    const e2 = await sendingDomainService.addEmail(ORG, dom.id, 'two@def.com')

    expect(await sendingDomainService.updateEmail(ORG, e1.id, { is_default: true })).toBe(true)
    let emails = await sendingDomainService.listEmails(ORG)
    expect(emails.find((e) => e.id === e1.id)!.is_default).toBe(1)
    expect(emails.find((e) => e.id === e2.id)!.is_default).toBe(0)

    // setting e2 default clears e1
    expect(await sendingDomainService.updateEmail(ORG, e2.id, { is_default: true, display_name: 'Two' })).toBe(true)
    emails = await sendingDomainService.listEmails(ORG)
    expect(emails.find((e) => e.id === e1.id)!.is_default).toBe(0)
    expect(emails.find((e) => e.id === e2.id)!.is_default).toBe(1)
    expect(emails.find((e) => e.id === e2.id)!.display_name).toBe('Two')

    // no fields -> false; wrong org -> false
    expect(await sendingDomainService.updateEmail(ORG, e1.id, {})).toBe(false)
    expect(await sendingDomainService.updateEmail(ORG2, e1.id, { display_name: 'X' })).toBe(false)
  })

  it('listEmailsForUser returns only active+verified emails visible to the user, default first', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'team.com')
    const everyone = await sendingDomainService.addEmail(ORG, dom.id, 'everyone@team.com') // assigned_to null
    const mine = await sendingDomainService.addEmail(ORG, dom.id, 'mine@team.com', undefined, USER)
    const theirs = await sendingDomainService.addEmail(ORG, dom.id, 'theirs@team.com', undefined, USER2)

    // unverified domain -> nothing shows yet
    expect(await sendingDomainService.listEmailsForUser(ORG, USER)).toHaveLength(0)

    await sendingDomainService.verifyDomain(ORG, dom.id)
    // make "mine" the default so it sorts first
    await sendingDomainService.updateEmail(ORG, mine.id, { is_default: true })

    const forUser = await sendingDomainService.listEmailsForUser(ORG, USER)
    const ids = forUser.map((e) => e.id)
    expect(ids).toContain(everyone.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id) // assigned to another user
    expect(forUser[0]!.id).toBe(mine.id) // is_default DESC
    // join columns are present on each row
    expect(forUser[0]!.domain).toBe('team.com')
    expect(forUser[0]!.verification_status).toBe('verified')
  })

  it('deletes an email (tenant-scoped)', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'rm.com')
    const em = await sendingDomainService.addEmail(ORG, dom.id, 'bye@rm.com')
    expect(await sendingDomainService.deleteEmail(ORG2, em.id)).toBe(false)
    expect(await sendingDomainService.deleteEmail(ORG, em.id)).toBe(true)
    expect(await sendingDomainService.listEmails(ORG)).toHaveLength(0)
  })

  // ---------- Pure helper ----------

  it('getDnsRecords is a pure synchronous helper that interpolates the domain', () => {
    const records = sendingDomainService.getDnsRecords({
      id: 'd', org_id: ORG, domain: 'pure.com', verification_status: 'pending',
      dkim_selector: null, dkim_record: null, spf_included: 0, return_path: null,
      verified_at: null, created_at: 'x', updated_at: 'x',
    })
    expect(records).toHaveLength(4)
    expect(records.find((r) => r.name === 'DMARC Record')!.value).toContain('pure.com')
  })

  // ---------- Postgres landing cross-check ----------

  it('lands rows in Postgres with the exact stored shape', async () => {
    const dom = await sendingDomainService.addDomain(ORG, 'land.com')
    await sendingDomainService.addEmail(ORG, dom.id, 'land@land.com', 'Land', USER)

    const [dRow] = await db.select().from(sending_domains).where(eq(sending_domains.id, dom.id)).limit(1)
    expect(dRow!.org_id).toBe(ORG)
    expect(dRow!.domain).toBe('land.com')
    expect(dRow!.spf_included).toBe(0) // integer column, not boolean
    expect(typeof dRow!.created_at).toBe('string')

    const [eRow] = await db.select().from(sending_emails).where(eq(sending_emails.org_id, ORG)).limit(1)
    expect(eRow!.email).toBe('land@land.com')
    expect(eRow!.is_default).toBe(0) // integer flag
    expect(eRow!.status).toBe('active')
    expect(eRow!.domain_id).toBe(dom.id)
  })
})
