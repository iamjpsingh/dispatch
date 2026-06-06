// src/services/cloudflareService.ts — Cloudflare OAuth + Worker deployment + D1 management

import { systemSettingsService } from './systemSettingsService'
import { generateWorkerScript } from '../templates/tracking-worker'
import { TRACKING_SCHEMA_SQL } from '../templates/tracking-schema'
import { SERVER } from '../config'
import { logger } from '../utils/logger'

const CF_API = 'https://api.cloudflare.com/client/v4'

// ============================================================================
// Types
// ============================================================================

export interface CloudflareConnection {
  accessToken: string
  refreshToken: string
  accountId: string
  accountName: string
  expiresAt: number
}

export interface CloudflareZone {
  id: string
  name: string
  status: string
  plan: string
}

export interface TrackingDeployment {
  zoneId: string
  domain: string
  workerName: string
  d1DatabaseId: string
  openPath: string
  clickPath: string
  unsubPath: string
  useSubdomain: boolean
  subdomain?: string
  routeIds: string[]
  deployedAt: string
}

export interface TrackingStats {
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  unsubscribes: number
  topLinks: { url: string; clicks: number }[]
}

// ============================================================================
// Helper: Cloudflare API request
// ============================================================================

async function cfFetch<T = any>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<{ success: boolean; result: T; errors: any[] }> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const data = await res.json() as any
  if (!data.success) {
    const errMsg = data.errors?.map((e: any) => e.message).join(', ') || 'Cloudflare API error'
    throw new Error(errMsg)
  }
  return data
}

// ============================================================================
// Cloudflare Service
// ============================================================================

class CloudflareService {
  private settingsKey(orgId: string): string {
    return `cloudflare_connection_${orgId}`
  }

  private deploymentKey(orgId: string, domain: string): string {
    return `cloudflare_deployment_${orgId}_${domain}`
  }

  // ---------- OAuth ----------

  getAuthUrl(orgId: string): string {
    const cfOAuth = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>('cloudflare_oauth')
    if (!cfOAuth) throw new Error('Cloudflare OAuth credentials not configured')

    const state = Buffer.from(JSON.stringify({ orgId, purpose: 'cloudflare_connect' })).toString('base64url')

    const params = new URLSearchParams({
      client_id: cfOAuth.clientId,
      redirect_uri: `${SERVER.BASE_URL}/api/admin/cloudflare/callback`,
      response_type: 'code',
      scope: 'account:read zone:read workers_scripts:write workers_routes:write d1:write',
      state,
    })

    return `https://dash.cloudflare.com/oauth2/authorize?${params}`
  }

