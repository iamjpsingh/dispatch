// src/services/sendingDomainService.ts — Domain + Sending Email Management (Postgres/Drizzle, async)

import { and, eq, desc, or, isNull } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { sending_domains, sending_emails } from '../db/pg/schema'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'

// ============================================================================
// Types
// ============================================================================

export interface SendingDomain {
  id: string
  org_id: string
  domain: string
  verification_status: 'pending' | 'verified' | 'failed'
  dkim_selector: string | null
  dkim_record: string | null
  spf_included: number
  return_path: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface SendingEmail {
  id: string
  org_id: string
  domain_id: string
  email: string
  display_name: string | null
  is_default: number
  assigned_to: string | null
  status: 'active' | 'disabled'
  created_at: string
}

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class SendingDomainService {
  // ---------- Domains ----------

  async addDomain(orgId: string, domain: string): Promise<SendingDomain> {
    const db = getDb()
    const id = generateId('dom')
    const normalized = domain.toLowerCase().trim()

    const [existing] = await db
      .select({ id: sending_domains.id })
      .from(sending_domains)
      .where(and(eq(sending_domains.org_id, orgId), eq(sending_domains.domain, normalized)))
      .limit(1)
    if (existing) throw new Error(`Domain "${normalized}" already exists`)

    // Generate DKIM selector
    const selector = `dispatch${Date.now() % 10000}`

    await db.insert(sending_domains).values({
      id,
      org_id: orgId,
      domain: normalized,
      dkim_selector: selector,
      return_path: `bounce.${normalized}`,
    })

    logger.info(`[Domain] Added ${normalized} for org ${orgId}`)
    const [row] = await db.select().from(sending_domains).where(eq(sending_domains.id, id)).limit(1)
    return row as SendingDomain
  }

  async listDomains(orgId: string): Promise<SendingDomain[]> {
    const rows = await getDb()
      .select()
      .from(sending_domains)
      .where(eq(sending_domains.org_id, orgId))
      .orderBy(desc(sending_domains.created_at))
    return rows as SendingDomain[]
  }

  async getDomain(orgId: string, domainId: string): Promise<SendingDomain | null> {
    const [row] = await getDb()
      .select()
      .from(sending_domains)
      .where(and(eq(sending_domains.id, domainId), eq(sending_domains.org_id, orgId)))
      .limit(1)
    return (row as SendingDomain) ?? null
  }

  /**
   * Get DNS record guidance for a domain.
   * These are informational — actual DNS records come from your email provider
   * (SES, SendGrid, Mailgun, etc.), not from Dispatch.
   */
  getDnsRecords(domain: SendingDomain): { type: string; name: string; value: string; purpose: string }[] {
    return [
      {
        type: 'INFO',
        name: 'SPF Record',
        value: `Add your email provider's SPF include to your domain's TXT record. Example: v=spf1 include:amazonses.com ~all`,
        purpose: 'SPF — Authorizes your provider to send on behalf of your domain. Get the exact value from your provider (SES, SendGrid, Mailgun, etc.).',
      },
      {
        type: 'INFO',
        name: 'DKIM Record',
        value: `Your email provider generates DKIM keys. Add the CNAME or TXT record they give you.`,
        purpose: 'DKIM — Signs emails cryptographically. Each provider has their own DKIM setup process.',
      },
      {
        type: 'INFO',
        name: 'DMARC Record',
        value: `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${domain.domain}`,
        purpose: 'DMARC — Tells receivers what to do with unauthenticated mail. Add as TXT record at _dmarc.' + domain.domain,
      },
      {
        type: 'INFO',
        name: 'Where to get DNS records',
        value: `SES: AWS Console → SES → Verified Identities. SendGrid: Settings → Sender Authentication. Mailgun: Domains → DNS Records. Postmark: Sender Signatures.`,
        purpose: 'Each delivery server provider gives you specific DNS records to add. Check your provider dashboard.',
      },
    ]
  }

  /**
   * Verify domain DNS records. In production, this would do DNS lookups.
   * For now, marks as verified when called.
   */
  async verifyDomain(orgId: string, domainId: string): Promise<boolean> {
    const ts = now()
    const res = await getDb()
      .update(sending_domains)
      .set({ verification_status: 'verified', verified_at: ts, updated_at: ts })
      .where(and(eq(sending_domains.id, domainId), eq(sending_domains.org_id, orgId)))
      .returning({ id: sending_domains.id })
    return res.length > 0
  }

  async deleteDomain(orgId: string, domainId: string): Promise<boolean> {
    const res = await getDb()
      .delete(sending_domains)
      .where(and(eq(sending_domains.id, domainId), eq(sending_domains.org_id, orgId)))
      .returning({ id: sending_domains.id })
    return res.length > 0
  }

  // ---------- Sending Emails ----------

  async addEmail(orgId: string, domainId: string, email: string, displayName?: string, assignedTo?: string): Promise<SendingEmail> {
    const db = getDb()
    const id = generateId('se')

    // Verify domain belongs to org
    const domain = await this.getDomain(orgId, domainId)
    if (!domain) throw new Error('Domain not found')

    // Verify email matches domain
    const emailDomain = email.split('@')[1]?.toLowerCase()
    if (emailDomain !== domain.domain) throw new Error(`Email must be on domain ${domain.domain}`)

    await db.insert(sending_emails).values({
      id,
      org_id: orgId,
      domain_id: domainId,
      email: email.toLowerCase(),
      display_name: displayName || null,
      assigned_to: assignedTo || null,
    })

    const [row] = await db.select().from(sending_emails).where(eq(sending_emails.id, id)).limit(1)
    return row as SendingEmail
  }

  async listEmails(orgId: string, domainId?: string): Promise<SendingEmail[]> {
    const conditions = [eq(sending_emails.org_id, orgId)]
    if (domainId) conditions.push(eq(sending_emails.domain_id, domainId))
    const rows = await getDb()
      .select()
      .from(sending_emails)
      .where(and(...conditions))
      .orderBy(desc(sending_emails.created_at))
    return rows as SendingEmail[]
  }

  /**
   * Get sending emails available to a specific user.
   * Returns emails assigned to them or to everyone (assigned_to IS NULL).
   */
  async listEmailsForUser(orgId: string, userId: string): Promise<(SendingEmail & { domain: string; verification_status: string })[]> {
    const rows = await getDb()
      .select({
        id: sending_emails.id,
        org_id: sending_emails.org_id,
        domain_id: sending_emails.domain_id,
        email: sending_emails.email,
        display_name: sending_emails.display_name,
        is_default: sending_emails.is_default,
        assigned_to: sending_emails.assigned_to,
        status: sending_emails.status,
        created_at: sending_emails.created_at,
        domain: sending_domains.domain,
        verification_status: sending_domains.verification_status,
      })
      .from(sending_emails)
      .innerJoin(sending_domains, eq(sending_emails.domain_id, sending_domains.id))
      .where(
        and(
          eq(sending_emails.org_id, orgId),
          eq(sending_emails.status, 'active'),
          or(isNull(sending_emails.assigned_to), eq(sending_emails.assigned_to, userId))!,
          eq(sending_domains.verification_status, 'verified')
        )
      )
      .orderBy(desc(sending_emails.is_default), desc(sending_emails.created_at))
    return rows as (SendingEmail & { domain: string; verification_status: string })[]
  }

  async updateEmail(orgId: string, emailId: string, updates: { display_name?: string; assigned_to?: string | null; is_default?: boolean }): Promise<boolean> {
    const db = getDb()
    const values: Partial<typeof sending_emails.$inferInsert> = {}

    if (updates.display_name !== undefined) values.display_name = updates.display_name
    if (updates.assigned_to !== undefined) values.assigned_to = updates.assigned_to
    if (updates.is_default !== undefined) {
      if (updates.is_default) {
        // Clear other defaults in org
        await db.update(sending_emails).set({ is_default: 0 }).where(eq(sending_emails.org_id, orgId))
      }
      values.is_default = updates.is_default ? 1 : 0
    }

    if (Object.keys(values).length === 0) return false

    const res = await db
      .update(sending_emails)
      .set(values)
      .where(and(eq(sending_emails.id, emailId), eq(sending_emails.org_id, orgId)))
      .returning({ id: sending_emails.id })
    return res.length > 0
  }

  async deleteEmail(orgId: string, emailId: string): Promise<boolean> {
    const res = await getDb()
      .delete(sending_emails)
      .where(and(eq(sending_emails.id, emailId), eq(sending_emails.org_id, orgId)))
      .returning({ id: sending_emails.id })
    return res.length > 0
  }
}

export const sendingDomainService = new SendingDomainService()
