import { generateId } from '../utils/id'

/**
 * D1 Tracking Service
 * Connects to Cloudflare Worker for email tracking
 * 
 * Flow:
 * 1. When sending email → call Worker API to register email, get tracking_id
 * 2. Inject tracking pixel + wrapped links using tracking_id
 * 3. Worker handles opens/clicks and stores in D1
 * 4. Reports page fetches stats from Worker API
 */

import { logger } from '../utils/logger'

interface TrackingConfig {
  workerUrl: string
  enabled: boolean
}

class D1Service {
  private config: TrackingConfig

  constructor() {
    this.config = {
      workerUrl: process.env.TRACKING_WORKER_URL || '',
      enabled: !!process.env.TRACKING_WORKER_URL
    }
  }

  initialize(): boolean {
    if (this.config.workerUrl) {
      logger.info(`Tracking Worker: ${this.config.workerUrl}`)
      return true
    }
    logger.warn('Tracking Worker not configured (TRACKING_WORKER_URL)')
    return false
  }

  isConfigured(): boolean {
    return this.config.enabled
  }

  getWorkerUrl(): string {
    return this.config.workerUrl
  }

  /**
   * Register email with tracking worker
   * Returns tracking_id to use in pixel/links
   */
  async registerEmail(data: {
    userId: string
    campaignId: string
    campaignName: string
    subject: string
    fromEmail: string
    fromName?: string
    recipientEmail: string
    recipientName?: string
    sendType: 'direct' | 'batch' | 'scheduled'
    providerType: 'smtp' | 'google' | 'microsoft'
    configName: string
    messageId?: string
  }): Promise<{ trackingId: string; emailId: string } | null> {
    if (!this.config.enabled) return null

    try {
      const response = await fetch(`${this.config.workerUrl}/api/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: data.userId,
          campaign_id: data.campaignId,
          campaign_name: data.campaignName,
          subject: data.subject,
          from_email: data.fromEmail,
          from_name: data.fromName,
          recipient_email: data.recipientEmail,
          recipient_name: data.recipientName,
          send_type: data.sendType,
          provider_type: data.providerType,
          config_name: data.configName,
          message_id: data.messageId
        })
      })

      if (!response.ok) {
        logger.error('Failed to register email with tracker:', await response.text())
        return null
      }

      const result = await response.json() as { success: boolean; tracking_id: string; email_id: string }
      return result.success ? { trackingId: result.tracking_id, emailId: result.email_id } : null

    } catch (error) {
      logger.error('Error registering email with tracker:', error)
      return null
    }
  }

  /**
   * Get tracking pixel URL
   */
  getPixelUrl(trackingId: string): string {
    return `${this.config.workerUrl}/o/${trackingId}`
  }

  /**
   * Get click tracking URL
   */
  getClickUrl(trackingId: string, originalUrl: string): string {
    return `${this.config.workerUrl}/c/${trackingId}?url=${encodeURIComponent(originalUrl)}`
  }

  /**
   * Inject tracking into email HTML
   */
  injectTracking(htmlContent: string, trackingId: string): string {
    if (!this.config.enabled || !trackingId) return htmlContent

    let content = htmlContent

    // Wrap links for click tracking
    const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi
    content = content.replace(linkRegex, (match, before, url, after) => {
      // Skip special URLs
      if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#')) {
        return match
      }
      const trackedUrl = this.getClickUrl(trackingId, url)
      return `<a ${before}href="${trackedUrl}"${after}>`
    })

    // Add tracking pixel before </body> or at end
    const pixelUrl = this.getPixelUrl(trackingId)
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;visibility:hidden;" alt="" />`
    
    if (content.includes('</body>')) {
      content = content.replace('</body>', `${pixel}</body>`)
    } else {
      content += pixel
    }

    return content
  }

  /**
   * Get stats from Worker
   */
  async getStats(userId: string, campaignId?: string): Promise<any> {
    if (!this.config.enabled) return null

    try {
      let url = `${this.config.workerUrl}/api/stats?user_id=${userId}`
      if (campaignId) url += `&campaign_id=${campaignId}`

      const response = await fetch(url)
      if (!response.ok) return null

      const data = await response.json() as any
      return data.success ? data.data : null

    } catch (error) {
      logger.error('Error fetching stats:', error)
      return null
    }
  }

  /**
   * Get logs from Worker with filtering
   */
  async getLogs(userId: string, options?: {
    status?: string
    sendType?: string
    provider?: string
    campaignId?: string
    search?: string
    startDate?: string
    endDate?: string
    page?: number
    limit?: number
  }): Promise<{ logs: any[]; stats: any; pagination: any } | null> {
    if (!this.config.enabled) return null

    try {
      const params = new URLSearchParams({ user_id: userId })
      
      if (options?.status) params.set('status', options.status)
      if (options?.sendType) params.set('send_type', options.sendType)
      if (options?.provider) params.set('provider', options.provider)
      if (options?.campaignId) params.set('campaign_id', options.campaignId)
      if (options?.search) params.set('search', options.search)
      if (options?.startDate) params.set('start_date', options.startDate)
      if (options?.endDate) params.set('end_date', options.endDate)
      if (options?.page) params.set('page', options.page.toString())
      if (options?.limit) params.set('limit', options.limit.toString())

      const response = await fetch(`${this.config.workerUrl}/api/logs?${params}`)
      if (!response.ok) return null

      const data = await response.json() as any
      return data.success ? data : null

    } catch (error) {
      logger.error('Error fetching logs:', error)
      return null
    }
  }

  /**
   * Generate campaign ID
   */
  generateCampaignId(): string {
    return generateId('c')
  }

  /**
   * Delete single log
   */
  async deleteLog(userId: string, logId: string): Promise<boolean> {
    if (!this.config.enabled) {
      logger.debug('D1 not configured, skipping delete')
      return false
    }

    try {
      const url = `${this.config.workerUrl}/api/logs/${logId}?user_id=${userId}`
      logger.debug(`Calling worker: DELETE ${url}`)
      
      const response = await fetch(url, { method: 'DELETE' })
      const text = await response.text()
      logger.debug(`Worker response: ${response.status} - ${text}`)
      
      return response.ok
    } catch (error) {
      logger.error('Error deleting log:', error)
      return false
    }
  }

  /**
   * Delete multiple logs
   */
  async deleteLogs(userId: string, logIds: string[]): Promise<boolean> {
    if (!this.config.enabled) return false

    try {
      const response = await fetch(`${this.config.workerUrl}/api/logs/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ids: logIds })
      })
      return response.ok
    } catch (error) {
      logger.error('Error deleting logs:', error)
      return false
    }
  }
}

export const d1Service = new D1Service()
