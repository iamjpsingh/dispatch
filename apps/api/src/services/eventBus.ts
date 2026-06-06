// src/services/eventBus.ts - In-memory Event Bus for real-time pub/sub

import { logger } from '../utils/logger'

type EventType =
  | 'email_sent' | 'email_failed' | 'email_opened' | 'email_clicked'
  | 'email_bounced' | 'email_unsubscribed'
  | 'batch_completed' | 'job_completed' | 'job_paused'
  | 'contact_imported' | 'contact_scored'
  | 'automation_step_completed' | 'automation_enrolled'
  | 'campaign_launched' | 'campaign_completed'
  | 'template_created' | 'template_updated'
  | 'stats_update'

interface EventPayload {
  type: EventType
  userId: string
  campaignId?: string
  contactId?: string
  data?: Record<string, unknown>
  timestamp: string
}

type EventHandler = (event: EventPayload) => void | Promise<void>

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()
  private sseClients = new Map<string, Set<(event: EventPayload) => void>>()

  /**
   * Subscribe to an event type
   */
  on(type: EventType | '*', handler: EventHandler): () => void {
    const key = type
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set())
    }
    this.handlers.get(key)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(key)?.delete(handler)
    }
  }

  /**
   * Emit an event to all subscribers
   */
  async emit(type: EventType, userId: string, data?: Record<string, unknown>, campaignId?: string, contactId?: string): Promise<void> {
    const event: EventPayload = {
      type,
      userId,
      campaignId,
      contactId,
      data,
      timestamp: new Date().toISOString(),
    }

    // Notify specific type handlers
    const typeHandlers = this.handlers.get(type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event)
        } catch (err) {
          logger.error(`EventBus handler error for ${type}:`, err)
        }
      }
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.handlers.get('*')
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event)
        } catch (err) {
          logger.error(`EventBus wildcard handler error:`, err)
        }
      }
    }

    // Push to SSE clients for this user
    const userClients = this.sseClients.get(userId)
    if (userClients) {
      for (const client of userClients) {
        try {
          client(event)
        } catch {
          userClients.delete(client)
        }
      }
    }
  }

  /**
   * Register an SSE client for a user
   */
  addSSEClient(userId: string, callback: (event: EventPayload) => void): () => void {
    if (!this.sseClients.has(userId)) {
      this.sseClients.set(userId, new Set())
    }
    this.sseClients.get(userId)!.add(callback)

    return () => {
      this.sseClients.get(userId)?.delete(callback)
      if (this.sseClients.get(userId)?.size === 0) {
        this.sseClients.delete(userId)
      }
    }
  }

  /**
   * Get count of active SSE clients
   */
  getSSEClientCount(): number {
    let count = 0
    for (const clients of this.sseClients.values()) {
      count += clients.size
    }
    return count
  }
}

export const eventBus = new EventBus()
export type { EventType, EventPayload }
