// P2.3 net — campaignService on real (PGlite) Postgres. CRUD with status gates,
// filters, lifecycle (saveDraft/setStatus/schedule/clone), stats, A/B variants,
// dashboard aggregation, and tenant isolation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, campaigns } from '../../src/db/pg/schema'
import { campaignService } from '../../src/services/campaignService'
import { eventBus } from '../../src/services/eventBus'

const ORG = 'org_cmp'
const ORG2 = 'org_cmp2'
const USER = 'usr_cmp'

const baseInput = { name: 'C1', subject: 'Hi', from_name: 'Me', from_email: 'me@x.com' }

describe('P2.3 — campaignService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org', slug: 'org-cmp' },
      { id: ORG2, name: 'Org2', slug: 'org-cmp2' },
    ])
    await db.insert(users).values({ id: USER, email: 'c@x.com', name: 'C', password_hash: 'x' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a campaign with defaults; row lands in Postgres', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    expect(c.name).toBe('C1')
    expect(c.status).toBe('draft')
    expect(c.type).toBe('one_time')
    expect(c.batch_size).toBe(20)
    expect(c.tags).toBe('[]')
    const rows = await db.select().from(campaigns)
    expect(rows).toHaveLength(1)
  })

  it('reads back tenant-scoped', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    expect((await campaignService.get(ORG, c.id))?.id).toBe(c.id)
    expect(await campaignService.get(ORG2, c.id)).toBeNull()
  })

  it('update only applies in draft/testing status', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    expect(await campaignService.update(ORG, c.id, { name: 'C2' })).toBe(true)
    expect((await campaignService.get(ORG, c.id))?.name).toBe('C2')
    await campaignService.setStatus(ORG, c.id, 'sending')
    expect(await campaignService.update(ORG, c.id, { name: 'C3' })).toBe(false) // gated
    expect((await campaignService.get(ORG, c.id))?.name).toBe('C2')
  })

  it('delete only applies in draft/cancelled/archived status', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    await campaignService.setStatus(ORG, c.id, 'sending')
    expect(await campaignService.delete(ORG, c.id)).toBe(false) // gated
    await campaignService.setStatus(ORG, c.id, 'cancelled')
    expect(await campaignService.delete(ORG, c.id)).toBe(true)
    expect(await campaignService.get(ORG, c.id)).toBeNull()
  })

  it('lists with filters + pagination', async () => {
    await campaignService.create(ORG, USER, { ...baseInput, name: 'Alpha' })
    await campaignService.create(ORG, USER, { ...baseInput, name: 'Beta', type: 'ab_test' })
    const all = await campaignService.list(ORG)
    expect(all.total).toBe(2)
    const ab = await campaignService.list(ORG, { type: 'ab_test' })
    expect(ab.total).toBe(1)
    const search = await campaignService.list(ORG, { search: 'Alph' })
    expect(search.total).toBe(1)
    const page = await campaignService.list(ORG, { limit: 1 })
    expect(page.campaigns).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('setStatus sets timestamps and emits events', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    expect(await campaignService.setStatus(ORG, c.id, 'sending')).toBe(true)
    expect(eventBus.emit).toHaveBeenCalledWith('campaign_launched', ORG, { campaignId: c.id })
    const sent = await campaignService.get(ORG, c.id)
    expect(sent?.sent_at).toBeTruthy()
    await campaignService.setStatus(ORG, c.id, 'completed')
    expect(eventBus.emit).toHaveBeenCalledWith('campaign_completed', ORG, { campaignId: c.id })
    expect((await campaignService.get(ORG, c.id))?.completed_at).toBeTruthy()
  })

  it('schedules a draft campaign', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    expect(await campaignService.schedule(ORG, c.id, '2026-12-01T10:00:00Z')).toBe(true)
    const sc = await campaignService.get(ORG, c.id)
    expect(sc?.status).toBe('scheduled')
    expect(sc?.scheduled_at).toBeTruthy()
  })

  it('clones a campaign', async () => {
    const c = await campaignService.create(ORG, USER, { ...baseInput, name: 'Orig', tags: ['x'] })
    const clone = await campaignService.clone(ORG, USER, c.id)
    expect(clone?.name).toBe('Orig (Copy)')
    expect(JSON.parse(clone!.tags)).toEqual(['x'])
    expect(clone?.id).not.toBe(c.id)
  })

  it('increments stats and sets recipients/job id', async () => {
    const c = await campaignService.create(ORG, USER, baseInput)
    await campaignService.updateStats(c.id, 'sent_count', 5)
    await campaignService.updateStats(c.id, 'sent_count')
    await campaignService.setTotalRecipients(c.id, 100)
    await campaignService.setJobId(c.id, 'job-1')
    const got = await campaignService.get(ORG, c.id)
    expect(got?.sent_count).toBe(6)
    expect(got?.total_recipients).toBe(100)
    expect(got?.job_id).toBe('job-1')
  })

  it('manages A/B variants and declares a winner', async () => {
    const c = await campaignService.create(ORG, USER, { ...baseInput, type: 'ab_test' })
    const a = await campaignService.createABVariant(c.id, 'A', 50, { subject: 'SA' })
    const b = await campaignService.createABVariant(c.id, 'B', 50, { subject: 'SB' })
    const variants = await campaignService.getABVariants(c.id)
    expect(variants).toHaveLength(2)
    expect(await campaignService.declareWinner(c.id, b.id)).toBe(true)
    const after = await campaignService.getABVariants(c.id)
    expect(after.find((v) => v.id === b.id)?.is_winner).toBe(1)
    expect(after.find((v) => v.id === a.id)?.is_winner).toBe(0)
  })

  it('computes dashboard stats', async () => {
    const c1 = await campaignService.create(ORG, USER, baseInput)
    await campaignService.create(ORG, USER, baseInput)
    await campaignService.setStatus(ORG, c1.id, 'sending')
    const stats = await campaignService.getDashboardStats(ORG)
    expect(stats.total).toBe(2)
    expect(stats.drafts).toBe(1)
    expect(stats.sending).toBe(1)
  })
})
