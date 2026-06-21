// src/services/gdprService.ts — GDPR Data Subject Access Request (DSAR) export
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { contacts, event_analytics, engagement_events, email_logs } from '../db/pg/schema'
import { contactService } from './contactService'

export interface RecipientExport {
  contact: Record<string, unknown>
  events: Record<string, unknown>[]
  engagement: Record<string, unknown>[]
  emailLogs: Record<string, unknown>[]
}

class GdprService {
  async exportRecipient(orgId: string, contactId: string): Promise<RecipientExport | null> {
    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return null
    const db = getDb()
    const [events, engagement, emailLogs] = await Promise.all([
      db.select().from(event_analytics).where(
        and(eq(event_analytics.org_id, orgId), eq(event_analytics.recipient_email, contact.email))
      ),
      db.select().from(engagement_events).where(eq(engagement_events.contact_id, contactId)),
      db.select().from(email_logs).where(
        and(eq(email_logs.org_id, orgId), eq(email_logs.email, contact.email))
      ),
    ])
    return { contact: contact as unknown as Record<string, unknown>, events, engagement, emailLogs }
  }
}

export const gdprService = new GdprService()
