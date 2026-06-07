import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { createHmac } from 'crypto'
import { systemSettingsService } from './systemSettingsService'
import { SERVER } from '../config'
import { logger } from '../utils/logger'

// ============================================================================
// Provider configs
// ============================================================================

export interface SmtpProviderConfig {
  provider: 'smtp'
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

export interface SesProviderConfig {
  provider: 'ses'
  accessKeyId: string
  secretAccessKey: string
  region: string
}

export interface SendGridProviderConfig {
  provider: 'sendgrid'
  apiKey: string
}

export interface MailgunProviderConfig {
  provider: 'mailgun'
  apiKey: string
  domain: string
  region: 'us' | 'eu'
}

export interface PostmarkProviderConfig {
  provider: 'postmark'
  serverToken: string
}

export interface SparkPostProviderConfig {
  provider: 'sparkpost'
  apiKey: string
}

export interface GmailOAuthProviderConfig {
  provider: 'gmail'
  email: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
  clientSecret: string
}

export interface OutlookOAuthProviderConfig {
  provider: 'outlook'
  email: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
  clientSecret: string
}

export type ProviderConfig =
  | SmtpProviderConfig
  | SesProviderConfig
  | SendGridProviderConfig
  | MailgunProviderConfig
  | PostmarkProviderConfig
  | SparkPostProviderConfig
  | GmailOAuthProviderConfig
  | OutlookOAuthProviderConfig

export interface SystemMailerConfig {
  fromName: string
  fromEmail: string
  providerConfig: ProviderConfig
}

const SETTINGS_KEY = 'system_mailer'

// ============================================================================
// SES SMTP credential derivation (converts IAM keys → SES SMTP password)
// ============================================================================

function deriveSesSMTPPassword(secretAccessKey: string, region: string): string {
  const DATE = '11111111'
  const SERVICE = 'ses'
  const TERMINAL = 'aws4_request'
  const MESSAGE = 'SendRawEmail'
  const VERSION = 0x04

  let signature = createHmac('sha256', `AWS4${secretAccessKey}`).update(DATE).digest()
  signature = createHmac('sha256', signature).update(region).digest()
  signature = createHmac('sha256', signature).update(SERVICE).digest()
  signature = createHmac('sha256', signature).update(TERMINAL).digest()
  signature = createHmac('sha256', signature).update(Buffer.from([VERSION])).digest()
  signature = createHmac('sha256', signature).update(MESSAGE).digest()

  return Buffer.concat([Buffer.from([VERSION]), signature]).toString('base64')
}

// ============================================================================
// API-based email sending (no SMTP)
// ============================================================================

async function sendViaSendGrid(apiKey: string, from: { name: string; email: string }, to: string, subject: string, html: string, text?: string): Promise<string> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from.email, name: from.name },
      subject,
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        { type: 'text/html', value: html },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SendGrid error (${res.status}): ${body}`)
  }
  return res.headers.get('x-message-id') || `sg_${Date.now()}`
}

async function sendViaMailgun(apiKey: string, domain: string, region: 'us' | 'eu', from: { name: string; email: string }, to: string, subject: string, html: string, text?: string): Promise<string> {
  const baseUrl = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  const formData = new FormData()
  formData.append('from', `${from.name} <${from.email}>`)
  formData.append('to', to)
  formData.append('subject', subject)
  formData.append('html', html)
  if (text) formData.append('text', text)

  const res = await fetch(`${baseUrl}/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
    body: formData,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Mailgun error (${res.status}): ${body}`)
  }
  const data = await res.json() as any
  return data.id || `mg_${Date.now()}`
}

async function sendViaPostmark(serverToken: string, from: { name: string; email: string }, to: string, subject: string, html: string, text?: string): Promise<string> {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': serverToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: `${from.name} <${from.email}>`,
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: text || '',
      MessageStream: 'outbound',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Postmark error (${res.status}): ${body}`)
  }
  const data = await res.json() as any
  return data.MessageID || `pm_${Date.now()}`
}

async function sendViaSparkPost(apiKey: string, from: { name: string; email: string }, to: string, subject: string, html: string, text?: string): Promise<string> {
  const res = await fetch('https://api.sparkpost.com/api/v1/transmissions', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipients: [{ address: { email: to } }],
      content: {
        from: { name: from.name, email: from.email },
        subject,
        html,
        text: text || undefined,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SparkPost error (${res.status}): ${body}`)
  }
  const data = await res.json() as any
  return data.results?.id || `sp_${Date.now()}`
}

async function sendViaGmailApi(accessToken: string, from: { name: string; email: string }, to: string, subject: string, html: string): Promise<string> {
  const raw = [
    `From: ${from.name} <${from.email}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
  ].join('\r\n')

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${body}`)
  }
  const data = await res.json() as any
  return data.id || `gm_${Date.now()}`
}

async function sendViaOutlookApi(accessToken: string, from: { name: string; email: string }, to: string, subject: string, html: string): Promise<string> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { name: from.name, address: from.email } },
      },
      saveToSentItems: false,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Outlook API error (${res.status}): ${body}`)
  }
  return `ol_${Date.now()}`
}

