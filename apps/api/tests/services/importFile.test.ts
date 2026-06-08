// P5.4 net — import_history.file_key recording + org-scoped read (PGlite, no storage).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb, getDb } from '../../src/db/pg/client'
import { organizations, users, import_history } from '../../src/db/pg/schema'
import { contactService } from '../../src/services/contactService'

async function seed(orgId: string, userId: string) {
  await getDb().insert(organizations).values({ id: orgId, name: orgId, slug: orgId }).onConflictDoNothing()
  await getDb().insert(users).values({ id: userId, email: `${userId}@t.com`, name: userId, password_hash: 'x' }).onConflictDoNothing()
}

const result = { total: 2, imported: 2, duplicates: 0, invalid: 0, errors: [] }

// Fetch the inserted import row id for an org via a direct select (no reliance on the
// drizzle query API or a listImports helper).
async function importIdFor(orgId: string): Promise<string> {
  const [row] = await getDb().select().from(import_history).where(eq(import_history.org_id, orgId)).limit(1)
  return row!.id
}

describe('P5.4 — import file_key recording', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seed('org-a', 'user-a')
    await seed('org-b', 'user-b')
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('recordImport stores file_key and getImport returns it for the owning org', async () => {
    await contactService.recordImport('org-a', 'user-a', 'list-1', 'c.csv', 'csv', result, {}, 'imports/org-a/123_c.csv')
    const id = await importIdFor('org-a')
    expect(id).toBeTruthy()
    const row = await contactService.getImport('org-a', id)
    expect(row?.file_key).toBe('imports/org-a/123_c.csv')
  })

  it('getImport is org-scoped — org B cannot read org A’s import', async () => {
    await contactService.recordImport('org-a', 'user-a', 'list-1', 'c.csv', 'csv', result, {}, 'imports/org-a/k')
    const id = await importIdFor('org-a')
    expect(await contactService.getImport('org-b', id)).toBeNull()
  })
})
