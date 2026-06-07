// src/services/webhookService.ts - Outgoing Webhook Dispatch with HMAC (Postgres/Drizzle, async)

import { and, eq, desc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { webhooks, webhook_logs } from '../db/pg/schema'
import { eventBus, type EventType } from './eventBus'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import { encrypt, decryptOrPlain } from '../utils/crypto'

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

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class WebhookService {
  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: WebhookInput): Promise<Webhook> {
    const db = getDb()
    const id = generateId('wh')
    const secret = this.generateSecret()

    await db.insert(webhooks).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      url: input.url,
      secret: await encrypt(secret),
      events: JSON.stringify(input.events),
      enabled: input.enabled !== false ? 1 : 0,
    })

    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
    const wh = row as Webhook
    wh.secret = await decryptOrPlain(wh.secret)
    return wh
  }

  async get(orgId: string, webhookId: string): Promise<Webhook | null> {
    const [row] = await getDb()
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.org_id, orgId)))
      .limit(1)
    if (!row) return null
    const wh = row as Webhook
    wh.secret = await decryptOrPlain(wh.secret)
    return wh
  }

  async update(orgId: string, webhookId: string, updates: Partial<WebhookInput>): Promise<boolean> {
    const values: Partial<typeof webhooks.$inferInsert> = {}

    if (updates.name !== undefined) values.name = updates.name
    if (updates.url !== undefined) values.url = updates.url
    if (updates.events !== undefined) values.events = JSON.stringify(updates.events)
    if (updates.enabled !== undefined) values.enabled = updates.enabled ? 1 : 0

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(webhooks)
      .set(values)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.org_id, orgId)))
      .returning({ id: webhooks.id })
    return res.length > 0
  }

  async delete(orgId: string, webhookId: string): Promise<boolean> {
    const res = await getDb()
      .delete(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.org_id, orgId)))
      .returning({ id: webhooks.id })
    return res.length > 0
  }

  async list(orgId: string): Promise<Webhook[]> {
    const rows = await getDb()
      .select()
      .from(webhooks)
      .where(eq(webhooks.org_id, orgId))
      .orderBy(desc(webhooks.created_at))
    const list = rows as Webhook[]
    await Promise.all(list.map(async (wh) => { wh.secret = await decryptOrPlain(wh.secret) }))
    return list
  }

  async toggleEnabled(orgId: string, webhookId: string, enabled: boolean): Promise<boolean> {
    const res = await getDb()
      .update(webhooks)
      .set({ enabled: enabled ? 1 : 0, updated_at: now() })
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.org_id, orgId)))
      .returning({ id: webhooks.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  private async dispatchForEvent(eventType: EventType, userId: string, payload: unknown): Promise<void> {
    // userId here is actually orgId from eventBus context
    const rows = await getDb()
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.org_id, userId), eq(webhooks.enabled, 1)))
    const enabled = rows as Webhook[]

    for (const webhook of enabled) {
      const events: string[] = JSON.parse(webhook.events || '[]')
      if (!events.includes(eventType)) continue

      webhook.secret = await decryptOrPlain(webhook.secret)
      // Fire and forget - don't block the event bus
      this.sendWebhook(webhook, eventType, payload).catch((err) => {
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

      await this.logDelivery(webhook.id, eventType, response.ok ? 'success' : 'failed', response.status, responseBody, null, duration)

      if (response.ok) {
        // Reset failure count on success
        await getDb()
          .update(webhooks)
          .set({ failure_count: 0, last_triggered_at: now() })
          .where(eq(webhooks.id, webhook.id))
      } else if (attempt < maxAttempts) {
        // Retry with backoff
        const delay = Math.pow(2, attempt) * 1000
        setTimeout(() => this.sendWebhook(webhook, eventType, payload, attempt + 1), delay)
      } else {
        // Increment failure count
        await getDb()
          .update(webhooks)
          .set({ failure_count: sql`${webhooks.failure_count} + 1`, last_triggered_at: now() })
          .where(eq(webhooks.id, webhook.id))
      }
    } catch (err) {
      const duration = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'

      await this.logDelivery(webhook.id, eventType, 'failed', null, null, errorMsg, duration)

      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000
        setTimeout(() => this.sendWebhook(webhook, eventType, payload, attempt + 1), delay)
      } else {
        await getDb()
          .update(webhooks)
          .set({ failure_count: sql`${webhooks.failure_count} + 1`, last_triggered_at: now() })
          .where(eq(webhooks.id, webhook.id))
      }
    }
  }

  private async logDelivery(
    webhookId: string,
    eventType: string,
    status: 'success' | 'failed',
    statusCode: number | null,
    responseBody: string | null,
    error: string | null,
    durationMs: number
  ): Promise<void> {
    const id = generateId('whl')
    await getDb().insert(webhook_logs).values({
      id,
      webhook_id: webhookId,
      event_type: eventType,
      status,
      status_code: statusCode,
      response_body: responseBody?.substring(0, 2000) || null,
      error,
      duration_ms: durationMs,
    })
  }

  // --------------------------------------------------------------------------
  // Logs
  // --------------------------------------------------------------------------

  async getLogs(webhookId: string, limit = 50, offset = 0): Promise<WebhookLog[]> {
    const rows = await getDb()
      .select()
      .from(webhook_logs)
      .where(eq(webhook_logs.webhook_id, webhookId))
      .orderBy(desc(webhook_logs.created_at))
      .limit(limit)
      .offset(offset)
    return rows as WebhookLog[]
  }

  async clearLogs(webhookId: string): Promise<number> {
    const res = await getDb()
      .delete(webhook_logs)
      .where(eq(webhook_logs.webhook_id, webhookId))
      .returning({ id: webhook_logs.id })
    return res.length
  }

  // --------------------------------------------------------------------------
  // Test
  // --------------------------------------------------------------------------

  async testWebhook(orgId: string, webhookId: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const webhook = await this.get(orgId, webhookId)
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
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
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
    return `sha256=${Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }

  // --------------------------------------------------------------------------
  // Event wiring
  // --------------------------------------------------------------------------

  /** Subscribe to all events and dispatch matching webhooks (called once at module load). */
  registerEventHandlers(): void {
    eventBus.on('*', async (event) => {
      await this.dispatchForEvent(event.type as EventType, event.userId, event)
    })
  }
}

export const webhookService = new WebhookService()
webhookService.registerEventHandlers()