  async exchangeCode(code: string): Promise<CloudflareConnection> {
    const cfOAuth = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>('cloudflare_oauth')
    if (!cfOAuth) throw new Error('Cloudflare OAuth credentials not configured')

    const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfOAuth.clientId,
        client_secret: cfOAuth.clientSecret,
        code,
        redirect_uri: `${SERVER.BASE_URL}/api/admin/cloudflare/callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Cloudflare token exchange failed: ${body}`)
    }

    const tokens = await res.json() as any

    // Get account info
    const accountRes = await cfFetch<any[]>(tokens.access_token, '/accounts')
    const account = accountRes.result[0]

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accountId: account.id,
      accountName: account.name,
      expiresAt: Date.now() + (tokens.expires_in || 86400) * 1000,
    }
  }

  async refreshToken(connection: CloudflareConnection): Promise<string> {
    if (Date.now() < connection.expiresAt - 60000) return connection.accessToken

    const cfOAuth = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>('cloudflare_oauth')
    if (!cfOAuth) throw new Error('Cloudflare OAuth credentials not configured')

    const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfOAuth.clientId,
        client_secret: cfOAuth.clientSecret,
        refresh_token: connection.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!res.ok) throw new Error('Failed to refresh Cloudflare token')
    const tokens = await res.json() as any

    connection.accessToken = tokens.access_token
    connection.expiresAt = Date.now() + (tokens.expires_in || 86400) * 1000

    return connection.accessToken
  }

  // ---------- Connection management ----------

  saveConnection(orgId: string, connection: CloudflareConnection): void {
    systemSettingsService.setJson(this.settingsKey(orgId), connection)
  }

  getConnection(orgId: string): CloudflareConnection | null {
    return systemSettingsService.getJson<CloudflareConnection>(this.settingsKey(orgId))
  }

  removeConnection(orgId: string): void {
    systemSettingsService.delete(this.settingsKey(orgId))
  }

  async getToken(orgId: string): Promise<string> {
    const conn = this.getConnection(orgId)
    if (!conn) throw new Error('Cloudflare not connected')
    return this.refreshToken(conn)
  }

  // ---------- Zones ----------

  async listZones(orgId: string): Promise<CloudflareZone[]> {
    const token = await this.getToken(orgId)
    const conn = this.getConnection(orgId)!

    const data = await cfFetch<CloudflareZone[]>(token, `/zones?account.id=${conn.accountId}&per_page=50`)
    return data.result.map(z => ({
      id: z.id,
      name: z.name,
      status: z.status,
      plan: (z as any).plan?.name || 'free',
    }))
  }

  // ---------- Worker deployment ----------

  async deployTrackingWorker(
    orgId: string,
    zoneId: string,
    domain: string,
    options: {
      openPath?: string
      clickPath?: string
      unsubPath?: string
      useSubdomain?: boolean
      subdomain?: string
    } = {},
  ): Promise<TrackingDeployment> {
    const token = await this.getToken(orgId)
    const conn = this.getConnection(orgId)!
    const accountId = conn.accountId

    const openPath = options.openPath || 'o'
    const clickPath = options.clickPath || 'c'
    const unsubPath = options.unsubPath || 'u'
    const workerName = `dispatch-tracking-${domain.replace(/\./g, '-')}`
    const dbName = `dispatch-tracking-${domain.replace(/\./g, '-')}`

    // 1. Create D1 database
    logger.info(`[CF] Creating D1 database: ${dbName}`)
    const dbRes = await cfFetch<{ uuid: string }>(token, `/accounts/${accountId}/d1/database`, {
      method: 'POST',
      body: JSON.stringify({ name: dbName }),
    })
    const d1DatabaseId = dbRes.result.uuid

    // 2. Run schema SQL on D1
    logger.info(`[CF] Initializing D1 schema`)
    await cfFetch(token, `/accounts/${accountId}/d1/database/${d1DatabaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql: TRACKING_SCHEMA_SQL }),
    })

    // 3. Generate and upload Worker script
    const script = generateWorkerScript({
      openPath,
      clickPath,
      unsubPath,
      d1Binding: 'TRACKING_DB',
    })

    logger.info(`[CF] Deploying Worker: ${workerName}`)

    // Upload worker with D1 binding metadata
    const formData = new FormData()
    formData.append('script', new Blob([script], { type: 'application/javascript' }), 'worker.js')
    formData.append('metadata', JSON.stringify({
      main_module: 'worker.js',
      bindings: [{
        type: 'd1',
        name: 'TRACKING_DB',
        id: d1DatabaseId,
      }],
    }))

    const workerRes = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    if (!workerRes.ok) {
      const body = await workerRes.text()
      throw new Error(`Worker deployment failed: ${body}`)
    }

    // 4. Create Worker Routes
    const trackingDomain = options.useSubdomain && options.subdomain
      ? `${options.subdomain}.${domain}`
      : domain

    const routePatterns = [
      `${trackingDomain}/${openPath}/*`,
      `${trackingDomain}/${clickPath}/*`,
      `${trackingDomain}/${unsubPath}/*`,
    ]

    const routeIds: string[] = []
    for (const pattern of routePatterns) {
      logger.info(`[CF] Creating route: ${pattern}`)
      const routeRes = await cfFetch<{ id: string }>(token, `/zones/${zoneId}/workers/routes`, {
        method: 'POST',
        body: JSON.stringify({ pattern, script: workerName }),
      })
      routeIds.push(routeRes.result.id)
    }

    // 5. If subdomain, create DNS record
    if (options.useSubdomain && options.subdomain) {
      logger.info(`[CF] Creating DNS CNAME for ${options.subdomain}.${domain}`)
      try {
        await cfFetch(token, `/zones/${zoneId}/dns_records`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'AAAA',
            name: `${options.subdomain}.${domain}`,
            content: '100::',
            proxied: true,
          }),
        })
      } catch (e: any) {
        logger.warn(`[CF] DNS record creation failed (may already exist): ${e.message}`)
      }
    }

    // 6. Save deployment config
    const deployment: TrackingDeployment = {
      zoneId,
      domain,
      workerName,
      d1DatabaseId,
      openPath,
      clickPath,
      unsubPath,
      useSubdomain: !!options.useSubdomain,
      subdomain: options.subdomain,
      routeIds,
      deployedAt: new Date().toISOString(),
    }

    systemSettingsService.setJson(this.deploymentKey(orgId, domain), deployment)
    logger.info(`[CF] Tracking deployed for ${domain}: ${routePatterns.join(', ')}`)

    return deployment
  }

  // ---------- Undeploy ----------

  async undeployTrackingWorker(orgId: string, domain: string): Promise<void> {
    const token = await this.getToken(orgId)
    const conn = this.getConnection(orgId)!
    const deployment = this.getDeployment(orgId, domain)
    if (!deployment) throw new Error('No deployment found for this domain')

    // Remove routes
    for (const routeId of deployment.routeIds) {
      try {
        await cfFetch(token, `/zones/${deployment.zoneId}/workers/routes/${routeId}`, {
          method: 'DELETE',
        })
      } catch { /* route may already be removed */ }
    }

    // Delete worker
    try {
      await cfFetch(token, `/accounts/${conn.accountId}/workers/scripts/${deployment.workerName}`, {
        method: 'DELETE',
      })
    } catch { /* worker may already be removed */ }

    // Remove deployment config
    systemSettingsService.delete(this.deploymentKey(orgId, domain))
    logger.info(`[CF] Tracking undeployed for ${domain}`)
  }

  // ---------- Deployment info ----------

  getDeployment(orgId: string, domain: string): TrackingDeployment | null {
    return systemSettingsService.getJson<TrackingDeployment>(this.deploymentKey(orgId, domain))
  }

  getAllDeployments(orgId: string): TrackingDeployment[] {
    const all = systemSettingsService.getAll()
    const prefix = `cloudflare_deployment_${orgId}_`
    return Object.entries(all)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => JSON.parse(value) as TrackingDeployment)
  }

  // ---------- D1 Analytics ----------

  async getTrackingStats(orgId: string, domain: string, campaignId?: string): Promise<TrackingStats> {
    const token = await this.getToken(orgId)
    const conn = this.getConnection(orgId)!
    const deployment = this.getDeployment(orgId, domain)
    if (!deployment) throw new Error('No deployment found')

    const dbId = deployment.d1DatabaseId
    const accountId = conn.accountId

    const whereClause = campaignId
      ? `WHERE e.email_id IN (SELECT id FROM emails WHERE campaign_id = '${campaignId}')`
      : ''

    const sql = `
      SELECT
        (SELECT COUNT(*) FROM events ${whereClause ? whereClause + ' AND' : 'WHERE'} type = 'open') as opens,
        (SELECT COUNT(DISTINCT email_id) FROM events ${whereClause ? whereClause + ' AND' : 'WHERE'} type = 'open') as unique_opens,
        (SELECT COUNT(*) FROM events ${whereClause ? whereClause + ' AND' : 'WHERE'} type = 'click') as clicks,
        (SELECT COUNT(DISTINCT email_id) FROM events ${whereClause ? whereClause + ' AND' : 'WHERE'} type = 'click') as unique_clicks,
        (SELECT COUNT(*) FROM events ${whereClause ? whereClause + ' AND' : 'WHERE'} type = 'unsubscribe') as unsubscribes
    `

    const statsRes = await cfFetch<any[]>(token, `/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    })

    const row = statsRes.result?.[0]?.results?.[0] || {}

    // Top links
    const linksSql = `
      SELECT l.original_url as url, COUNT(e.id) as clicks
      FROM events e
      JOIN links l ON e.link_id = l.id
      WHERE e.type = 'click'
      GROUP BY l.original_url
      ORDER BY clicks DESC
      LIMIT 10
    `
    let topLinks: { url: string; clicks: number }[] = []
    try {
      const linksRes = await cfFetch<any[]>(token, `/accounts/${accountId}/d1/database/${dbId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql: linksSql }),
      })
      topLinks = linksRes.result?.[0]?.results || []
    } catch { /* ignore if query fails */ }

    return {
      opens: row.opens || 0,
      uniqueOpens: row.unique_opens || 0,
      clicks: row.clicks || 0,
      uniqueClicks: row.unique_clicks || 0,
      unsubscribes: row.unsubscribes || 0,
      topLinks,
    }
  }

  // ---------- Register email for tracking ----------

  async registerEmail(
    orgId: string,
    domain: string,
    options: {
      emailId: string
      campaignId: string
      recipient: string
      subject: string
      links: string[]
    },
  ): Promise<{
    pixelUrl: string
    unsubUrl: string
    linkMap: Record<string, string>
  }> {
    const token = await this.getToken(orgId)
    const conn = this.getConnection(orgId)!
    const deployment = this.getDeployment(orgId, domain)
    if (!deployment) throw new Error('No tracking deployment for this domain')

    const dbId = deployment.d1DatabaseId
    const accountId = conn.accountId
    const trackingDomain = deployment.useSubdomain && deployment.subdomain
      ? `${deployment.subdomain}.${domain}`
      : domain

    // Insert email record
    await cfFetch(token, `/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        sql: 'INSERT INTO emails (id, campaign_id, recipient, subject) VALUES (?, ?, ?, ?)',
        params: [options.emailId, options.campaignId, options.recipient, options.subject],
      }),
    })

    // Insert link records and build map
    const linkMap: Record<string, string> = {}
    for (const originalUrl of options.links) {
      const linkId = crypto.randomUUID().replace(/-/g, '').substring(0, 12)
      await cfFetch(token, `/accounts/${accountId}/d1/database/${dbId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          sql: 'INSERT INTO links (id, email_id, original_url) VALUES (?, ?, ?)',
          params: [linkId, options.emailId, originalUrl],
        }),
      })
      linkMap[originalUrl] = `https://${trackingDomain}/${deployment.clickPath}/${linkId}`
    }

    return {
      pixelUrl: `https://${trackingDomain}/${deployment.openPath}/${options.emailId}`,
      unsubUrl: `https://${trackingDomain}/${deployment.unsubPath}/${options.emailId}`,
      linkMap,
    }
  }
}

export const cloudflareService = new CloudflareService()
