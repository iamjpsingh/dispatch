/**
 * OAuth Service
 * Google & Microsoft OAuth integration
 */
import { randomBytes } from 'crypto'
import { logger } from '../utils/logger'
import { SERVER } from '../config'
import { systemSettingsService } from './systemSettingsService'

/**
 * Get OAuth credentials from system_settings ONLY.
 * No .env fallback — platform admin configures via UI.
 * Redirect URI is auto-computed from BASE_URL.
 */
function getGoogleOAuth() {
  const stored = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>('oauth_google')
  return {
    CLIENT_ID: stored?.clientId || '',
    CLIENT_SECRET: stored?.clientSecret || '',
    REDIRECT_URI: `${SERVER.BASE_URL}/api/auth/google/callback`,
    SCOPES: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    isConfigured: () => !!stored?.clientId,
  }
}

function getMicrosoftOAuth() {
  const stored = systemSettingsService.getJson<{ clientId: string; clientSecret: string }>('oauth_microsoft')
  return {
    CLIENT_ID: stored?.clientId || '',
    CLIENT_SECRET: stored?.clientSecret || '',
    REDIRECT_URI: `${SERVER.BASE_URL}/api/auth/microsoft/callback`,
    SCOPES: ['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read', 'offline_access'],
    isConfigured: () => !!stored?.clientId,
  }
}

export type EmailProvider = 'google' | 'microsoft' | 'smtp'
export type OAuthPurpose = 'user_oauth' | 'platform_mailer'

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
}

// OAuth URLs
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

class OAuthService {
  private stateStore: Map<string, { userId: string; provider: EmailProvider; purpose: OAuthPurpose; timestamp: number }> = new Map()

