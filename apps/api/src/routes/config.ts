/**
 * Configuration Routes
 * SMTP and OAuth configuration management
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  CreateSMTPSchema,
  UpdateSMTPSchema,
  TestSMTPSchema,
  CreateProviderSchema,
} from '@dispatch/shared/config'
import { d1UserDatabase } from '../services/d1UserDatabase'
import { requireAuth } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { logger } from '../utils/logger'
import { createTransport, configFromRecord } from '../services/transports'

const configRoutes = new Hono()
  // ==========================================================================
  // List Configurations
  // ==========================================================================
  /**
   * List all user configurations
   * GET /config/list
   */
  .get('/config/list', requirePermission(PERMISSIONS.SMTP_VIEW), async (c) => {
    const user = requireAuth(c)
    const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)

    return success(c, {
      configs: configs.map(formatConfig),
    })
  })
  /**
   * Get SMTP configurations (legacy endpoint)
   * GET /config/smtp
   */
  .get('/config/smtp', requirePermission(PERMISSIONS.SMTP_VIEW), async (c) => {
    const user = requireAuth(c)
    const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
    const defaultConfig = await d1UserDatabase.getUserDefaultSMTPConfig(user.id)

    return success(c, {
      data: defaultConfig ? formatConfigLegacy(defaultConfig) : null,
      hasConfig: !!defaultConfig,
      userConfigs: configs.map(formatConfigLegacy),
      userId: user.id,
    })
  })
  /**
   * Get active configuration
   * GET /config/smtp/active
   */
  .get('/config/smtp/active', requirePermission(PERMISSIONS.SMTP_VIEW), async (c) => {
    const user = requireAuth(c)
    const config = await d1UserDatabase.getUserDefaultSMTPConfig(user.id)

    return success(c, {
      data: config ? formatConfigLegacy(config) : null,
      configId: config?.id,
      configName: config?.name,
    })
  })
  // ==========================================================================
  // Create Configuration
  // ==========================================================================
  /**
   * Create new SMTP configuration
   * POST /config/smtp
   */
  .post('/config/smtp', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', CreateSMTPSchema), async (c) => {
    try {
      const user = requireAuth(c)
      const body = c.req.valid('json')

      const configId = await d1UserDatabase.createSMTPConfig({
        user_id: user.id,
        name: body.name || 'Default Configuration',
        host: body.host,
        port: body.port || 587,
        secure: !!body.secure,
        username: body.user,
        password: body.pass,
        from_email: body.fromEmail || body.from_email,
        from_name: body.fromName || body.from_name || '',
        provider_type: 'smtp',
        is_default: !!body.isDefault || !!body.is_default,
      })

      if (!configId) {
        return error(c, 'Failed to create configuration', 500)
      }

      return success(c, { configId }, '✅ Configuration saved')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error creating config:', err)
      return error(c, 'Failed to save configuration', 500)
    }
  })
  /**
   * Create configuration (frontend-compatible)
   * POST /config/create
   */
  .post('/config/create', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', CreateSMTPSchema), async (c) => {
    try {
      const user = requireAuth(c)
      const body = c.req.valid('json')

      const configId = await d1UserDatabase.createSMTPConfig({
        user_id: user.id,
        name: body.name || 'Default Configuration',
        host: body.host,
        port: body.port || 587,
        secure: !!body.secure,
        username: body.user,
        password: body.pass,
        from_email: body.from_email || body.fromEmail,
        from_name: body.from_name || body.fromName || '',
        provider_type: 'smtp',
        is_default: !!body.is_default || !!body.isDefault,
      })

      return success(c, { configId }, configId ? '✅ Created' : 'Failed')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error creating config:', err)
      return error(c, 'Failed to create', 500)
    }
  })
  // ==========================================================================
  // Update Configuration
  // ==========================================================================
  /**
   * Update SMTP configuration
   * PUT /config/smtp/:configId
   */
  .put('/config/smtp/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', UpdateSMTPSchema), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')
      const body = c.req.valid('json')

      const updates = buildUpdates(body)
      if (Object.keys(updates).length === 0) {
        return error(c, 'No valid fields to update', 400)
      }

      const updated = await d1UserDatabase.updateSMTPConfig(configId, user.id, updates)
      if (!updated) {
        return error(c, 'Configuration not found', 404)
      }

      return success(c, undefined, '✅ Configuration updated')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error updating config:', err)
      return error(c, 'Failed to update configuration', 500)
    }
  })
  /**
   * Update configuration (frontend-compatible)
   * POST /config/update/:configId
   */
  .post('/config/update/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', UpdateSMTPSchema), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')
      const body = c.req.valid('json')

      const updates = buildUpdates(body)
      const updated = await d1UserDatabase.updateSMTPConfig(configId, user.id, updates)

      return success(c, undefined, updated ? '✅ Updated' : 'Not found')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error updating config:', err)
      return error(c, 'Failed to update', 500)
    }
  })
  // ==========================================================================
  // Delete Configuration
  // ==========================================================================
  /**
   * Delete SMTP configuration
   * DELETE /config/smtp/:configId
   */
  .delete('/config/smtp/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')

      const deleted = await d1UserDatabase.deleteSMTPConfig(configId, user.id)
      if (!deleted) {
        return error(c, 'Configuration not found', 404)
      }

      return success(c, undefined, '✅ Configuration deleted')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error deleting config:', err)
      return error(c, 'Failed to delete configuration', 500)
    }
  })
  /**
   * Delete configuration (frontend-compatible)
   * DELETE /config/delete/:configId
   */
  .delete('/config/delete/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')

      const deleted = await d1UserDatabase.deleteSMTPConfig(configId, user.id)
      return success(c, undefined, deleted ? '✅ Deleted' : 'Not found')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error deleting config:', err)
      return error(c, 'Failed to delete', 500)
    }
  })
  // ==========================================================================
  // Set Default & Test
  // ==========================================================================
  /**
   * Set default configuration
   * POST /config/smtp/:configId/default
   */
  .post('/config/smtp/:configId/default', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')

      const updated = await d1UserDatabase.updateSMTPConfig(configId, user.id, { is_default: true })
      if (!updated) {
        return error(c, 'Configuration not found', 404)
      }

      return success(c, undefined, '✅ Default configuration updated')
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error setting default:', err)
      return error(c, 'Failed to set default', 500)
    }
  })
  /**
   * Test SMTP connection
   * POST /config/smtp/test
   */
  .post('/config/smtp/test', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', TestSMTPSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      const { emailService } = await import('../services/emailService')

      const isValid = await emailService.testConnection({
        host: body.host,
        port: body.port,
        secure: body.secure,
        auth: { user: body.user, pass: body.pass },
      })

      return success(
        c,
        { valid: isValid },
        isValid ? '✅ Connection successful' : '❌ Connection failed'
      )
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Connection test error:', err)
      return error(c, 'Connection test failed', 500)
    }
  })
  /**
   * Test configuration by ID
   * POST /config/test/:configId
   */
  .post('/config/test/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')

      const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
      const config = configs.find((cfg) => cfg.id === configId)

      if (!config) {
        return error(c, 'Not found', 404)
      }

      if (config.provider_type !== 'smtp') {
        return error(c, 'Use OAuth test for OAuth configs', 400)
      }

      const { emailService } = await import('../services/emailService')
      const isValid = await emailService.testConnection({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.username, pass: config.password || '' },
      })

      return success(
        c,
        { valid: isValid },
        isValid ? '✅ Success' : '❌ Failed'
      )
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Test error:', err)
      return error(c, 'Test failed', 500)
    }
  })
  // ==========================================================================
  // API Provider Configuration (SES, Mailgun, SendGrid)
  // ==========================================================================
  /**
   * Create API provider configuration
   * POST /config/provider
   */
  .post('/config/provider', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', CreateProviderSchema), async (c) => {
    try {
      const user = requireAuth(c)
      const body = c.req.valid('json')

      const providerType = body.provider_type

      const configId = await d1UserDatabase.createSMTPConfig({
        user_id: user.id,
        name: body.name || `${providerType.toUpperCase()} Configuration`,
        host: providerType === 'mailgun' ? body.domain : '',
        port: 0,
        secure: false,
        username: providerType === 'ses' ? body.access_key_id : '',
        password: providerType === 'ses' ? body.secret_access_key : body.api_key,
        from_email: body.from_email,
        from_name: body.from_name || '',
        provider_type: providerType,
        is_default: !!body.is_default,
        // API-specific fields stored as extra data
        api_key: body.api_key,
        api_secret: providerType === 'ses' ? body.secret_access_key : undefined,
        api_region: body.region || body.api_region,
        api_domain: body.domain || body.api_domain,
      })

      if (!configId) {
        return error(c, 'Failed to create configuration', 500)
      }

      return success(c, { configId }, `${providerType.toUpperCase()} configuration saved`)
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Error creating provider config:', err)
      return error(c, 'Failed to save configuration', 500)
    }
  })
  /**
   * Test any provider configuration by ID
   * POST /config/provider/test/:configId
   */
  .post('/config/provider/test/:configId', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    try {
      const user = requireAuth(c)
      const configId = c.req.param('configId')

      const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
      const config = configs.find((cfg) => cfg.id === configId)

      if (!config) {
        return error(c, 'Not found', 404)
      }

      const transport = createTransport(configFromRecord(config as any))
      const isValid = await transport.verify()

      return success(
        c,
        { valid: isValid, provider: transport.name },
        isValid ? `${transport.name.toUpperCase()} connection verified` : `${transport.name.toUpperCase()} connection failed`
      )
    } catch (err) {
      if ((err as any)?.name === 'AppError') throw err // let global onError map validation 400s
      logger.error('Provider test error:', err)
      return error(c, 'Test failed', 500)
    }
  })
  // ==========================================================================
  // Fetch Verified Domains from Provider API
  // ==========================================================================
  .post('/config/fetch-domains', requirePermission(PERMISSIONS.SMTP_MANAGE), async (c) => {
    const body = await c.req.json() as { provider_type: string; api_key: string; api_secret?: string; api_region?: string }
    const { provider_type, api_key, api_secret, api_region } = body

    if (!provider_type || !api_key) return error(c, 'provider_type and api_key required', 400)

    try {
      let domains: string[] = []

      switch (provider_type) {
        case 'ses': {
          if (!api_region) return error(c, 'api_region required for SES', 400)
          // SES: ListIdentities via Query API
          const url = `https://email.${api_region}.amazonaws.com/?Action=ListIdentities&IdentityType=Domain&Version=2010-12-01`
          // SES requires SigV4 — use SMTP credential derivation instead
          // For now, we can't easily call SES API without AWS SDK, so return guidance
          domains = []
          return success(c, {
            domains,
            note: 'SES domain auto-fetch requires AWS SDK. Enter your verified domain manually — check AWS Console → SES → Verified Identities.',
          })
        }

        case 'sendgrid': {
          const res = await fetch('https://api.sendgrid.com/v3/whitelabel/domains', {
            headers: { Authorization: `Bearer ${api_key}` },
          })
          if (res.ok) {
            const data = await res.json() as any[]
            domains = data.filter(d => d.valid).map(d => d.domain)
          }
          break
        }

        case 'mailgun': {
          const region = api_region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
          const res = await fetch(`${region}/v3/domains`, {
            headers: { Authorization: `Basic ${Buffer.from(`api:${api_key}`).toString('base64')}` },
          })
          if (res.ok) {
            const data = await res.json() as any
            domains = (data.items || []).map((d: any) => d.name)
          }
          break
        }

        case 'postmark': {
          const res = await fetch('https://api.postmarkapp.com/sender-signatures', {
            headers: { 'X-Postmark-Server-Token': api_key, Accept: 'application/json' },
          })
          if (res.ok) {
            const data = await res.json() as any
            domains = (data.SenderSignatures || [])
              .filter((s: any) => s.Confirmed)
              .map((s: any) => s.Domain || s.EmailAddress?.split('@')[1])
              .filter(Boolean)
            // Deduplicate
            domains = [...new Set(domains)]
          }
          break
        }

        case 'sparkpost': {
          const res = await fetch('https://api.sparkpost.com/api/v1/sending-domains', {
            headers: { Authorization: api_key },
          })
          if (res.ok) {
            const data = await res.json() as any
            domains = (data.results || [])
              .filter((d: any) => d.status?.ownership_verified)
              .map((d: any) => d.domain)
          }
          break
        }

        default:
          return error(c, 'Domain fetch not supported for this provider type', 400)
      }

      return success(c, { domains })
    } catch (e: any) {
      return error(c, `Failed to fetch domains: ${e.message}`, 500)
    }
  })

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format config for API response
 */
