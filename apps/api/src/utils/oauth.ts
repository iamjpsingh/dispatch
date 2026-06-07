/**
 * OAuth Utilities
 * Shared OAuth handling logic — unified callback for both user and platform admin flows
 */
import { SERVER } from '../config'
import { logger } from './logger'
import { d1UserDatabase } from '../services/d1UserDatabase'
import { oauthService } from '../services/oauthService'
import { rbacService } from '../services/rbacService'
import { systemMailerService } from '../services/systemMailerService'
import type { SystemMailerConfig } from '../services/systemMailerService'
import { systemSettingsService } from '../services/systemSettingsService'

export type OAuthProvider = 'google' | 'microsoft'

interface OAuthCallbackParams {
  code: string | undefined
  state: string | undefined
  error: string | undefined
}

interface OAuthCallbackResult {
  success: boolean
  redirectUrl: string
}

/**
 * Handle OAuth callback for any provider
 * Routes to user OAuth or platform mailer based on state.purpose
 */
export async function handleOAuthCallback(
  provider: OAuthProvider,
  params: OAuthCallbackParams
): Promise<OAuthCallbackResult> {
  const frontendUrl = SERVER.FRONTEND_URL
  const { code, state, error } = params

  // Handle OAuth errors
  if (error) {
    // No state to determine admin status, try to fall back to /settings
    return {
      success: false,
      redirectUrl: `${frontendUrl}/settings/delivery-servers?error=${provider}_denied`,
    }
  }

  // Validate required params
  if (!code || !state) {
    return {
      success: false,
      redirectUrl: `${frontendUrl}/settings/delivery-servers?error=invalid_callback`,
    }
  }

  // Validate state
  const stateData = oauthService.validateState(state)
  if (!stateData || stateData.provider !== provider) {
    return {
      success: false,
      redirectUrl: `${frontendUrl}/settings/delivery-servers?error=invalid_state`,
    }
  }

  // Route to platform mailer handler if this is a platform admin flow
  if (stateData.purpose === 'platform_mailer') {
    return handlePlatformMailerCallback(provider, code, stateData.userId)
  }

  // User-level OAuth flow
  try {
    const tokens = provider === 'google'
      ? await oauthService.exchangeGoogleCode(code)
      : await oauthService.exchangeMicrosoftCode(code)

    const existingConfigs = await d1UserDatabase.getUserSMTPConfigs(stateData.userId)
    const existingConfig = existingConfigs.find(
      (cfg) => cfg.provider_type === provider && cfg.oauth_email === tokens.email
    )

    if (existingConfig) {
      await d1UserDatabase.updateSMTPConfig(existingConfig.id, stateData.userId, {
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_expires_at: new Date(tokens.expires_at).toISOString(),
      })
      logger.debug(`Updated ${provider} OAuth for: ${tokens.email}`)
    } else {
      const configName = provider === 'google' ? `Gmail - ${tokens.name}` : `Outlook - ${tokens.name}`
      await d1UserDatabase.createSMTPConfig({
        user_id: stateData.userId,
        name: configName,
        provider_type: provider,
        oauth_email: tokens.email,
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_expires_at: new Date(tokens.expires_at).toISOString(),
        is_default: existingConfigs.length === 0,
      })
      logger.info(`Connected ${provider} account: ${tokens.email}`)
    }

    // Redirect platform admin to /platform/settings, org user to /settings
    const isPlatformAdmin = await rbacService.isPlatformAdmin(stateData.userId)
    const settingsPath = isPlatformAdmin ? '/platform/settings/delivery-servers' : '/settings/delivery-servers'

    return {
      success: true,
      redirectUrl: `${frontendUrl}${settingsPath}?success=${provider}_connected`,
    }
  } catch (err) {
    logger.error(`${provider} OAuth callback error:`, err)
    const isPlatformAdmin = await rbacService.isPlatformAdmin(stateData.userId)
    const settingsPath = isPlatformAdmin ? '/platform/settings/delivery-servers' : '/settings/delivery-servers'
    return {
      success: false,
      redirectUrl: `${frontendUrl}${settingsPath}?error=${provider}_failed`,
    }
  }
}

/**
 * Handle platform system mailer OAuth callback
 * Saves tokens to systemMailerService instead of user SMTP configs
 */
