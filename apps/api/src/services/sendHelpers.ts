/**
 * Send Helpers
 * Utility functions extracted from send routes for validation, processing, and OAuth bulk sending
 */
import { emailService } from './emailService'
import { ProviderDetection } from './providerLimits'
import { FileService } from './fileService'
import { d1UserDatabase, type D1SMTPConfig } from './d1UserDatabase'
import { oauthService } from './oauthService'
import { d1Service } from './d1Service'
import { getProviderLimits } from '../config'
import { getValidOAuthToken, sendOAuthEmail, type OAuthProvider } from '../utils/oauth'
import { parseIntSafe } from '../utils/validation'
import { logger } from '../utils/logger'
import type { EmailConfig } from '../types/index'

// Type alias for compatibility
export type UserSMTPConfig = D1SMTPConfig & { user?: string; pass?: string; host: string }

/**
 * Get user SMTP config by configId or default
 */
export async function getUserConfig(userId: string, configId: string | null): Promise<UserSMTPConfig | null> {
  let userConfig: UserSMTPConfig | null = null

  if (configId) {
    const configs = await d1UserDatabase.getUserSMTPConfigs(userId)
    const found = configs.find((config) => config.id === configId)
    if (found) {
      userConfig = { ...found, user: found.username, pass: found.password }
    }
  }

  if (!userConfig) {
    const defaultConfig = await d1UserDatabase.getUserDefaultSMTPConfig(userId)
    if (defaultConfig) {
      userConfig = { ...defaultConfig, user: defaultConfig.username, pass: defaultConfig.password }
    }
  }

  return userConfig
}

/**
 * Validate required fields for send request
 */
export function validateSendRequest(
  config: UserSMTPConfig,
  isOAuth: boolean,
  subject: string,
  scheduleEmail: boolean,
  scheduledTime: string
): string | null {
  const missing: string[] = []

  if (!isOAuth) {
    if (!config.host) missing.push('SMTP Host')
    if (!config.user) missing.push('SMTP User')
    if (!config.pass) missing.push('SMTP Password')
    if (!config.from_email) missing.push('From Email')
  } else {
    if (!config.oauth_email) missing.push('OAuth Email')
    if (!config.oauth_access_token) missing.push('OAuth Access Token')
  }

  if (!subject || subject.trim() === '') missing.push('Subject')
  if (scheduleEmail && !scheduledTime) missing.push('Scheduled Time')

  return missing.length > 0 ? `Missing required fields: ${missing.join(', ')}` : null
}

/**
 * Test SMTP or OAuth connection
 */
export async function testConnection(config: UserSMTPConfig, isOAuth: boolean, userId: string): Promise<string | null> {
  if (isOAuth) {
    logger.debug(`Testing OAuth connection for ${config.provider_type}...`)
    try {
      const accessToken = await getValidOAuthToken(config, userId)
      const isValid = await oauthService.testConnection(config.provider_type as OAuthProvider, accessToken)
      if (!isValid) {
        return `${config.provider_type === 'google' ? 'Google' : 'Microsoft'} OAuth connection failed. Please reconnect your account.`
      }
      logger.debug(`OAuth connection verified for ${config.provider_type}`)
      return null
    } catch (err) {
      return `OAuth error: ${err instanceof Error ? err.message : 'Unknown error'}. Please reconnect your account.`
    }
  }

  // SMTP connection test
  logger.debug(`Testing SMTP connection to ${config.host}:${config.port}...`)
  const emailConfig = buildEmailConfig(config)

  try {
    const valid = await emailService.testConnection(emailConfig)
    if (!valid) {
      return buildSmtpErrorMessage(config.host)
    }
    return null
  } catch (err) {
    return buildSmtpErrorDetails(err, config.host, config.port)
  }
}

/**
 * Build nodemailer EmailConfig from user config
 */
