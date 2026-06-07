// P2.2 net — segmentService on real (PGlite) Postgres. CRUD, static membership,
// contact_count maintenance, tenant isolation, and the pure buildQuery helper.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users } from '../../src/db/pg/schema'
import { segmentService } from '../../src/services/segmentService'

const ORG = 'org_s'
const ORG2 = 'org_s2'
const USER = 'usr_s'

describe('P2.2 — segmentService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org S', slug: 'org-s' },
      { id: ORG2, name: 'Org S2', slug: 'org-s2' },
    ])
    await db.insert(users).values({ id: USER, email: 's@test.com', name: 'S', password_hash: 'x' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a segment with defaults and reads it back', async () => {
    const seg = await segmentService.create(ORG, USER, { name: 'Engaged' })
    expect(seg.name).toBe('Engaged')
    expect(seg.type).toBe('dynamic') // default
    expect(seg.org_id).toBe(ORG)
    expect(seg.contact_count).toBe(0)
    const got = await segmentService.get(ORG, seg.id)
    expect(got?.id).toBe(seg.id)
  })

  it('stores rules_json for dynamic segments', async () => {
    const rules = { operator: 'AND' as const, conditions: [{ field: 'status' as const, operator: 'eq' as const, value: 'active' }] }
    const seg = await segmentService.create(ORG, USER, { name: 'Active', type: 'dynamic', rules })
    const got = await segmentService.get(ORG, seg.id)
    expect(JSON.parse(got!.rules_json!)).toEqual(rules)
  })

  it('updates and deletes a segment (tenant-scoped)', async () => {
    const seg = await segmentService.create(ORG, USER, { name: 'A' })
    expect(await segmentService.update(ORG, seg.id, { name: 'B', description: 'd' })).toBe(true)
    expect((await segmentService.get(ORG, seg.id))?.name).toBe('B')
    // wrong org cannot mutate
    expect(await segmentService.update(ORG2, seg.id, { name: 'X' })).toBe(false)
    expect(await segmentService.delete(ORG2, seg.id)).toBe(false)
    expect(await segmentService.delete(ORG, seg.id)).toBe(true)
    expect(await segmentService.get(ORG, seg.id)).toBeNull()
  })

  it('lists segments for the org only', async () => {
    await segmentService.create(ORG, USER, { name: 'A' })
    await segmentService.create(ORG, USER, { name: 'B' })
    await segmentService.create(ORG2, USER, { name: 'Other' })
    const list = await segmentService.list(ORG)
    expect(list).toHaveLength(2)
  })

  it('adds/removes static members and maintains contact_count', async () => {
    const seg = await segmentService.create(ORG, USER, { name: 'Static', type: 'static' })
    const added = await segmentService.addContacts(seg.id, ['con1', 'con2', 'con2']) // dup ignored
    expect(added).toBe(2)
    expect((await segmentService.get(ORG, seg.id))?.contact_count).toBe(2)
    let members = await segmentService.getStaticMembers(seg.id)
    expect(new Set(members)).toEqual(new Set(['con1', 'con2']))
    const removed = await segmentService.removeContacts(seg.id, ['con1'])
    expect(removed).toBe(1)
    expect((await segmentService.get(ORG, seg.id))?.contact_count).toBe(1)
    members = await segmentService.getStaticMembers(seg.id)
    expect(members).toEqual(['con2'])
  })

  it('cascades segment_contacts when the segment is deleted (FK)', async () => {
    const seg = await segmentService.create(ORG, USER, { name: 'S', type: 'static' })
    await segmentService.addContacts(seg.id, ['con1'])
    await segmentService.delete(ORG, seg.id)
    expect(await segmentService.getStaticMembers(seg.id)).toEqual([])
  })

  it('buildQuery is a pure synchronous helper', () => {
    const { sql, params } = segmentService.buildQuery({
      operator: 'AND',
      conditions: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'score', operator: 'gte', value: 50 },
      ],
    })
    expect(sql).toContain('status = ?')
    expect(sql).toContain('engagement_score >= ?')
    expect(params).toEqual(['active', 50])
  })
})
