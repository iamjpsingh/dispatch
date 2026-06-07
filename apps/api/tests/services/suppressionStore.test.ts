// P4.B net — suppressionStore: PG-backed suppression list (async, user-scoped,
// email lowercased, idempotent). Mirrors the retired SQLite contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { suppressionStore } from '../../src/services/queue/suppressionStore'

describe('P4.B — suppressionStore (Postgres)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('suppress then isSuppressed is true; lowercases the email', async () => {
    await suppressionStore.suppress('user-1', 'Bad@Example.com', 'manual')
    expect(await suppressionStore.isSuppressed('user-1', 'bad@example.com')).toBe(true)
    expect(await suppressionStore.isSuppressed('user-1', 'BAD@EXAMPLE.COM')).toBe(true)
  })

  it('is scoped to the user', async () => {
    await suppressionStore.suppress('user-1', 'x@example.com', 'manual')
    expect(await suppressionStore.isSuppressed('user-2', 'x@example.com')).toBe(false)
  })

  it('is idempotent on repeated suppress (no throw, single row)', async () => {
    await suppressionStore.suppress('user-1', 'dup@example.com', 'manual')
    await suppressionStore.suppress('user-1', 'dup@example.com', 'bounce')
    const list = await suppressionStore.getSuppressionList('user-1')
    expect(list.filter((r) => r.email === 'dup@example.com')).toHaveLength(1)
  })

  it('unsuppress removes and reports whether a row was deleted', async () => {
    await suppressionStore.suppress('user-1', 'gone@example.com', 'manual')
    expect(await suppressionStore.unsuppress('user-1', 'gone@example.com')).toBe(true)
    expect(await suppressionStore.isSuppressed('user-1', 'gone@example.com')).toBe(false)
    expect(await suppressionStore.unsuppress('user-1', 'gone@example.com')).toBe(false)
  })

  it('getSuppressionList returns the user rows', async () => {
    await suppressionStore.suppress('user-1', 'a@example.com', 'manual')
    await suppressionStore.suppress('user-1', 'b@example.com', 'manual')
    const list = await suppressionStore.getSuppressionList('user-1')
    expect(list.map((r) => r.email).sort()).toEqual(['a@example.com', 'b@example.com'])
  })
})
