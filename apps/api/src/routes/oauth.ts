/**
 * OAuth Routes
 * Google & Microsoft OAuth integration
 */
import { Hono } from 'hono'
import { oauthService } from '../services/oauthService'
import { d1UserDatabase } from '../services/d1UserDatabase'
import { requireAuth } from '../middleware/auth'
import { success, error } from '../utils/response'
import { systemSettingsService } from '../services/systemSettingsService'
import { logger } from '../utils/logger'
import { handleOAuthCallback, getValidOAuthToken, type OAuthProvider } from '../utils/oauth'

const app = new Hono()

/**
 * Get OAuth configuration status
 * GET /oauth/status
 */
app.get('/oauth/status', async (c) => {
  const googleStored = await systemSettingsService.getSecretJson<{ clientId: string }>('oauth_google')
  const msStored = await systemSettingsService.getSecretJson<{ clientId: string }>('oauth_microsoft')
  return success(c, {
    providers: {
      google: {
        configured: !!googleStored?.clientId,
        name: 'Google Gmail',
        description: 'Send emails via Gmail API',
      },
      microsoft: {
        configured: !!msStored?.clientId,
        name: 'Microsoft Outlook/365',
        description: 'Send emails via Microsoft Graph API',
      },
      smtp: {
        configured: true,
        name: 'Custom SMTP',
        description: 'Traditional SMTP server',
      },
    },
  })
})

/**
 * Initiate Google OAuth flow
 * GET /oauth/google/connect
 */
app.get('/oauth/google/connect', async (c) => {
  try {
    const user = requireAuth(c)
    const authUrl = await oauthService.getGoogleAuthUrl(user.id)
    return success(c, { authUrl })
  } catch (err) {
    logger.error('Google OAuth init error:', err)
    return error(c, 'Failed to initiate Google OAuth', 500)
  }
})

/**
 * Initiate Microsoft OAuth flow
 * GET /oauth/microsoft/connect
 */
app.get('/oauth/microsoft/connect', async (c) => {
  try {
    const user = requireAuth(c)
    const authUrl = await oauthService.getMicrosoftAuthUrl(user.id)
    return success(c, { authUrl })
  } catch (err) {
    logger.error('Microsoft OAuth init error:', err)
    return error(c, 'Failed to initiate Microsoft OAuth', 500)
  }
})

/**
 * Google OAuth callback
 * GET /auth/google/callback
 */
app.get('/auth/google/callback', async (c) => {
  const result = await handleOAuthCallback('google', {
    code: c.req.query('code'),
    state: c.req.query('state'),
    error: c.req.query('error'),
  })
  return c.redirect(result.redirectUrl)
})

/**
 * Microsoft OAuth callback
 * GET /auth/microsoft/callback
 */
app.get('/auth/microsoft/callback', async (c) => {
  const result = await handleOAuthCallback('microsoft', {
    code: c.req.query('code'),
    state: c.req.query('state'),
    error: c.req.query('error'),
  })
  return c.redirect(result.redirectUrl)
})

/**
 * Disconnect OAuth account
 * DELETE /oauth/:configId/disconnect
 */
app.delete('/oauth/:configId/disconnect', async (c) => {
  try {
    const user = requireAuth(c)
    const configId = c.req.param('configId')

    const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
    const config = configs.find((cfg) => cfg.id === configId)

    if (!config) {
      return error(c, 'OAuth config not found', 404)
    }

    const deleted = await d1UserDatabase.deleteSMTPConfig(configId, user.id)
    if (!deleted) {
      return error(c, 'Failed to disconnect', 500)
    }

    logger.info(`Disconnected ${config.provider_type} account: ${config.oauth_email}`)
    return success(c, undefined, 'Account disconnected')
  } catch (err) {
    logger.error('OAuth disconnect error:', err)
    return error(c, 'Failed to disconnect', 500)
  }
})

/**
 * Test OAuth connection
 * POST /oauth/:configId/test
 */
app.post('/oauth/:configId/test', async (c) => {
  try {
    const user = requireAuth(c)
    const configId = c.req.param('configId')

    const configs = await d1UserDatabase.getUserSMTPConfigs(user.id)
    const config = configs.find((cfg) => cfg.id === configId)

    if (!config) {
      return error(c, 'OAuth config not found', 404)
    }

    if (!config.oauth_access_token) {
      return error(c, 'No access token', 400)
    }

    try {
      const accessToken = await getValidOAuthToken(config, user.id)
      const isValid = await oauthService.testConnection(
        config.provider_type as OAuthProvider,
        accessToken
      )
      
      return success(
        c,
        { valid: isValid },
        isValid ? '✅ Connection successful' : '❌ Connection failed'
      )
    } catch (refreshError) {
      return error(c, 'Token expired. Please reconnect your account.', 400)
    }
  } catch (err) {
    logger.error('OAuth test error:', err)
    return error(c, 'Connection test failed', 500)
  }
})

export default app
