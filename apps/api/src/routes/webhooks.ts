// src/routes/webhooks.ts - Webhook Management API + Inbound Bounce Processing

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { webhookService } from '../services/webhookService'
import { parseSES, parseMailgun, parseSendGrid, parsePostmark, parseSparkPost, processBounce } from '../services/bounceProcessor'
import {
  verifySNSSignature,
  verifyMailgunSignature,
  verifySendGridSignature,
  verifySparkPostSignature,
  getMailgunSigningKey,
  getSendGridVerificationKey,
  getSparkPostAuthToken,
} from '../middleware/webhookSignature'
import { success, error } from '../utils/response'
import { logger } from '../utils/logger'
import { auditFromContext } from '../services/audit/context'

// ============================================================================
// Schemas
// ============================================================================

const CreateWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  url: z.string().url('Invalid URL format'),
  events: z.array(z.string()).min(1, 'At least one event type is required'),
  headers: z.record(z.string(), z.string()).optional(),
})

const UpdateWebhookSchema = CreateWebhookSchema.partial()

const ToggleWebhookSchema = z.object({
  enabled: z.boolean(),
})

// ============================================================================
// Webhook CRUD
// ============================================================================

const webhooksRoutes = new Hono()
  .get('/webhooks', requirePermission(PERMISSIONS.WEBHOOKS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const webhooks = await webhookService.list(orgId)

  // Hide secrets in list view
  const safe = webhooks.map(w => ({ ...w, secret: w.secret.substring(0, 8) + '...' }))
  return success(c, { webhooks: safe })
  })
  .post('/webhooks', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), zValidator('json', CreateWebhookSchema), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = c.req.valid('json')

  const webhook = await webhookService.create(orgId, user.id, body)
  auditFromContext(c, { action: 'webhook.created', entityType: 'webhook', entityId: webhook.id })
  return success(c, { ...webhook, secret: webhook.secret.substring(0, 8) + '...' }, 'Webhook created', 201)
  })
  .get('/webhooks/:id', requirePermission(PERMISSIONS.WEBHOOKS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')

  const webhook = await webhookService.get(orgId, webhookId)
  if (!webhook) return error(c, 'Webhook not found', 404)

  return success(c, { ...webhook, secret: webhook.secret.substring(0, 8) + '...' })
  })
  .put('/webhooks/:id', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), zValidator('json', UpdateWebhookSchema), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')
  const body = c.req.valid('json')

  const updated = await webhookService.update(orgId, webhookId, body)
  if (!updated) return error(c, 'Webhook not found', 404)

  auditFromContext(c, { action: 'webhook.updated', entityType: 'webhook', entityId: webhookId })
  return success(c, undefined, 'Webhook updated')
  })
  .delete('/webhooks/:id', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')

  const deleted = await webhookService.delete(orgId, webhookId)
  if (!deleted) return error(c, 'Webhook not found', 404)

  auditFromContext(c, { action: 'webhook.deleted', entityType: 'webhook', entityId: webhookId })
  return success(c, undefined, 'Webhook deleted')
  })
  // ==========================================================================
  // Webhook Actions
  // ==========================================================================
  .post('/webhooks/:id/toggle', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), zValidator('json', ToggleWebhookSchema), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')
  const body = c.req.valid('json')

  const toggled = await webhookService.toggleEnabled(orgId, webhookId, body.enabled)
  if (!toggled) return error(c, 'Webhook not found', 404)

  auditFromContext(c, { action: 'webhook.toggled', entityType: 'webhook', entityId: webhookId })
  return success(c, undefined, body.enabled ? 'Webhook enabled' : 'Webhook disabled')
  })
  .post('/webhooks/:id/test', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')

  const result = await webhookService.testWebhook(orgId, webhookId)
  return success(c, result, result.success ? 'Test successful' : 'Test failed')
  })
  // ==========================================================================
  // Webhook Logs
  // ==========================================================================
  .get('/webhooks/:id/logs', requirePermission(PERMISSIONS.WEBHOOKS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  const webhook = await webhookService.get(orgId, webhookId)
  if (!webhook) return error(c, 'Webhook not found', 404)

  const logs = await webhookService.getLogs(webhookId, limit, offset)
  return success(c, { logs })
  })
  .delete('/webhooks/:id/logs', requirePermission(PERMISSIONS.WEBHOOKS_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const webhookId = c.req.param('id')

  const webhook = await webhookService.get(orgId, webhookId)
  if (!webhook) return error(c, 'Webhook not found', 404)

  const cleared = await webhookService.clearLogs(webhookId)
  auditFromContext(c, { action: 'webhook.logs_cleared', entityType: 'webhook', entityId: webhookId })
  return success(c, { cleared }, `${cleared} log(s) cleared`)
  })
  // ==========================================================================
  // Inbound Bounce/Complaint Webhooks (public — no auth)
  // Providers call these endpoints to notify us of bounces, complaints, unsubs.
  // Each endpoint includes signature verification when keys are available.
  // ==========================================================================
  // --- AWS SES (via SNS) ---
  .post('/webhooks/bounce/ses', async (c) => {
  try {
    const payload = await c.req.json()

    // Auto-confirm SNS subscription
    if (payload.Type === 'SubscriptionConfirmation') {
      if (payload.SubscribeURL) {
        logger.info('[Webhook] SNS: Auto-confirming subscription...')
        await fetch(payload.SubscribeURL)
        logger.info('[Webhook] SNS: Subscription confirmed')
      }
      return c.json({ ok: true, message: 'Subscription confirmed' })
    }

    // Verify SNS signature
    if (payload.SigningCertURL) {
      const valid = await verifySNSSignature(payload)
      if (!valid) {
        logger.warn('[Webhook] SES: Invalid SNS signature')
        return c.json({ ok: false, error: 'Invalid signature' }, 401)
      }
    }

    const event = parseSES(payload)
    if (!event) {
      return c.json({ ok: true, message: 'Ignored (not a bounce/complaint)' })
    }

    const userId = 'system'
    await processBounce(userId, event)

    return c.json({ ok: true, processed: event.type })
  } catch (err) {
    logger.error('SES webhook error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  // --- Mailgun ---
  .post('/webhooks/bounce/mailgun', async (c) => {
  try {
    const payload = await c.req.json()

    // Verify Mailgun signature if signing key is available
    const signingKey = await getMailgunSigningKey()
    if (signingKey) {
      const eventData = payload['event-data'] || payload
      const sig = eventData.signature || payload.signature
      if (sig && sig.timestamp && sig.token && sig.signature) {
        const valid = verifyMailgunSignature(sig.timestamp, sig.token, sig.signature, signingKey)
        if (!valid) {
          logger.warn('[Webhook] Mailgun: Invalid signature')
          return c.json({ ok: false, error: 'Invalid signature' }, 401)
        }
      }
    }

    const event = parseMailgun(payload)
    if (!event) {
      return c.json({ ok: true, message: 'Ignored' })
    }

    const userId = 'system'
    await processBounce(userId, event)

    return c.json({ ok: true, processed: event.type })
  } catch (err) {
    logger.error('Mailgun webhook error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  // --- SendGrid ---
  .post('/webhooks/bounce/sendgrid', async (c) => {
  try {
    const rawBody = await c.req.text()

    // Verify SendGrid signature if verification key is available
    const verificationKey = await getSendGridVerificationKey()
    if (verificationKey) {
      const signature = c.req.header('x-twilio-email-event-webhook-signature')
      const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp')
      if (signature && timestamp) {
        const valid = verifySendGridSignature(verificationKey, rawBody, signature, timestamp)
        if (!valid) {
          logger.warn('[Webhook] SendGrid: Invalid signature')
          return c.json({ ok: false, error: 'Invalid signature' }, 401)
        }
      }
    }

    const payload = JSON.parse(rawBody)
    const events = Array.isArray(payload) ? payload : [payload]
    const bounceEvents = parseSendGrid(events)

    for (const event of bounceEvents) {
      await processBounce('system', event)
    }

    return c.json({ ok: true, processed: bounceEvents.length })
  } catch (err) {
    logger.error('SendGrid webhook error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  // --- Postmark ---
  .post('/webhooks/bounce/postmark', async (c) => {
  try {
    const payload = await c.req.json()

    // Postmark doesn't use signature verification — relies on webhook URL secrecy
    // and optional basic auth (configured at Postmark's end)

    const event = parsePostmark(payload)
    if (!event) {
      return c.json({ ok: true, message: 'Ignored' })
    }

    await processBounce('system', event)

    return c.json({ ok: true, processed: event.type })
  } catch (err) {
    logger.error('Postmark webhook error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  // --- SparkPost ---
  .post('/webhooks/bounce/sparkpost', async (c) => {
  try {
    const rawBody = await c.req.text()

    // Verify SparkPost signature if auth token is available
    const authToken = await getSparkPostAuthToken()
    if (authToken) {
      const signature = c.req.header('x-messagesystems-webhook-token')
      if (signature) {
        const valid = verifySparkPostSignature(rawBody, signature, authToken)
        if (!valid) {
          logger.warn('[Webhook] SparkPost: Invalid signature')
          return c.json({ ok: false, error: 'Invalid signature' }, 401)
        }
      }
    }

    const payload = JSON.parse(rawBody)
    const events = parseSparkPost(payload)

    for (const event of events) {
      await processBounce('system', event)
    }

    return c.json({ ok: true, processed: events.length })
  } catch (err) {
    logger.error('SparkPost webhook error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  // ==========================================================================
  // Inbound Email (Reply Tracking)
  // Providers forward inbound emails to these endpoints.
  // We match replies to campaigns via In-Reply-To / References headers.
  // ==========================================================================
  .post('/webhooks/inbound/sendgrid', async (c) => {
  try {
    // SendGrid Inbound Parse sends multipart/form-data
    const body = await c.req.parseBody()
    const from = String(body.from || '')
    const to = String(body.to || '')
    const subject = String(body.subject || '')
    const text = String(body.text || '')
    const inReplyTo = String(body.headers || '').match(/In-Reply-To:\s*<([^>]+)>/i)?.[1] || ''

    logger.info(`[Reply] Inbound from ${from} — subject: ${subject}${inReplyTo ? ` — reply to: ${inReplyTo}` : ''}`)

    eventBus.emit('email_reply_received', {
      provider: 'sendgrid',
      from,
      to,
      subject,
      textBody: text.substring(0, 1000),
      inReplyTo,
    })

    return c.json({ ok: true })
  } catch (err) {
    logger.error('SendGrid inbound error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  .post('/webhooks/inbound/mailgun', async (c) => {
  try {
    const body = await c.req.parseBody()
    const from = String(body.from || body.sender || '')
    const to = String(body.recipient || '')
    const subject = String(body.subject || '')
    const text = String(body['body-plain'] || '')
    const inReplyTo = String(body['In-Reply-To'] || body['message-headers'] || '')
      .match(/<([^>]+)>/)?.[1] || ''

    logger.info(`[Reply] Inbound from ${from} — subject: ${subject}`)

    eventBus.emit('email_reply_received', {
      provider: 'mailgun',
      from,
      to,
      subject,
      textBody: text.substring(0, 1000),
      inReplyTo,
    })

    return c.json({ ok: true })
  } catch (err) {
    logger.error('Mailgun inbound error:', err)
    return c.json({ ok: false }, 400)
  }
  })
  .post('/webhooks/inbound/postmark', async (c) => {
  try {
    const payload = await c.req.json()
    const from = payload.FromFull?.Email || payload.From || ''
    const to = payload.ToFull?.[0]?.Email || payload.To || ''
    const subject = payload.Subject || ''
    const text = payload.TextBody || ''
    const inReplyTo = (payload.Headers || []).find((h: any) => h.Name === 'In-Reply-To')?.Value?.replace(/[<>]/g, '') || ''

    logger.info(`[Reply] Inbound from ${from} — subject: ${subject}`)

    eventBus.emit('email_reply_received', {
      provider: 'postmark',
      from,
      to,
      subject,
      textBody: text.substring(0, 1000),
      inReplyTo,
    })

    return c.json({ ok: true })
  } catch (err) {
    logger.error('Postmark inbound error:', err)
    return c.json({ ok: false }, 400)
  }
  })

export default webhooksRoutes
export type WebhooksRoutes = typeof webhooksRoutes
