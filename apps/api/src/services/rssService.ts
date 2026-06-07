// src/services/rssService.ts - RSS Feed Polling & Digest Emails (Postgres/Drizzle, async)

import { and, eq, desc, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { rss_feeds } from '../db/pg/schema'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface RssFeed {
  id: string
  org_id: string
  user_id: string
  name: string
  url: string
  check_interval: number    // minutes
  template_id: string | null
  list_id: string | null
  last_checked_at: string | null
  last_item_guid: string | null
  status: 'active' | 'paused' | 'error'
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface RssItem {
  title: string
  link: string
  description: string
  pubDate: string | null
  guid: string
  author: string | null
  imageUrl: string | null
}

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class RssService {
  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, name: string, url: string, options?: {
    check_interval?: number
    template_id?: string
    list_id?: string
  }): Promise<RssFeed> {
    const db = getDb()
    const id = generateId('rss')

    await db.insert(rss_feeds).values({
      id,
      org_id: orgId,
      user_id: userId,
      name,
      url,
      check_interval: options?.check_interval || 60,
      template_id: options?.template_id || null,
      list_id: options?.list_id || null,
    })

    const [row] = await db.select().from(rss_feeds).where(eq(rss_feeds.id, id)).limit(1)
    return row as RssFeed
  }

  async list(orgId: string): Promise<RssFeed[]> {
    const rows = await getDb()
      .select()
      .from(rss_feeds)
      .where(eq(rss_feeds.org_id, orgId))
      .orderBy(desc(rss_feeds.created_at))
    return rows as RssFeed[]
  }

  async get(feedId: string): Promise<RssFeed | null> {
    const [row] = await getDb().select().from(rss_feeds).where(eq(rss_feeds.id, feedId)).limit(1)
    return (row as RssFeed) ?? null
  }

  async update(orgId: string, feedId: string, updates: Partial<{
    name: string; url: string; check_interval: number; template_id: string; list_id: string; status: string
  }>): Promise<boolean> {
    const values: Partial<typeof rss_feeds.$inferInsert> = {}

    if (updates.name !== undefined) values.name = updates.name
    if (updates.url !== undefined) values.url = updates.url
    if (updates.check_interval !== undefined) values.check_interval = updates.check_interval
    if (updates.template_id !== undefined) values.template_id = updates.template_id
    if (updates.list_id !== undefined) values.list_id = updates.list_id
    if (updates.status !== undefined) values.status = updates.status

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(rss_feeds)
      .set(values)
      .where(and(eq(rss_feeds.id, feedId), eq(rss_feeds.org_id, orgId)))
      .returning({ id: rss_feeds.id })
    return res.length > 0
  }

  async delete(orgId: string, feedId: string): Promise<boolean> {
    const res = await getDb()
      .delete(rss_feeds)
      .where(and(eq(rss_feeds.id, feedId), eq(rss_feeds.org_id, orgId)))
      .returning({ id: rss_feeds.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Feed Parsing
  // --------------------------------------------------------------------------

  async fetchFeed(url: string): Promise<RssItem[]> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dispatch/4.0 RSS Reader' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const xml = await response.text()
    return this.parseRss(xml)
  }

  parseRss(xml: string): RssItem[] {
    const items: RssItem[] = []

    // Simple XML parser using regex (no DOM dependency, works in Bun)
    // Handle both RSS 2.0 (<item>) and Atom (<entry>) feeds
    const isAtom = xml.includes('<feed') && xml.includes('<entry')

    if (isAtom) {
      const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) || []
      for (const entry of entries) {
        items.push({
          title: extractTag(entry, 'title'),
          link: extractAttr(entry, 'link', 'href') || extractTag(entry, 'link'),
          description: extractTag(entry, 'summary') || extractTag(entry, 'content'),
          pubDate: extractTag(entry, 'published') || extractTag(entry, 'updated'),
          guid: extractTag(entry, 'id') || extractAttr(entry, 'link', 'href') || '',
          author: extractTag(entry, 'name'),
          imageUrl: null,
        })
      }
    } else {
      const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []
      for (const item of rssItems) {
        const enclosureUrl = extractAttr(item, 'enclosure', 'url')
        items.push({
          title: extractTag(item, 'title'),
          link: extractTag(item, 'link'),
          description: extractTag(item, 'description'),
          pubDate: extractTag(item, 'pubDate'),
          guid: extractTag(item, 'guid') || extractTag(item, 'link'),
          author: extractTag(item, 'author') || extractTag(item, 'dc:creator'),
          imageUrl: enclosureUrl && enclosureUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) ? enclosureUrl : null,
        })
      }
    }

    return items
  }

  // --------------------------------------------------------------------------
  // Check for New Items
  // --------------------------------------------------------------------------

  async checkFeed(feedId: string): Promise<RssItem[]> {
    const feed = await this.get(feedId)
    if (!feed || feed.status !== 'active') return []

    try {
      const items = await this.fetchFeed(feed.url)
      if (items.length === 0) return []

      // Find new items since last check
      const newItems: RssItem[] = []
      for (const item of items) {
        if (item.guid === feed.last_item_guid) break
        newItems.push(item)
      }

      // Update last checked
      await getDb()
        .update(rss_feeds)
        .set({ last_checked_at: now(), last_item_guid: items[0].guid, error_message: null, status: 'active' })
        .where(eq(rss_feeds.id, feedId))

      return newItems
    } catch (err: any) {
      await getDb()
        .update(rss_feeds)
        .set({ last_checked_at: now(), error_message: err.message, status: 'error' })
        .where(eq(rss_feeds.id, feedId))
      logger.error(`RSS feed error (${feedId}):`, err.message)
      return []
    }
  }

  // --------------------------------------------------------------------------
  // Render Digest Email
  // --------------------------------------------------------------------------

  renderDigestHtml(feedName: string, items: RssItem[]): string {
    const articleHtml = items.map(item => `
      <tr><td style="padding:20px 0;border-bottom:1px solid #e5e7eb">
        ${item.imageUrl ? `<img src="${item.imageUrl}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:12px" alt="">` : ''}
        <h2 style="margin:0 0 8px;font-size:18px"><a href="${item.link}" style="color:#18181b;text-decoration:none">${item.title}</a></h2>
        <p style="margin:0 0 8px;color:#6b7280;font-size:14px;line-height:1.5">${(item.description || '').replace(/<[^>]*>/g, '').slice(0, 200)}...</p>
        <a href="${item.link}" style="color:#3b82f6;font-size:14px;text-decoration:none">Read more &rarr;</a>
      </td></tr>
    `).join('')

    return `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <tr><td style="padding:32px 0;text-align:center;border-bottom:2px solid #18181b">
        <h1 style="margin:0;font-size:24px">${feedName}</h1>
        <p style="margin:8px 0 0;color:#6b7280;font-size:14px">${items.length} new article${items.length > 1 ? 's' : ''}</p>
      </td></tr>
      ${articleHtml}
    </table>`
  }

  // --------------------------------------------------------------------------
  // Get Feeds Due for Check
  // --------------------------------------------------------------------------

  async getFeedsDueForCheck(): Promise<RssFeed[]> {
    // Per-row window: due when never checked, or last_checked_at + check_interval
    // minutes has elapsed. check_interval is a per-row column so the interval is
    // computed in SQL against now().
    const rows = await getDb()
      .select()
      .from(rss_feeds)
      .where(and(
        eq(rss_feeds.status, 'active'),
        or(
          isNull(rss_feeds.last_checked_at),
          sql`${rss_feeds.last_checked_at} + (${rss_feeds.check_interval} || ' minutes')::interval <= now()`,
        ),
      ))
    return rows as RssFeed[]
  }
}

// ============================================================================
// XML Helpers
// ============================================================================

function extractTag(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = xml.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1].trim()

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : ''
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i')
  const match = xml.match(regex)
  return match ? match[1] : ''
}

export const rssService = new RssService()