export function buildEmailConfig(config: UserSMTPConfig): EmailConfig {
  return {
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    auth: {
      user: config.user || config.username || '',
      pass: config.pass || config.password || '',
    },
  }
}

/**
 * Build friendly SMTP error message based on host
 */
export function buildSmtpErrorMessage(host: string): string {
  if (host.includes('gmail')) {
    return `Gmail SMTP connection failed. Please ensure:
• You're using an App Password (not your regular Gmail password)
• 2-Factor Authentication is enabled on your Google account
• Host: smtp.gmail.com, Port: 465 (SSL) or 587 (TLS)
• Generate App Password: https://myaccount.google.com/apppasswords`
  }
  if (host.includes('outlook') || host.includes('hotmail')) {
    return `Outlook SMTP connection failed. Please ensure:
• Host: smtp-mail.outlook.com, Port: 587
• Use your regular Outlook password
• Enable "Less secure app access" if needed`
  }
  return 'SMTP connection failed. Please check your settings.'
}

/**
 * Build detailed SMTP error message from error object
 */
export function buildSmtpErrorDetails(err: unknown, host: string, port: number): string {
  if (!(err instanceof Error)) return 'SMTP connection test failed.'

  if (err.message.includes('Invalid login') || err.message.includes('Username and Password not accepted')) {
    if (host.includes('gmail')) {
      return `❌ Gmail Authentication Failed:
🔧 Quick Fix:
1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character App Password (not your regular password)
4. SMTP Settings: smtp.gmail.com:465 with SSL enabled`
    }
    return `❌ Authentication Failed: Invalid username or password for ${host}`
  }

  if (err.message.includes('ECONNREFUSED') || err.message.includes('ESOCKET')) {
    return `❌ Connection Failed: Cannot connect to ${host}:${port}
🔧 Check these settings:
• Gmail: smtp.gmail.com:465 (SSL) or smtp.gmail.com:587 (TLS)
• Outlook: smtp-mail.outlook.com:587 (TLS)
• Yahoo: smtp.mail.yahoo.com:587 (TLS)`
  }

  return `❌ SMTP Error: ${err.message}`
}

/**
 * Process uploaded Excel file and apply range selection
 */