  constructor() {
    // Clean up expired states every 10 minutes
    setInterval(() => this.cleanExpiredStates(), 10 * 60 * 1000)
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Generate secure state parameter for OAuth flow
   */
  generateState(userId: string, provider: EmailProvider, purpose: OAuthPurpose = 'user_oauth'): string {
    const state = randomBytes(32).toString('hex')
    this.stateStore.set(state, {
      userId,
      provider,
      purpose,
      timestamp: Date.now(),
    })
    return state
  }

  /**
   * Validate and consume state
   */
  validateState(state: string): { userId: string; provider: EmailProvider; purpose: OAuthPurpose } | null {
    const data = this.stateStore.get(state)
    if (!data) return null

    // State expires after 10 minutes
    if (Date.now() - data.timestamp > 10 * 60 * 1000) {
      this.stateStore.delete(state)
      return null
    }

    this.stateStore.delete(state)
    return { userId: data.userId, provider: data.provider, purpose: data.purpose }
  }

  private cleanExpiredStates(): void {
    const now = Date.now()
    for (const [state, data] of this.stateStore.entries()) {
      if (now - data.timestamp > 10 * 60 * 1000) {
        this.stateStore.delete(state)
      }
    }
  }

  // ============================================================================
  // Authorization URLs
  // ============================================================================

  /**
   * Get Google OAuth authorization URL
   */
  getGoogleAuthUrl(userId: string): string {
    const { CLIENT_ID, REDIRECT_URI, SCOPES } = getGoogleOAuth()

    if (!CLIENT_ID) {
      throw new Error('Google OAuth not configured — set it up in Platform Settings')
    }

    const state = this.generateState(userId, 'google')
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    })

    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  /**
   * Get Microsoft OAuth authorization URL
   */
  getMicrosoftAuthUrl(userId: string): string {
    const { CLIENT_ID, REDIRECT_URI, SCOPES } = getMicrosoftOAuth()

    if (!CLIENT_ID) {
      throw new Error('Microsoft OAuth not configured — set it up in Platform Settings')
    }

    const state = this.generateState(userId, 'microsoft')
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
    })

    return `${MICROSOFT_AUTH_URL}?${params.toString()}`
  }

  /**
   * Get Google OAuth URL for platform system mailer
   * Uses the SAME redirect URI as user OAuth to avoid redirect_uri_mismatch
   */
  getPlatformGoogleAuthUrl(userId: string): string {
    const { CLIENT_ID, REDIRECT_URI } = getGoogleOAuth()
    if (!CLIENT_ID) throw new Error('Google OAuth not configured — save Client ID and Secret first')

    const state = this.generateState(userId, 'google', 'platform_mailer')
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  /**
   * Get Microsoft OAuth URL for platform system mailer
   * Uses the SAME redirect URI as user OAuth to avoid redirect_uri_mismatch
   */
  getPlatformMicrosoftAuthUrl(userId: string): string {
    const { CLIENT_ID, REDIRECT_URI } = getMicrosoftOAuth()
    if (!CLIENT_ID) throw new Error('Microsoft OAuth not configured — save Client ID and Secret first')

    const state = this.generateState(userId, 'microsoft', 'platform_mailer')
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access',
      state,
    })
    return `${MICROSOFT_AUTH_URL}?${params.toString()}`
  }

  // ============================================================================
  // Token Exchange
  // ============================================================================

  /**
   * Exchange Google authorization code for tokens
   */
  async exchangeGoogleCode(code: string): Promise<OAuthTokens & { email: string; name: string }> {
    const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = getGoogleOAuth()

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured')
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      logger.error('Google token exchange failed:', error)
      throw new Error('Failed to exchange Google authorization code')
    }

    const tokens = await tokenResponse.json()

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userResponse.ok) {
      throw new Error('Failed to get Google user info')
    }

    const userInfo = await userResponse.json()

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
      email: userInfo.email,
      name: userInfo.name || userInfo.email,
    }
  }

  /**
   * Exchange Microsoft authorization code for tokens
   */
  async exchangeMicrosoftCode(code: string): Promise<OAuthTokens & { email: string; name: string }> {
    const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, SCOPES } = getMicrosoftOAuth()

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Microsoft OAuth credentials not configured')
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        scope: SCOPES.join(' '),
      }),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      logger.error('Microsoft token exchange failed:', error)
      throw new Error('Failed to exchange Microsoft authorization code')
    }

    const tokens = await tokenResponse.json()

    // Get user info from Microsoft Graph
    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userResponse.ok) {
      throw new Error('Failed to get Microsoft user info')
    }

    const userInfo = await userResponse.json()

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
      email: userInfo.mail || userInfo.userPrincipalName,
      name: userInfo.displayName || userInfo.mail,
    }
  }

  // ============================================================================
  // Token Refresh
  // ============================================================================

  /**
   * Refresh Google access token
   */
  async refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_at: number }> {
    const { CLIENT_ID, CLIENT_SECRET } = getGoogleOAuth()

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured')
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to refresh Google token')
    }

    const tokens = await response.json()
    return {
      access_token: tokens.access_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    }
  }

  /**
   * Refresh Microsoft access token
   */
  async refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; expires_at: number }> {
    const { CLIENT_ID, CLIENT_SECRET, SCOPES } = getMicrosoftOAuth()

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Microsoft OAuth credentials not configured')
    }

    const response = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPES.join(' '),
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to refresh Microsoft token')
    }

    const tokens = await response.json()
    return {
      access_token: tokens.access_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    }
  }

  // ============================================================================
  // Email Sending
  // ============================================================================

  /**
   * Send email via Gmail API
   */
  async sendGmailEmail(
    accessToken: string,
    to: string,
    subject: string,
    htmlContent: string,
    fromName: string,
    fromEmail: string
  ): Promise<{ messageId: string }> {
    const messageParts = [
      `From: ${fromName} <${fromEmail}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlContent,
    ]

    const message = messageParts.join('\r\n')
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error('Gmail send failed:', error)
      throw new Error(`Failed to send email via Gmail: ${response.status}`)
    }

    const result = await response.json()
    return { messageId: result.id }
  }

  /**
   * Send email via Microsoft Graph API
   */
  async sendOutlookEmail(
    accessToken: string,
    to: string,
    subject: string,
    htmlContent: string,
    fromName: string
  ): Promise<{ messageId: string }> {
    const emailData = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: htmlContent,
        },
        toRecipients: [
          {
            emailAddress: { address: to },
          },
        ],
        from: {
          emailAddress: {
            name: fromName,
          },
        },
      },
      saveToSentItems: true,
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error('Outlook send failed:', error)
      throw new Error(`Failed to send email via Outlook: ${response.status}`)
    }

    return { messageId: `outlook_${Date.now()}` }
  }

  // ============================================================================
  // Connection Test
  // ============================================================================

  /**
   * Test OAuth connection
   */
  async testConnection(provider: EmailProvider, accessToken: string): Promise<boolean> {
    try {
      if (provider === 'google') {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        return response.ok
      } else if (provider === 'microsoft') {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        return response.ok
      }
      return false
    } catch {
      return false
    }
  }
}

export const oauthService = new OAuthService()
