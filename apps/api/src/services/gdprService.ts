// src/services/gdprService.ts — GDPR Data Subject Access Request (DSAR) export + erasure
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { contacts, event_analytics, engagement_events, email_logs } from '../db/pg/schema'
import { contactService } from './contactService'
import { suppressionStore } from './queue/suppressionStore'
import { auditService } from './auditService'
import { hashEmail } from '../utils/suppressionHash'

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
      contact.email
        ? db.select().from(event_analytics).where(
            and(eq(event_analytics.org_id, orgId), eq(event_analytics.recipient_email, contact.email))
          )
        : Promise.resolve([]),
      db.select().from(engagement_events).where(eq(engagement_events.contact_id, contactId)),
      contact.email
        ? db.select().from(email_logs).where(
            and(eq(email_logs.org_id, orgId), eq(email_logs.email, contact.email))
          )
        : Promise.resolve([]),
    ])
    return { contact: contact as unknown as Record<string, unknown>, events, engagement, emailLogs }
  }

  async eraseRecipient(orgId: string, contactId: string, actorId: string): Promise<boolean> {
    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return false
    const email = contact.email
    const db = getDb()
    if (email) {
      const hash = hashEmail(email)
      await db.transaction(async (tx) => {
        await tx.update(event_analytics).set({ recipient_email: null })
          .where(and(eq(event_analytics.org_id, orgId), eq(event_analytics.recipient_email, email)))
        await tx.update(email_logs).set({ email: '[erased]', first_name: null, company: null })
          .where(and(eq(email_logs.org_id, orgId), eq(email_logs.email, email)))
        await tx.update(contacts)
          .set({ email: null, first_name: null, last_name: null, company: null, phone: null, custom_fields: '{}', status: 'erased', updated_at: new Date().toISOString() })
          .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
      })
      await suppressionStore.suppressByHash(contact.user_id, orgId, hash, 'gdpr_erasure')
    } else {
      // already anonymized — idempotent no-op beyond ensuring tombstone status
      await db.update(contacts).set({ status: 'erased' }).where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
    }
    auditService.log({ orgId, actorId, action: 'contacts.erased', entityType: 'contact', entityId: contactId })
    return true
  }
}

export const gdprService = new GdprService()
