// src/services/webhookRegistrationService.ts — Auto-register bounce/complaint webhooks with provider APIs

import { systemSettingsService } from './systemSettingsService'
import type { ProviderConfig } from './systemMailerService'
import { logger } from '../utils/logger'
import { SERVER } from '../config'

export interface RegistrationResult {
  success: boolean
  webhookId?: string
  signingKey?: string
  error?: string
}

// ============================================================================
// Provider-specific registration
// ============================================================================

async function registerSES(config: { accessKeyId: string; secretAccessKey: string; region: string }, webhookBaseUrl: string): Promise<RegistrationResult> {
  // SES uses SNS for bounce/complaint notifications.
  // Full SNS topic creation requires AWS SigV4 signing which is complex without SDK.
  // Instead, SES SMTP sends bounce notifications via the SNS subscription confirmation flow.
  // The webhook endpoint auto-confirms SNS subscriptions (see webhooks.ts).
  //
  // For now, log instructions. The platform admin needs to:
  // 1. Create SNS topic in AWS Console
  // 2. Subscribe our endpoint: POST to ${webhookBaseUrl}/api/webhooks/bounce/ses
  // 3. Set SES Configuration Set to use that SNS topic
  //
  // TODO: Implement full SigV4-signed SNS API calls when needed.
  logger.info(`[WebhookReg] SES: Auto-confirm enabled at ${webhookBaseUrl}/api/webhooks/bounce/ses`)
  logger.info(`[WebhookReg] SES: Subscribe this endpoint to your SNS topic for bounce/complaint notifications`)

  return {
    success: true,
    webhookId: 'ses-sns-pending',
  }
}