// ============================================================================
// OAuth token refresh helpers
// ============================================================================

async function refreshGmailToken(cfg: GmailOAuthProviderConfig): Promise<string> {
  if (Date.now() < cfg.expiresAt - 60000) return cfg.accessToken

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Failed to refresh Gmail token')
  const data = await res.json() as any

  // Update stored config with new access token
  const fullConfig = await systemSettingsService.getSecretJson<SystemMailerConfig>(SETTINGS_KEY)
  if (fullConfig && fullConfig.providerConfig.provider === 'gmail') {
    const gmailCfg = fullConfig.providerConfig as GmailOAuthProviderConfig
    gmailCfg.accessToken = data.access_token
    gmailCfg.expiresAt = Date.now() + data.expires_in * 1000
    await systemSettingsService.setSecretJson(SETTINGS_KEY, fullConfig)
  }

  return data.access_token
}

async function refreshOutlookToken(cfg: OutlookOAuthProviderConfig): Promise<string> {
  if (Date.now() < cfg.expiresAt - 60000) return cfg.accessToken

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Mail.Send offline_access',
    }),
  })
  if (!res.ok) throw new Error('Failed to refresh Outlook token')
  const data = await res.json() as any

  const fullConfig = await systemSettingsService.getSecretJson<SystemMailerConfig>(SETTINGS_KEY)
  if (fullConfig && fullConfig.providerConfig.provider === 'outlook') {
    const olCfg = fullConfig.providerConfig as OutlookOAuthProviderConfig
    olCfg.accessToken = data.access_token
    olCfg.expiresAt = Date.now() + data.expires_in * 1000
    await systemSettingsService.setSecretJson(SETTINGS_KEY, fullConfig)
  }

  return data.access_token
}

// ============================================================================
// System Mailer Service
// ============================================================================

class SystemMailerService {
  async getConfig(): Promise<SystemMailerConfig | null> {
    return await systemSettingsService.getSecretJson<SystemMailerConfig>(SETTINGS_KEY)
  }

  async saveConfig(config: SystemMailerConfig, updatedBy: string): Promise<void> {
    await systemSettingsService.setSecretJson(SETTINGS_KEY, config, updatedBy)
  }

