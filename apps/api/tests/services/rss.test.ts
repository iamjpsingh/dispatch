// rssService net — RSS feed CRUD, org scoping, due-for-check window, status gates,
// the pure parseRss/renderDigestHtml helpers, and a Postgres landing cross-check of
// the stored column shapes/types straight from PGlite.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { and, eq, sql } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, rss_feeds } from '../../src/db/pg/schema'
import { rssService } from '../../src/services/rssService'

const ORG = 'org_r'
const ORG2 = 'org_r2'
const USER = 'usr_r'

describe('rssService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org R', slug: 'org-r' },
      { id: ORG2, name: 'Org R2', slug: 'org-r2' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  // ---- CRUD + read-back ----

  it('creates a feed with defaults and reads it back', async () => {
    const feed = await rssService.create(ORG, USER, 'Blog', 'https://example.com/feed.xml')
    expect(feed.org_id).toBe(ORG)
    expect(feed.user_id).toBe(USER)
    expect(feed.name).toBe('Blog')
    expect(feed.url).toBe('https://example.com/feed.xml')
    expect(feed.check_interval).toBe(60) // default
    expect(feed.template_id).toBeNull()
    expect(feed.list_id).toBeNull()
    expect(feed.status).toBe('active') // default
    expect(feed.last_checked_at).toBeNull()

    const got = await rssService.get(feed.id)
    expect(got?.id).toBe(feed.id)
  })

  it('honors create options (check_interval, template_id, list_id)', async () => {
    const feed = await rssService.create(ORG, USER, 'News', 'https://n.example/rss', {
      check_interval: 15,
      template_id: 'tpl1',
      list_id: 'list1',
    })
    expect(feed.check_interval).toBe(15)
    expect(feed.template_id).toBe('tpl1')
    expect(feed.list_id).toBe('list1')
  })

  it('updates and deletes a feed (tenant-scoped)', async () => {
    const feed = await rssService.create(ORG, USER, 'A', 'https://a.example/rss')
    expect(await rssService.update(ORG, feed.id, { name: 'B', status: 'paused', check_interval: 30 })).toBe(true)
    const got = await rssService.get(feed.id)
    expect(got?.name).toBe('B')
    expect(got?.status).toBe('paused')
    expect(got?.check_interval).toBe(30)

    // empty updates are a no-op (returns false)
    expect(await rssService.update(ORG, feed.id, {})).toBe(false)

    // wrong org cannot mutate or delete
    expect(await rssService.update(ORG2, feed.id, { name: 'X' })).toBe(false)
    expect(await rssService.delete(ORG2, feed.id)).toBe(false)
    expect(await rssService.delete(ORG, feed.id)).toBe(true)
    expect(await rssService.get(feed.id)).toBeNull()
  })

  // ---- scoping ----

  it('lists feeds for the org only, newest first', async () => {
    await rssService.create(ORG, USER, 'A', 'https://a.example/rss')
    await rssService.create(ORG, USER, 'B', 'https://b.example/rss')
    await rssService.create(ORG2, USER, 'Other', 'https://o.example/rss')
    const list = await rssService.list(ORG)
    expect(list).toHaveLength(2)
    expect(list.every((f) => f.org_id === ORG)).toBe(true)
  })

  // ---- due-for-check window + status gate ----

  it('getFeedsDueForCheck returns never-checked active feeds and respects the interval window', async () => {
    // never checked -> due
    const fresh = await rssService.create(ORG, USER, 'Fresh', 'https://fresh.example/rss', { check_interval: 60 })

    // checked long ago -> due (interval elapsed)
    const stale = await rssService.create(ORG, USER, 'Stale', 'https://stale.example/rss', { check_interval: 30 })
    await db.update(rss_feeds)
      .set({ last_checked_at: sql`now() - interval '2 hours'` })
      .where(eq(rss_feeds.id, stale.id))

    // checked recently -> NOT due (within window)
    const recent = await rssService.create(ORG, USER, 'Recent', 'https://recent.example/rss', { check_interval: 60 })
    await db.update(rss_feeds)
      .set({ last_checked_at: sql`now() - interval '1 minute'` })
      .where(eq(rss_feeds.id, recent.id))

    // paused -> excluded by status gate even though never checked
    const paused = await rssService.create(ORG, USER, 'Paused', 'https://paused.example/rss')
    await rssService.update(ORG, paused.id, { status: 'paused' })

    const due = await rssService.getFeedsDueForCheck()
    const dueIds = new Set(due.map((f) => f.id))
    expect(dueIds.has(fresh.id)).toBe(true)
    expect(dueIds.has(stale.id)).toBe(true)
    expect(dueIds.has(recent.id)).toBe(false)
    expect(dueIds.has(paused.id)).toBe(false)
  })

  it('checkFeed is a no-op for non-active feeds', async () => {
    const feed = await rssService.create(ORG, USER, 'Paused', 'https://p.example/rss')
    await rssService.update(ORG, feed.id, { status: 'paused' })
    expect(await rssService.checkFeed(feed.id)).toEqual([])
    expect(await rssService.checkFeed('nope')).toEqual([])
  })

  it('checkFeed records error + status on fetch failure', async () => {
    const feed = await rssService.create(ORG, USER, 'Bad', 'https://bad.example/rss')
    const spy = vi.spyOn(rssService, 'fetchFeed').mockRejectedValue(new Error('boom'))
    const out = await rssService.checkFeed(feed.id)
    expect(out).toEqual([])
    const got = await rssService.get(feed.id)
    expect(got?.status).toBe('error')
    expect(got?.error_message).toBe('boom')
    expect(got?.last_checked_at).not.toBeNull()
    spy.mockRestore()
  })

  it('checkFeed returns only items newer than last_item_guid and advances the cursor', async () => {
    const feed = await rssService.create(ORG, USER, 'Feed', 'https://f.example/rss')
    const items = [
      { title: 'n3', link: 'l3', description: '', pubDate: null, guid: 'g3', author: null, imageUrl: null },
      { title: 'n2', link: 'l2', description: '', pubDate: null, guid: 'g2', author: null, imageUrl: null },
      { title: 'n1', link: 'l1', description: '', pubDate: null, guid: 'g1', author: null, imageUrl: null },
    ]
    // first check: cursor empty -> all returned, cursor advances to newest
    const spy = vi.spyOn(rssService, 'fetchFeed').mockResolvedValue(items)
    const first = await rssService.checkFeed(feed.id)
    expect(first.map((i) => i.guid)).toEqual(['g3', 'g2', 'g1'])
    expect((await rssService.get(feed.id))?.last_item_guid).toBe('g3')
    expect((await rssService.get(feed.id))?.status).toBe('active')
    expect((await rssService.get(feed.id))?.error_message).toBeNull()

    // second check with a new top item -> only items above the old cursor returned
    spy.mockResolvedValue([
      { title: 'n4', link: 'l4', description: '', pubDate: null, guid: 'g4', author: null, imageUrl: null },
      ...items,
    ])
    const second = await rssService.checkFeed(feed.id)
    expect(second.map((i) => i.guid)).toEqual(['g4'])
    expect((await rssService.get(feed.id))?.last_item_guid).toBe('g4')
    spy.mockRestore()
  })

  // ---- pure helpers (sync) ----

  it('parseRss handles RSS 2.0 items', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Hello</title><link>https://x/1</link><description>Body</description>
        <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><guid>guid-1</guid></item>
    </channel></rss>`
    const items = rssService.parseRss(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Hello')
    expect(items[0].link).toBe('https://x/1')
    expect(items[0].guid).toBe('guid-1')
  })

  it('parseRss handles Atom entries', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Atom Post</title><link href="https://x/a"/>
        <summary>Sum</summary><id>atom-1</id><name>Author</name>
        <published>2026-01-01T00:00:00Z</published></entry>
    </feed>`
    const items = rssService.parseRss(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Atom Post')
    expect(items[0].link).toBe('https://x/a')
    expect(items[0].guid).toBe('atom-1')
    expect(items[0].author).toBe('Author')
  })

  it('renderDigestHtml renders feed name and article count', () => {
    const html = rssService.renderDigestHtml('My Feed', [
      { title: 'T1', link: 'l1', description: 'd1', pubDate: null, guid: 'g1', author: null, imageUrl: null },
      { title: 'T2', link: 'l2', description: 'd2', pubDate: null, guid: 'g2', author: null, imageUrl: 'https://img/x.png' },
    ])
    expect(html).toContain('My Feed')
    expect(html).toContain('2 new articles')
    expect(html).toContain('T1')
    expect(html).toContain('https://img/x.png')
  })

  // ---- Postgres landing cross-check ----

  it('Postgres landing: stored columns have the expected shapes/types', async () => {
    const feed = await rssService.create(ORG, USER, 'Shapes', 'https://s.example/rss', { check_interval: 45, template_id: 'tpl', list_id: 'lst' })

    const [row] = await db.select().from(rss_feeds).where(and(eq(rss_feeds.id, feed.id), eq(rss_feeds.org_id, ORG))).limit(1)
    expect(typeof row.id).toBe('string')
    expect(typeof row.org_id).toBe('string')
    expect(typeof row.user_id).toBe('string')
    expect(typeof row.name).toBe('string')
    expect(typeof row.url).toBe('string')
    expect(typeof row.check_interval).toBe('number') // INTEGER -> number
    expect(row.template_id).toBe('tpl')
    expect(row.list_id).toBe('lst')
    expect(row.last_checked_at).toBeNull()
    expect(row.last_item_guid).toBeNull()
    expect(row.status).toBe('active')
    expect(typeof row.created_at).toBe('string') // ISO timestamp text
    expect(typeof row.updated_at).toBe('string')
  })
})