async function handlePlatformMailerCallback(
  provider: OAuthProvider,
  code: string,
  userId: string
): Promise<OAuthCallbackResult> {
  const frontendUrl = SERVER.FRONTEND_URL
  const mailerProvider = provider === 'google' ? 'gmail' : 'outlook'

  try {
    const tokens = provider === 'google'
      ? await oauthService.exchangeGoogleCode(code)
      : await oauthService.exchangeMicrosoftCode(code)

    const oauthCreds = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>(`oauth_${provider}`)
    if (!oauthCreds) {
      const isPlatform = await rbacService.isPlatformAdmin(userId)
      const settingsPath = isPlatform ? '/platform/system-settings' : '/admin/platform-settings'
      return { success: false, redirectUrl: `${frontendUrl}${settingsPath}?oauth_error=no_credentials` }
    }

    const existing = await systemMailerService.getConfig()
    const config: SystemMailerConfig = {
      fromName: existing?.fromName || 'Dispatch',
      fromEmail: tokens.email,
      providerConfig: provider === 'google'
        ? {
            provider: 'gmail',
            email: tokens.email,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_at,
            clientId: oauthCreds.clientId,
            clientSecret: oauthCreds.clientSecret,
          }
        : {
            provider: 'outlook',
            email: tokens.email,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_at,
            clientId: oauthCreds.clientId,
            clientSecret: oauthCreds.clientSecret,
          },
    }
    systemMailerService.saveConfig(config, userId)
    logger.info(`Platform mailer connected: ${mailerProvider} — ${tokens.email}`)

    // Platform admin uses /platform/system-settings, org admin uses /admin/platform-settings
    const isPlatform = await rbacService.isPlatformAdmin(userId)
    const settingsPath = isPlatform ? '/platform/system-settings' : '/admin/platform-settings'

    return {
      success: true,
      redirectUrl: `${frontendUrl}${settingsPath}?oauth_success=${mailerProvider}&email=${encodeURIComponent(tokens.email)}`,
    }
  } catch (err) {
    logger.error(`Platform mailer ${mailerProvider} OAuth error:`, err)
    const isPlatform = await rbacService.isPlatformAdmin(userId)
    const settingsPath = isPlatform ? '/platform/system-settings' : '/admin/platform-settings'
    return {
      success: false,
      redirectUrl: `${frontendUrl}${settingsPath}?oauth_error=${encodeURIComponent(err instanceof Error ? err.message : 'failed')}`,
    }
  }
}

/**
 * Get valid OAuth access token (refresh if needed)
 */
export async function getValidOAuthToken(
  config: {
    id: string
    provider_type: string
    oauth_access_token?: string
    oauth_refresh_token?: string
    oauth_expires_at?: string
  },
  userId: string
): Promise<string> {
  if (!config.oauth_access_token || !config.oauth_refresh_token) {
    throw new Error('OAuth tokens not found. Please reconnect your account.')
  }

  // Check if token needs refresh
  if (d1UserDatabase.needsTokenRefresh(config as any)) {
    logger.debug(`Refreshing OAuth token for ${config.provider_type}...`)

    try {
      const newTokens = config.provider_type === 'google'
        ? await oauthService.refreshGoogleToken(config.oauth_refresh_token)
        : await oauthService.refreshMicrosoftToken(config.oauth_refresh_token)

      await d1UserDatabase.updateOAuthTokens(
        config.id,
        userId,
        newTokens.access_token,
        new Date(newTokens.expires_at).toISOString()
      )
      
      logger.debug(`OAuth token refreshed for ${config.provider_type}`)
      return newTokens.access_token
    } catch (err) {
      logger.error('Failed to refresh OAuth token:', err)
      throw new Error('OAuth token expired. Please reconnect your account.')
    }
  }

  return config.oauth_access_token
}

/**
 * Send single email via OAuth
 */
export async function sendOAuthEmail(
  provider: OAuthProvider,
  accessToken: string,
  to: string,
  subject: string,
  htmlContent: string,
  fromName: string,
  fromEmail: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (provider === 'google') {
      const result = await oauthService.sendGmailEmail(
        accessToken, to, subject, htmlContent, fromName, fromEmail
      )
      return { success: true, messageId: result.messageId }
    } else {
      const result = await oauthService.sendOutlookEmail(
        accessToken, to, subject, htmlContent, fromName
      )
      return { success: true, messageId: result.messageId }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}
