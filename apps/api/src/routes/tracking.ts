/**
 * Tracking Routes
 * - Status check for tracking configuration
 * - Inbound tracking-event sink for the Cloudflare worker (open/click)
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { d1Service } from '../services/d1Service'
import { contactService } from '../services/contactService'
import { eventBus } from '../services/eventBus'
import { TRACKING } from '../config'
import { logger } from '../utils/logger'
import { success, error } from '../utils/response'

/**
 * Inbound tracking event sink (server-to-server, called by the CF worker).
 * POST /tracking/event  -> resolves to /api/tracking/event under the /api mount.
 *
 * Auth: shared secret ONLY (header X-Tracking-Secret). This endpoint has no
 * session cookie, so the secret is its sole gate — it FAILS CLOSED: if the
 * configured secret is empty/undefined, or the header is missing/mismatched,
 * the request is rejected and nothing is emitted.
 *
 * Body (from worker): { type: 'open'|'click', email, campaignId?, messageId?, url? }
 * (campaignId/messageId may be null; url only present on click.)
 */
const eventSchema = z.object({
  type: z.enum(['open', 'click']),
  email: z.string().min(1),
  campaignId: z.string().nullish(),
  messageId: z.string().nullish(),
  url: z.string().nullish(),
})

const TYPE_MAP = {
  open: 'email_opened',
  click: 'email_clicked',
} as const

/**
 * Constant-time-ish secret comparison. Both operands are already strings; we
 * length-check first then XOR every char so a mismatch in length or content is
 * indistinguishable timing-wise within reason. (Plain === would also be
 * acceptable per spec; this avoids leaking length via early-return.)
 */
function secretsMatch(provided: string, expected: string): boolean {
  if (expected.length === 0) return false // fail closed: not configured
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

const trackingRoutes = new Hono()
  /**
   * Get tracking status
   * GET /track/status
   */
  .get('/track/status', (c) => {
    return success(c, {
      enabled: d1Service.isConfigured(),
      workerUrl: d1Service.getWorkerUrl(),
    })
  })
  // POST /tracking/event — secret-gated (auth before body parse; manual parse
  // keeps the fail-closed secret check ahead of validation, so an unauthorized
  // caller can't probe payload validity).
  .post('/tracking/event', async (c) => {
    // --- Auth: shared secret, fail closed -----------------------------------
    const provided = c.req.header('X-Tracking-Secret') || ''
    const expected = TRACKING.TRACKING_SYNC_SECRET || ''
    if (!secretsMatch(provided, expected)) {
      return error(c, 'Unauthorized', 401)
    }

    // --- Parse + validate body ----------------------------------------------
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return error(c, 'Invalid JSON body', 400)
    }

    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) {
      return error(c, 'Invalid tracking event payload', 400)
    }

    const { type, email, campaignId, messageId, url } = parsed.data
    const mappedType = TYPE_MAP[type]

    // --- Resolve contact (best-effort, cross-org) ---------------------------
    const contact = await contactService.getContactByEmail(email)
    if (!contact) {
      // Nothing to advance — acknowledge so the worker doesn't retry.
      return c.json({ ok: true, matched: false })
    }

    // contactId is the 5th arg (top-level on the event) so scoringEngine and the
    // automation subscriber both see it. campaignId is the 4th arg (top-level).
    try {
      await eventBus.emit(
        mappedType,
        contact.user_id,
        { email, url: url ?? undefined, campaignId: campaignId ?? undefined, messageId: messageId ?? undefined },
        campaignId || undefined,
        contact.id
      )
    } catch (err) {
      logger.error('Tracking event emit failed:', err)
    }

    return c.json({ ok: true })
  })

export default trackingRoutes
export type TrackingRoutes = typeof trackingRoutes
