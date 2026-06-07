// src/services/bouncePollingService.ts — Poll provider APIs for bounces/complaints as backup

import { systemMailerService, type ProviderConfig } from './systemMailerService'
import { processBounce, type BounceEvent } from './bounceProcessor'
import { systemSettingsService } from './systemSettingsService'
import { logger } from '../utils/logger'

const POLL_STATE_KEY = 'bounce_poll_last_run'

class BouncePollingService {
  private interval: ReturnType<typeof setInterval> | null = null

  /**
   * Poll provider API for bounces since last check.
   * Returns number of new bounces processed.
   */
  async poll(): Promise<number> {
    const config = await systemMailerService.getConfig()
    if (!config) return 0

    const pc = config.providerConfig
    const lastRun = systemSettingsService.get(POLL_STATE_KEY) || new Date(Date.now() - 3600000).toISOString()
    let processed = 0

    try {
      switch (pc.provider) {
        case 'sendgrid':
          processed = await this.pollSendGrid(pc.apiKey, lastRun)
          break
        case 'mailgun':
          processed = await this.pollMailgun(pc.apiKey, pc.domain, pc.region, lastRun)
          break
        case 'postmark':
          processed = await this.pollPostmark(pc.serverToken, lastRun)
          break
        case 'sparkpost':
          processed = await this.pollSparkPost(pc.apiKey, lastRun)
          break
        default:
          // SMTP, SES, Gmail, Outlook don't have polling APIs (use webhooks)
          break
      }
    } catch (e: any) {
      logger.error(`[BouncePoll] Error polling ${pc.provider}: ${e.message}`)
    }

    systemSettingsService.set(POLL_STATE_KEY, new Date().toISOString())
    if (processed > 0) logger.info(`[BouncePoll] Processed ${processed} bounces via ${pc.provider} API`)
    return processed
  }

  private async pollSendGrid(apiKey: string, since: string): Promise<number> {
    let processed = 0

    // Fetch bounces
    const bouncesRes = await fetch(`https://api.sendgrid.com/v3/suppression/bounces?start_time=${Math.floor(new Date(since).getTime() / 1000)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (bouncesRes.ok) {
      const bounces = await bouncesRes.json() as any[]
      for (const b of bounces) {
        const event: BounceEvent = {
          email: b.email,
          type: 'hard_bounce',
          reason: b.reason || 'Bounce',
          code: b.status,
          provider: 'sendgrid',
        }
        await processBounce('system', event)
        processed++
      }
    }

    // Fetch spam reports
    const spamRes = await fetch(`https://api.sendgrid.com/v3/suppression/spam_reports?start_time=${Math.floor(new Date(since).getTime() / 1000)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (spamRes.ok) {
      const reports = await spamRes.json() as any[]
      for (const r of reports) {
        const event: BounceEvent = {
          email: r.email,
          type: 'complaint',
          reason: 'Spam report (API poll)',
          provider: 'sendgrid',
        }
        await processBounce('system', event)
        processed++
      }
    }

    return processed
  }

  private async pollMailgun(apiKey: string, domain: string, region: 'us' | 'eu', since: string): Promise<number> {
    const baseUrl = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
    const auth = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`
    let processed = 0

    const res = await fetch(`${baseUrl}/v3/${domain}/events?event=failed OR complained&begin=${new Date(since).toISOString()}&limit=100`, {
      headers: { Authorization: auth },
    })

    if (res.ok) {
      const data = await res.json() as any
      for (const item of data.items || []) {
        const event: BounceEvent = {
          email: item.recipient,
          type: item.event === 'complained' ? 'complaint' : item.severity === 'permanent' ? 'hard_bounce' : 'soft_bounce',
          reason: item['delivery-status']?.message || item.event,
          provider: 'mailgun',
        }
        await processBounce('system', event)
        processed++
      }
    }

    return processed
  }

  private async pollPostmark(serverToken: string, since: string): Promise<number> {
    let processed = 0

    const res = await fetch(`https://api.postmarkapp.com/bounces?count=100&offset=0&fromdate=${since.split('T')[0]}`, {
      headers: { 'X-Postmark-Server-Token': serverToken, Accept: 'application/json' },
    })

    if (res.ok) {
      const data = await res.json() as any
      for (const b of data.Bounces || []) {
        if (new Date(b.BouncedAt) <= new Date(since)) continue
        const event: BounceEvent = {
          email: b.Email,
          type: b.Type === 'HardBounce' ? 'hard_bounce' : b.Type === 'SpamComplaint' ? 'complaint' : 'soft_bounce',
          reason: b.Description || b.Type,
          provider: 'postmark',
        }
        await processBounce('system', event)
        processed++
      }
    }

    return processed
  }

  private async pollSparkPost(apiKey: string, since: string): Promise<number> {
    let processed = 0

    const res = await fetch(`https://api.sparkpost.com/api/v1/events/message?events=bounce,spam_complaint&from=${since}`, {
      headers: { Authorization: apiKey },
    })

    if (res.ok) {
      const data = await res.json() as any
      for (const r of data.results || []) {
        const email = r.rcpt_to || r.raw_rcpt_to
        if (!email) continue
        const event: BounceEvent = {
          email,
          type: r.type === 'spam_complaint' ? 'complaint' : 'hard_bounce',
          reason: r.reason || r.type,
          provider: 'sparkpost',
        }
        await processBounce('system', event)
        processed++
      }
    }

    return processed
  }

  // ---------- Worker ----------

  startWorker(intervalMs = 900000): void { // 15 minutes
    if (this.interval) return
    this.interval = setInterval(() => this.poll(), intervalMs)
    logger.info('[BouncePoll] Polling worker started (15 min interval)')
  }

  stopWorker(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }
}

export const bouncePollingService = new BouncePollingService()