  async removeConfig(updatedBy: string): Promise<void> {
    await systemSettingsService.delete(SETTINGS_KEY)
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getConfig()) !== null
  }

  async getMaskedConfig(): Promise<(SystemMailerConfig & { _masked: true }) | null> {
    const cfg = await this.getConfig()
    if (!cfg) return null
    const masked = JSON.parse(JSON.stringify(cfg)) as any
    const pc = masked.providerConfig
    if (pc.password) pc.password = '********'
    if (pc.secretAccessKey) pc.secretAccessKey = '********'
    if (pc.apiKey) pc.apiKey = '********'
    if (pc.serverToken) pc.serverToken = '********'
    if (pc.clientSecret) pc.clientSecret = '********'
    if (pc.refreshToken) pc.refreshToken = '********'
    if (pc.accessToken) pc.accessToken = '********'
    masked._masked = true
    return masked
  }

  async verify(): Promise<{ success: boolean; error?: string }> {
    try {
      const cfg = await this.getConfig()
      if (!cfg) return { success: false, error: 'Not configured' }

      const pc = cfg.providerConfig
      switch (pc.provider) {
        case 'smtp': {
          const t = nodemailer.createTransport({ host: pc.host, port: pc.port, secure: pc.secure, auth: { user: pc.username, pass: pc.password } })
          await t.verify()
          return { success: true }
        }
        case 'ses': {
          const smtpPass = deriveSesSMTPPassword(pc.secretAccessKey, pc.region)
          const t = nodemailer.createTransport({ host: `email-smtp.${pc.region}.amazonaws.com`, port: 465, secure: true, auth: { user: pc.accessKeyId, pass: smtpPass } })
          await t.verify()
          return { success: true }
        }
        case 'sendgrid': {
          const res = await fetch('https://api.sendgrid.com/v3/user/credits', { headers: { Authorization: `Bearer ${pc.apiKey}` } })
          return res.ok ? { success: true } : { success: false, error: `SendGrid API returned ${res.status}` }
        }
        case 'mailgun': {
          const baseUrl = pc.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
          const res = await fetch(`${baseUrl}/v3/${pc.domain}`, { headers: { Authorization: `Basic ${Buffer.from(`api:${pc.apiKey}`).toString('base64')}` } })
          return res.ok ? { success: true } : { success: false, error: `Mailgun API returned ${res.status}` }
        }
        case 'postmark': {
          const res = await fetch('https://api.postmarkapp.com/server', { headers: { 'X-Postmark-Server-Token': pc.serverToken, Accept: 'application/json' } })
          return res.ok ? { success: true } : { success: false, error: `Postmark API returned ${res.status}` }
        }
        case 'sparkpost': {
          const res = await fetch('https://api.sparkpost.com/api/v1/account', { headers: { Authorization: pc.apiKey } })
          return res.ok ? { success: true } : { success: false, error: `SparkPost API returned ${res.status}` }
        }
        case 'gmail': {
          const token = await refreshGmailToken(pc)
          const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } })
          return res.ok ? { success: true } : { success: false, error: 'Gmail OAuth token invalid' }
        }
        case 'outlook': {
          const token = await refreshOutlookToken(pc)
          const res = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } })
          return res.ok ? { success: true } : { success: false, error: 'Outlook OAuth token invalid' }
        }
        default:
          return { success: false, error: 'Unknown provider' }
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async send(options: { to: string; subject: string; html: string; text?: string }): Promise<{ messageId: string }> {
    const cfg = await this.getConfig()
    if (!cfg) throw new Error('System mailer is not configured')

    const from = { name: cfg.fromName, email: cfg.fromEmail }
    const pc = cfg.providerConfig
    let messageId: string

    switch (pc.provider) {
      case 'smtp': {
        const t = nodemailer.createTransport({ host: pc.host, port: pc.port, secure: pc.secure, auth: { user: pc.username, pass: pc.password } })
        const info = await t.sendMail({ from: `${from.name} <${from.email}>`, to: options.to, subject: options.subject, html: options.html, text: options.text })
        messageId = info.messageId
        break
      }
      case 'ses': {
        const smtpPass = deriveSesSMTPPassword(pc.secretAccessKey, pc.region)
        const t = nodemailer.createTransport({ host: `email-smtp.${pc.region}.amazonaws.com`, port: 465, secure: true, auth: { user: pc.accessKeyId, pass: smtpPass } })
        const info = await t.sendMail({ from: `${from.name} <${from.email}>`, to: options.to, subject: options.subject, html: options.html, text: options.text })
        messageId = info.messageId
        break
      }
      case 'sendgrid':
        messageId = await sendViaSendGrid(pc.apiKey, from, options.to, options.subject, options.html, options.text)
        break
      case 'mailgun':
        messageId = await sendViaMailgun(pc.apiKey, pc.domain, pc.region, from, options.to, options.subject, options.html, options.text)
        break
      case 'postmark':
        messageId = await sendViaPostmark(pc.serverToken, from, options.to, options.subject, options.html, options.text)
        break
      case 'sparkpost':
        messageId = await sendViaSparkPost(pc.apiKey, from, options.to, options.subject, options.html, options.text)
        break
      case 'gmail': {
        const token = await refreshGmailToken(pc)
        messageId = await sendViaGmailApi(token, from, options.to, options.subject, options.html)
        break
      }
      case 'outlook': {
        const token = await refreshOutlookToken(pc)
        messageId = await sendViaOutlookApi(token, from, options.to, options.subject, options.html)
        break
      }
      default:
        throw new Error(`Unknown provider: ${(pc as any).provider}`)
    }

    logger.info(`System email sent via ${pc.provider} to ${options.to}: ${options.subject}`)
    return { messageId }
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${SERVER.FRONTEND_URL}/reset-password/${token}`
    await this.send({
      to: email,
      subject: 'Reset Your Password — Dispatch',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Reset Your Password</h2>
          <p style="color: #555; line-height: 1.6;">We received a request to reset your password. Click the button below to set a new password.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background-color: #6366f1; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">Reset Password</a>
          </div>
          <p style="color: #888; font-size: 13px; line-height: 1.5;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #aaa; font-size: 12px;">Sent by Dispatch</p>
        </div>`,
      text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
    })
  }

  async sendInvitation(email: string, orgName: string, inviterName: string, role: string, token: string): Promise<void> {
    const acceptUrl = `${SERVER.FRONTEND_URL}/invite/${token}`
    await this.send({
      to: email,
      subject: `You've been invited to ${orgName} — Dispatch`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">You're Invited!</h2>
          <p style="color: #555; line-height: 1.6;"><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong>.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${acceptUrl}" style="display: inline-block; background-color: #6366f1; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">Accept Invitation</a>
          </div>
          <p style="color: #888; font-size: 13px; line-height: 1.5;">This invitation expires in 7 days.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #aaa; font-size: 12px;">Sent by Dispatch</p>
        </div>`,
      text: `${inviterName} invited you to join ${orgName} as ${role}.\n\nAccept: ${acceptUrl}\n\nExpires in 7 days.`,
    })
  }
}

export const systemMailerService = new SystemMailerService()
