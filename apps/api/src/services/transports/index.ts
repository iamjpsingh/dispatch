// src/services/transports/index.ts - Transport Factory

import type { EmailTransport, TransportConfig, ProviderType } from './types'
import { SmtpTransport } from './smtp'
import { SesTransport } from './ses'
import { MailgunTransport } from './mailgun'
import { SendGridTransport } from './sendgrid'

export type { EmailTransport, TransportConfig, SendOptions, SendResult, ProviderType } from './types'
export type { SmtpConfig, SesConfig, MailgunConfig, SendGridConfig } from './types'

/**
 * Create a transport from a config object.
 */
export function createTransport(config: TransportConfig): EmailTransport {
  switch (config.type) {
    case 'smtp':
      return new SmtpTransport(config)
    case 'ses':
      return new SesTransport(config)
    case 'mailgun':
      return new MailgunTransport(config)
    case 'sendgrid':
      return new SendGridTransport(config)
    default:
      throw new Error(`Unknown transport type: ${(config as any).type}`)
  }
}

/**
 * Build a TransportConfig from a stored SMTP/provider config record.
 * This bridges the existing DB schema (smtp_configs table) to the new transport system.
 */
export function configFromRecord(record: {
  provider_type?: string
  host?: string
  port?: number
  secure?: boolean | number
  username?: string
  password?: string
  // API provider fields (stored in same table or as JSON)
  api_key?: string
  api_secret?: string
  api_region?: string
  api_domain?: string
}): TransportConfig {
  const providerType = (record.provider_type || 'smtp') as ProviderType

  switch (providerType) {
    case 'ses':
      return {
        type: 'ses',
        accessKeyId: record.username || record.api_key || '',
        secretAccessKey: record.password || record.api_secret || '',
        region: record.api_region || 'us-east-1',
      }
    case 'mailgun':
      return {
        type: 'mailgun',
        apiKey: record.api_key || record.password || '',
        domain: record.api_domain || record.host || '',
        region: record.api_region === 'eu' ? 'eu' : 'us',
      }
    case 'sendgrid':
      return {
        type: 'sendgrid',
        apiKey: record.api_key || record.password || '',
      }
    default:
      return {
        type: 'smtp',
        host: record.host || '',
        port: record.port || 587,
        secure: !!record.secure,
        username: record.username || '',
        password: record.password || '',
      }
  }
}
