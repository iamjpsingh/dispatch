// src/services/rssService.ts - RSS Feed Polling & Digest Emails

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
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

// ============================================================================
// Service
// ============================================================================

class RssService {
  private db: Database

  constructor() {
    const dbPath = './data/rss.db'
    const dbDir = dirname(dbPath)
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rss_feeds (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        check_interval INTEGER DEFAULT 60,
        template_id TEXT,
        list_id TEXT,
        last_checked_at TEXT,
        last_item_guid TEXT,
        status TEXT DEFAULT 'active',
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rss_org ON rss_feeds(org_id);
      CREATE INDEX IF NOT EXISTS idx_rss_status ON rss_feeds(status);
    `)
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, name: string, url: string, options?: {
    check_interval?: number
    template_id?: string
    list_id?: string
  }): RssFeed {
    const id = generateId('rss')
    this.db.prepare(`
      INSERT INTO rss_feeds (id, org_id, user_id, name, url, check_interval, template_id, list_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, userId, name, url, options?.check_interval || 60, options?.template_id || null, options?.list_id || null)

    return this.db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(id) as RssFeed
  }

  list(orgId: string): RssFeed[] {
    return this.db.prepare('SELECT * FROM rss_feeds WHERE org_id = ? ORDER BY created_at DESC').all(orgId) as RssFeed[]
  }

  get(feedId: string): RssFeed | null {
    return this.db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(feedId) as RssFeed | null
  }

  update(orgId: string, feedId: string, updates: Partial<{
    name: string; url: string; check_interval: number; template_id: string; list_id: string; status: string
  }>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.url !== undefined) { sets.push('url = ?'); params.push(updates.url) }
    if (updates.check_interval !== undefined) { sets.push('check_interval = ?'); params.push(updates.check_interval) }
    if (updates.template_id !== undefined) { sets.push('template_id = ?'); params.push(updates.template_id) }
    if (updates.list_id !== undefined) { sets.push('list_id = ?'); params.push(updates.list_id) }
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(feedId, orgId)

    const result = this.db.prepare(`UPDATE rss_feeds SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).run(...params)
    return result.changes > 0
  }

  delete(orgId: string, feedId: string): boolean {
    return this.db.prepare('DELETE FROM rss_feeds WHERE id = ? AND org_id = ?').run(feedId, orgId).changes > 0
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
    const feed = this.get(feedId)
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
      this.db.prepare(`
        UPDATE rss_feeds SET last_checked_at = datetime('now'), last_item_guid = ?, error_message = NULL, status = 'active'
        WHERE id = ?
      `).run(items[0].guid, feedId)

      return newItems
    } catch (err: any) {
      this.db.prepare(`
        UPDATE rss_feeds SET last_checked_at = datetime('now'), error_message = ?, status = 'error'
        WHERE id = ?
      `).run(err.message, feedId)
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

  getFeedsDueForCheck(): RssFeed[] {
    return this.db.prepare(`
      SELECT * FROM rss_feeds
      WHERE status = 'active'
      AND (last_checked_at IS NULL OR datetime(last_checked_at, '+' || check_interval || ' minutes') <= datetime('now'))
    `).all() as RssFeed[]
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