function formatConfig(config: any) {
  const base: Record<string, any> = {
    id: config.id,
    name: config.name,
    provider_type: config.provider_type || 'smtp',
    from_email: config.from_email,
    from_name: config.from_name,
    is_default: config.is_default,
    oauth_email: config.oauth_email,
    created_at: config.created_at,
  }

  // Include SMTP-specific fields only for SMTP
  if (!config.provider_type || config.provider_type === 'smtp') {
    base.host = config.host
    base.port = config.port
    base.secure = config.secure
    base.user = config.username
  }

  // Include API region/domain for API providers
  if (['ses', 'mailgun', 'sendgrid'].includes(config.provider_type)) {
    base.api_region = config.api_region
    base.api_domain = config.api_domain
  }

  return base
}

/**
 * Format config for legacy API response
 */
function formatConfigLegacy(config: any) {
  return {
    id: config.id,
    name: config.name,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.username,
    fromEmail: config.from_email,
    fromName: config.from_name,
    isDefault: config.is_default,
    createdAt: config.created_at,
  }
}

/**
 * Build updates object from request body
 */
function buildUpdates(body: Record<string, any>) {
  const updates: Record<string, any> = {}

  if (body.name !== undefined) updates.name = body.name
  if (body.host !== undefined) updates.host = body.host
  if (body.port !== undefined) updates.port = body.port
  if (body.secure !== undefined) updates.secure = body.secure
  if (body.user !== undefined) updates.username = body.user
  if (body.pass) updates.password = body.pass
  if (body.fromEmail !== undefined) updates.from_email = body.fromEmail
  if (body.from_email !== undefined) updates.from_email = body.from_email
  if (body.fromName !== undefined) updates.from_name = body.fromName
  if (body.from_name !== undefined) updates.from_name = body.from_name
  if (body.isDefault !== undefined) updates.is_default = body.isDefault
  if (body.is_default !== undefined) updates.is_default = body.is_default
  if (body.api_key !== undefined) updates.api_key = body.api_key
  if (body.api_secret !== undefined) updates.api_secret = body.api_secret
  if (body.api_region !== undefined) updates.api_region = body.api_region
  if (body.api_domain !== undefined) updates.api_domain = body.api_domain

  return updates
}

export default configRoutes
export type ConfigRoutes = typeof configRoutes