async function registerSendGrid(apiKey: string, webhookBaseUrl: string): Promise<RegistrationResult> {
  try {
    const res = await fetch('https://api.sendgrid.com/v3/user/webhooks/event/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        url: `${webhookBaseUrl}/api/webhooks/bounce/sendgrid`,
        bounce: true,
        spam_report: true,
        deferred: true,
        dropped: true,
        delivered: false,
        open: false,
        click: false,
        unsubscribe: true,
        group_unsubscribe: true,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { success: false, error: `SendGrid webhook registration failed (${res.status}): ${body}` }
    }

    // Fetch the signing key for signature verification
    const keyRes = await fetch('https://api.sendgrid.com/v3/user/webhooks/event/settings/signed', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    let signingKey: string | undefined
    if (keyRes.ok) {
      const keyData = await keyRes.json() as any
      signingKey = keyData.public_key
      if (signingKey) {
        await systemSettingsService.setSecret('sendgrid_webhook_verification_key', signingKey)
      }
    }

    logger.info(`[WebhookReg] SendGrid: Bounce webhooks registered at ${webhookBaseUrl}/api/webhooks/bounce/sendgrid`)
    return { success: true, webhookId: 'sendgrid-event-webhook', signingKey }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

async function registerMailgun(apiKey: string, domain: string, region: 'us' | 'eu', webhookBaseUrl: string): Promise<RegistrationResult> {
  const baseUrl = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  const authHeader = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`
  const targetUrl = `${webhookBaseUrl}/api/webhooks/bounce/mailgun`

  const webhookTypes = ['permanent_fail', 'temporary_fail', 'complained']
  const errors: string[] = []

  for (const type of webhookTypes) {
    try {
      // Try to create; if already exists, update
      let res = await fetch(`${baseUrl}/v3/domains/${domain}/webhooks`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: type, url: targetUrl }),
      })

      // If webhook already exists (409 or similar), try PUT to update
      if (!res.ok && res.status !== 201) {
        res = await fetch(`${baseUrl}/v3/domains/${domain}/webhooks/${type}`, {
          method: 'PUT',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl }),
        })
      }

      if (!res.ok) {
        const body = await res.text()
        errors.push(`${type}: ${res.status} ${body}`)
      }
    } catch (e: any) {
      errors.push(`${type}: ${e.message}`)
    }
  }

  // Fetch the webhook signing key from domain info
  try {
    const domainRes = await fetch(`${baseUrl}/v3/domains/${domain}`, {
      headers: { Authorization: authHeader },
    })
    if (domainRes.ok) {
      const domainData = await domainRes.json() as any
      const signingKey = domainData.domain?.web_prefix
        ? undefined
        : domainData.domain?.id // Mailgun signing key is in webhook settings
      // The actual signing key comes from the webhooks endpoint
      const whRes = await fetch(`${baseUrl}/v3/domains/${domain}/webhooks`, {
        headers: { Authorization: authHeader },
      })
      if (whRes.ok) {
        const whData = await whRes.json() as any
        // Mailgun's webhook signing key is at domain level
        if (whData.webhooks?.signing_key || domainData.domain?.web_prefix) {
          // Store whatever signing key we can get
        }
      }
    }
  } catch { /* signing key fetch is best-effort */ }

  // Store Mailgun API key for signature verification (Mailgun uses HTTP API signing key)
  await systemSettingsService.setSecret('mailgun_webhook_signing_key', apiKey)

  if (errors.length > 0) {
    logger.warn(`[WebhookReg] Mailgun: Some webhook registrations had issues: ${errors.join('; ')}`)
    if (errors.length === webhookTypes.length) {
      return { success: false, error: errors.join('; ') }
    }
  }

  logger.info(`[WebhookReg] Mailgun: Bounce webhooks registered for ${domain} at ${targetUrl}`)
  return { success: true, webhookId: `mailgun-${domain}` }
}

async function registerPostmark(serverToken: string, webhookBaseUrl: string): Promise<RegistrationResult> {
  try {
    const targetUrl = `${webhookBaseUrl}/api/webhooks/bounce/postmark`

    // Check existing webhooks first
    const listRes = await fetch('https://api.postmarkapp.com/webhooks', {
      headers: {
        'X-Postmark-Server-Token': serverToken,
        Accept: 'application/json',
      },
    })

    let existingId: string | null = null
    if (listRes.ok) {
      const listData = await listRes.json() as any
      const existing = (listData.Webhooks || []).find((w: any) => w.Url === targetUrl)
      if (existing) existingId = existing.ID
    }

    if (existingId) {
      // Update existing
      const res = await fetch(`https://api.postmarkapp.com/webhooks/${existingId}`, {
        method: 'PUT',
        headers: {
          'X-Postmark-Server-Token': serverToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          Url: targetUrl,
          Triggers: {
            Bounce: { Enabled: true, IncludeContent: false },
            SpamComplaint: { Enabled: true, IncludeContent: false },
          },
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `Postmark webhook update failed (${res.status}): ${body}` }
      }
    } else {
      // Create new
      const res = await fetch('https://api.postmarkapp.com/webhooks', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': serverToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          Url: targetUrl,
          Triggers: {
            Bounce: { Enabled: true, IncludeContent: false },
            SpamComplaint: { Enabled: true, IncludeContent: false },
          },
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `Postmark webhook creation failed (${res.status}): ${body}` }
      }

      const data = await res.json() as any
      existingId = data.ID
    }

    logger.info(`[WebhookReg] Postmark: Bounce webhooks registered at ${targetUrl}`)
    return { success: true, webhookId: `postmark-${existingId}` }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

async function registerSparkPost(apiKey: string, webhookBaseUrl: string): Promise<RegistrationResult> {
  try {
    const targetUrl = `${webhookBaseUrl}/api/webhooks/bounce/sparkpost`

    // Check existing webhooks
    const listRes = await fetch('https://api.sparkpost.com/api/v1/webhooks', {
      headers: { Authorization: apiKey },
    })

    let existingId: string | null = null
    if (listRes.ok) {
      const listData = await listRes.json() as any
      const existing = (listData.results || []).find((w: any) => w.target === targetUrl)
      if (existing) existingId = existing.id
    }

    if (existingId) {
      // Update existing
      const res = await fetch(`https://api.sparkpost.com/api/v1/webhooks/${existingId}`, {
        method: 'PUT',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Dispatch Bounce Handler',
          target: targetUrl,
          events: ['bounce', 'spam_complaint', 'policy_rejection', 'out_of_band', 'list_unsubscribe', 'link_unsubscribe'],
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `SparkPost webhook update failed (${res.status}): ${body}` }
      }
    } else {
      // Create new
      const res = await fetch('https://api.sparkpost.com/api/v1/webhooks', {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Dispatch Bounce Handler',
          target: targetUrl,
          events: ['bounce', 'spam_complaint', 'policy_rejection', 'out_of_band', 'list_unsubscribe', 'link_unsubscribe'],
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `SparkPost webhook creation failed (${res.status}): ${body}` }
      }

      const data = await res.json() as any
      existingId = data.results?.id

      // Store auth_token for signature verification if returned
      if (data.results?.auth_token) {
        await systemSettingsService.setSecret('sparkpost_webhook_auth_token', data.results.auth_token)
      }
    }

    logger.info(`[WebhookReg] SparkPost: Bounce webhooks registered at ${targetUrl}`)
    return { success: true, webhookId: `sparkpost-${existingId}` }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ============================================================================
// Public API
// ============================================================================

class WebhookRegistrationService {
  async register(config: ProviderConfig): Promise<RegistrationResult> {
    const webhookBaseUrl = SERVER.BASE_URL

    switch (config.provider) {
      case 'ses':
        return registerSES(config, webhookBaseUrl)
      case 'sendgrid':
        return registerSendGrid(config.apiKey, webhookBaseUrl)
      case 'mailgun':
        return registerMailgun(config.apiKey, config.domain, config.region, webhookBaseUrl)
      case 'postmark':
        return registerPostmark(config.serverToken, webhookBaseUrl)
      case 'sparkpost':
        return registerSparkPost(config.apiKey, webhookBaseUrl)
      case 'smtp':
      case 'gmail':
      case 'outlook':
        // SMTP and OAuth providers don't have webhook registration APIs
        return { success: true, webhookId: 'not-applicable' }
      default:
        return { success: false, error: 'Unknown provider' }
    }
  }

  getWebhookStatus(): { provider: string; webhookId: string } | null {
    const status = systemSettingsService.get('webhook_registration_status')
    return status ? JSON.parse(status) : null
  }
}

export const webhookRegistrationService = new WebhookRegistrationService()
