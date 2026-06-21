import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { orgService } from '../../src/services/orgService'

const ORG = 'org_test'

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
