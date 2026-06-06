// src/services/webhookService.ts - Outgoing Webhook Dispatch with HMAC

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { eventBus, type EventType } from './eventBus'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

// ============================================================================
// Types
// ============================================================================

export interface Webhook {
  id: string
  org_id: string
  user_id: string
  name: string
  url: string
  secret: string // HMAC signing key
  events: string // JSON array of event types
  enabled: number
  last_triggered_at: string | null
  failure_count: number
  created_at: string
  updated_at: string
}

export interface WebhookInput {
  name: string
  url: string
  events: EventType[]
  enabled?: boolean
}

export interface WebhookLog {
  id: string
  webhook_id: string
  event_type: string
  status: 'success' | 'failed'
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  created_at: string
}

// ============================================================================
// Service
// ============================================================================

class WebhookService {
  private db: Database

  constructor() {
    const dbPath = './data/webhooks.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
    this.registerEventHandlers()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT DEFAULT '[]',
        enabled INTEGER DEFAULT 1,
        last_triggered_at TEXT,
        failure_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_wh_user ON webhooks(user_id);
      CREATE INDEX IF NOT EXISTS idx_wh_enabled ON webhooks(enabled);

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        status_code INTEGER,
        response_body TEXT,
        error TEXT,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_whl_webhook ON webhook_logs(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_whl_date ON webhook_logs(created_at);
    `)

    // Add org_id to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE webhooks ADD COLUMN org_id TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_wh_org ON webhooks(org_id)')

    logger.info('Webhooks database initialized (data/webhooks.db)')
  }

  private registerEventHandlers() {
    // Listen for all events and dispatch matching webhooks
    eventBus.on('*', async (event) => {
      await this.dispatchForEvent(event.type as EventType, event.userId, event)
    })
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: WebhookInput): Webhook {
    const id = generateId('wh')
    const secret = this.generateSecret()

    this.db.prepare(`
      INSERT INTO webhooks (id, org_id, user_id, name, url, secret, events, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, input.name, input.url, secret,
      JSON.stringify(input.events),
      input.enabled !== false ? 1 : 0
    )

    return this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Webhook
  }

  get(orgId: string, webhookId: string): Webhook | null {
    return this.db.prepare(`
      SELECT * FROM webhooks WHERE id = ? AND org_id = ?
    `).get(webhookId, orgId) as Webhook | null
  }

  update(orgId: string, webhookId: string, updates: Partial<WebhookInput>): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.url !== undefined) { sets.push('url = ?'); params.push(updates.url) }
    if (updates.events !== undefined) { sets.push('events = ?'); params.push(JSON.stringify(updates.events)) }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(webhookId, orgId)

    const result = this.db.prepare(`
      UPDATE webhooks SET ${sets.join(', ')} WHERE id = ? AND org_id = ?
    `).run(...params)

    return result.changes > 0
  }

  delete(orgId: string, webhookId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM webhooks WHERE id = ? AND org_id = ?
    `).run(webhookId, orgId)
    return result.changes > 0
  }

  list(orgId: string): Webhook[] {
    return this.db.prepare(`
      SELECT * FROM webhooks WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId) as Webhook[]
  }

  toggleEnabled(orgId: string, webhookId: string, enabled: boolean): boolean {
    const result = this.db.prepare(`
      UPDATE webhooks SET enabled = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?
    `).run(enabled ? 1 : 0, webhookId, orgId)
    return result.changes > 0
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  private async dispatchForEvent(eventType: EventType, userId: string, payload: unknown): Promise<void> {
    // userId here is actually orgId from eventBus context
    const webhooks = this.db.prepare(`
      SELECT * FROM webhooks WHERE org_id = ? AND enabled = 1
    `).all(userId) as Webhook[]

    for (const webhook of webhooks) {
      const events: string[] = JSON.parse(webhook.events || '[]')
      if (!events.includes(eventType)) continue

      // Fire and forget - don't block the event bus
      this.sendWebhook(webhook, eventType, payload).catch(err => {
        logger.error(`Webhook ${webhook.id} dispatch error:`, err)
      })
    }
  }

  private async sendWebhook(webhook: Webhook, eventType: string, payload: unknown, attempt = 1): Promise<void> {
    const maxAttempts = 3
    const startTime = Date.now()

    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    })

    const signature = await this.sign(body, webhook.secret)

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dispatch-Signature': signature,
          'X-Dispatch-Event': eventType,
          'X-Dispatch-Delivery': `${webhook.id}_${Date.now()}`,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      const duration = Date.now() - startTime
      const responseBody = await response.text().catch(() => '')

      this.logDelivery(webhook.id, eventType, response.ok ? 'success' : 'failed', response.status, responseBody, null, duration)

      if (response.ok) {
        // Reset failure count on success
        this.db.prepare(`
          UPDATE webhooks SET failure_count = 0, last_triggered_at = datetime('now') WHERE id = ?
        `).run(webhook.id)
      } else if (attempt < maxAttempts) {
        // Retry with backoff
        const delay = Math.pow(2, attempt) * 1000
        setTimeout(() => this.sendWebhook(webhook, eventType, payload, attempt + 1), delay)
      } else {
        // Increment failure count
        this.db.prepare(`
          UPDATE webhooks SET failure_count = failure_count + 1, last_triggered_at = datetime('now') WHERE id = ?
        `).run(webhook.id)
      }
    } catch (err) {
      const duration = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'

      this.logDelivery(webhook.id, eventType, 'failed', null, null, errorMsg, duration)

      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000
        setTimeout(() => this.sendWebhook(webhook, eventType, payload, attempt + 1), delay)
      } else {
        this.db.prepare(`
          UPDATE webhooks SET failure_count = failure_count + 1, last_triggered_at = datetime('now') WHERE id = ?
        `).run(webhook.id)
      }
    }
  }

  private logDelivery(webhookId: string, eventType: string, status: 'success' | 'failed', statusCode: number | null, responseBody: string | null, error: string | null, durationMs: number) {
    const id = generateId('whl')
    this.db.prepare(`
      INSERT INTO webhook_logs (id, webhook_id, event_type, status, status_code, response_body, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, webhookId, eventType, status, statusCode, responseBody?.substring(0, 2000) || null, error, durationMs)
  }

  // --------------------------------------------------------------------------
  // Logs
  // --------------------------------------------------------------------------

  getLogs(webhookId: string, limit = 50, offset = 0): WebhookLog[] {
    return this.db.prepare(`
      SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(webhookId, limit, offset) as WebhookLog[]
  }

  clearLogs(webhookId: string): number {
    const result = this.db.prepare('DELETE FROM webhook_logs WHERE webhook_id = ?').run(webhookId)
    return result.changes
  }

  // --------------------------------------------------------------------------
  // Test
  // --------------------------------------------------------------------------

  async testWebhook(orgId: string, webhookId: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const webhook = this.get(orgId, webhookId)
    if (!webhook) return { success: false, error: 'Webhook not found' }

    const body = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from Dispatch' },
    })

    const signature = await this.sign(body, webhook.secret)

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dispatch-Signature': signature,
          'X-Dispatch-Event': 'test',
        },
        body,
        signal: AbortSignal.timeout(10000),
      })

      return { success: response.ok, statusCode: response.status }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private generateSecret(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async sign(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    return `sha256=${Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')}`
  }
}

export const webhookService = new WebhookService()
