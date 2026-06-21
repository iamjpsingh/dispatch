import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, contacts, event_analytics } from '../../src/db/pg/schema'
import { orgService } from '../../src/services/orgService'
import { gdprService } from '../../src/services/gdprService'
import { assertSenderIdentity } from '../../src/utils/canspam'

const ORG = 'org_test'
const ORG2 = 'org_other'
const USER = 'usr_test'

describe('orgService sender identity', () => {
  let db: TestDb
  beforeEach(async () => {
    process.env.SUPPRESSION_HASH_SECRET = 'test-suppression-secret'
    db = await freshDbMigrated(); __setTestDb(db)
    await db.insert(organizations).values({ id: ORG, name: 'Acme', slug: 'acme' })
  }, 30_000)
  afterEach(() => __setTestDb(null))

  it('sets and reads sender identity and stamps postal_address_set_at', async () => {
    await orgService.setSenderIdentity(ORG, { sender_company_name: 'Acme Inc', postal_address: '1 A St, NY' })
    const id = await orgService.getSenderIdentity(ORG)
    expect(id.sender_company_name).toBe('Acme Inc')
    expect(id.postal_address).toBe('1 A St, NY')
    expect(id.postal_address_set_at).toBeTruthy()
  })
})

it('hard-gate throws without a postal address, passes with one', () => {
  expect(() => assertSenderIdentity({ postal_address: null })).toThrow()
  expect(() => assertSenderIdentity({ postal_address: '1 A St' })).not.toThrow()
})

describe('gdprService exportRecipient', () => {
  let db: TestDb
  beforeEach(async () => {
    process.env.SUPPRESSION_HASH_SECRET = 'test-suppression-secret'
    db = await freshDbMigrated(); __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Acme', slug: 'acme' },
      { id: ORG2, name: 'Other', slug: 'other' },
    ])
    await db.insert(users).values({ id: USER, email: 'user@test.com', name: 'Test', password_hash: 'x' })
    // contacts requires a list_id with a real FK — create a list row first
    await db.execute(`
      INSERT INTO contact_lists (id, org_id, user_id, name)
      VALUES ('l1', '${ORG}', '${USER}', 'Default')
    `)
    await db.insert(contacts).values({
      id: 'c1',
      org_id: ORG,
      user_id: USER,
      list_id: 'l1',
      email: 'p@q.r',
      status: 'active',
    } as any) // 'as any' because engagement_score has a default but Drizzle infers it required
    await db.insert(event_analytics).values({
      id: 'e1',
      org_id: ORG,
      user_id: USER,
      event_type: 'open',
      recipient_email: 'p@q.r',
    } as any) // org_id is nullable in schema but we supply it; as any for partial insert
  }, 30_000)
  afterEach(() => __setTestDb(null))

  it('exports a recipient bundle, org-scoped', async () => {
    const out = await gdprService.exportRecipient(ORG, 'c1')
    expect(out?.contact.email).toBe('p@q.r')
    expect(out?.events.length).toBe(1)
    // Cross-org: same contact id but different orgId → null
    expect(await gdprService.exportRecipient(ORG2, 'c1')).toBeNull()
  })
})