export async function processExcelFile(
  file: File,
  formData: FormData
): Promise<{ contacts: any[] } | { error: string }> {
  try {
    logger.debug('Processing Excel file...')
    const arrayBuffer = await file.arrayBuffer()
    const filename = `${Date.now()}_${file.name}`
    const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)
    const allContacts = await FileService.parseExcelFile(filePath)
    logger.debug(`Parsed ${allContacts.length} contacts from Excel file`)

    // Apply email range selection
    const emailRangeStart = parseIntSafe(formData.get('emailRangeStart') as string, 0)
    const emailRangeCount = parseIntSafe(formData.get('emailRangeCount') as string, allContacts.length)

    const endIndex = Math.min(emailRangeStart + emailRangeCount, allContacts.length)
    const contacts = allContacts.slice(emailRangeStart, endIndex)

    logger.debug(`Email range: ${emailRangeStart + 1} to ${endIndex} (${contacts.length} selected)`)
    return { contacts }
  } catch (err) {
    logger.error('Excel parsing error:', err)
    return { error: `Failed to parse Excel file: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}

/**
 * Check provider-specific sending limits
 */
export function checkProviderLimits(
  config: UserSMTPConfig,
  isOAuth: boolean,
  contactCount: number,
  hasNotification: boolean
): string | null {
  let maxContacts: number
  let providerName: string

  if (isOAuth) {
    const limits = getProviderLimits(config.provider_type as 'google' | 'microsoft')
    maxContacts = limits.daily
    providerName = config.provider_type === 'google' ? 'Gmail API' : 'Microsoft Graph'
  } else {
    maxContacts = ProviderDetection.calculateMaxContacts(config.host, hasNotification)
    providerName = ProviderDetection.detectProvider(config.host).name
  }

  if (contactCount > maxContacts) {
    return `${providerName} limit: Maximum ${maxContacts} contacts allowed${hasNotification ? ' (1 reserved for notification)' : ''}`
  }

  return null
}

/**
 * Process HTML template file or use editor content
 */
export async function processHtmlTemplate(
  templateFile: File | null,
  htmlContent: string
): Promise<{ content: string } | { error: string }> {
  if (templateFile && templateFile.size > 0) {
    try {
      logger.debug('Processing HTML template file...')
      const arrayBuffer = await templateFile.arrayBuffer()
      const filename = `${Date.now()}_${templateFile.name}`
      const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)
      const content = await FileService.readHTMLTemplate(filePath)
      logger.debug('Using HTML template as primary content')
      return { content }
    } catch (err) {
      return { error: `Failed to process HTML template: ${err instanceof Error ? err.message : 'Unknown error'}` }
    }
  }
  return { content: htmlContent }
}

/**
 * Send bulk emails via OAuth (Google/Microsoft) in background
 */
export async function sendBulkOAuthEmails(
  config: UserSMTPConfig,
  userId: string,
  contacts: any[],
  subject: string,
  htmlContent: string,
  delayMs: number = 1000
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const accessToken = await getValidOAuthToken(config, userId)

  let sent = 0
  let failed = 0
  const errors: string[] = []

  const campaignId = d1Service.generateCampaignId()
  const fromEmail = config.oauth_email || config.from_email || ''
  const fromName = config.from_name || config.name || ''
  const provider = config.provider_type as OAuthProvider

  logger.debug(`Starting OAuth bulk send: ${contacts.length} emails via ${provider}`)

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]

    // Find email field
    const emailField = Object.keys(contact).find(
      (key) => key.toLowerCase().includes('email') || (typeof contact[key] === 'string' && contact[key].includes('@'))
    )
    const toEmail = emailField ? contact[emailField] : null

    if (!toEmail || !toEmail.includes('@')) {
      logger.debug(`Skipping contact ${i + 1}: No valid email found`)
      failed++
      errors.push(`Contact ${i + 1}: No valid email`)
      continue
    }

    // Find name field
    const nameField = Object.keys(contact).find(
      (key) => key.toLowerCase().includes('name') && !key.toLowerCase().includes('email')
    )
    const recipientName = nameField ? contact[nameField] : ''

    // Replace placeholders with exact key match
    const replacePlaceholders = (text: string) => {
      return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (contact[key] !== undefined) {
          return String(contact[key] || '')
        }
        return match
      })
    }

    const personalizedSubject = replacePlaceholders(subject)
    let personalizedContent = replacePlaceholders(htmlContent)

    // Register tracking
    if (d1Service.isConfigured()) {
      const trackingResult = await d1Service.registerEmail({
        userId,
        campaignId,
        campaignName: `OAuth Campaign ${new Date().toLocaleDateString()}`,
        subject: personalizedSubject,
        fromEmail,
        fromName,
        recipientEmail: toEmail,
        recipientName,
        sendType: 'direct',
        providerType: provider,
        configName: config.name,
      })

      if (trackingResult) {
        personalizedContent = d1Service.injectTracking(personalizedContent, trackingResult.trackingId)
      }
    }

    // Send email
    const result = await sendOAuthEmail(
      provider,
      accessToken,
      toEmail,
      personalizedSubject,
      personalizedContent,
      fromName,
      fromEmail
    )

    if (result.success) {
      sent++
      logger.debug(`[${i + 1}/${contacts.length}] Sent to ${toEmail}`)
    } else {
      failed++
      errors.push(`${toEmail}: ${result.error}`)
      logger.debug(`[${i + 1}/${contacts.length}] Failed: ${toEmail} - ${result.error}`)
    }

    // Delay between emails
    if (i < contacts.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  logger.info(`OAuth bulk send complete: ${sent} sent, ${failed} failed`)
  return { sent, failed, errors }
}
