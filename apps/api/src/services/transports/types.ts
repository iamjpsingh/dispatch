// src/services/transports/types.ts - Email Transport Interface

export interface SendOptions {
  from: { name: string; email: string }
  to: string
  subject: string
  html: string
  text?: string
  headers?: Record<string, string>
  replyTo?: string
}

export interface SendResult {
  messageId: string
  provider: string
}

export interface EmailTransport {
  readonly name: string
  send(options: SendOptions): Promise<SendResult>
  verify(): Promise<boolean>
}

export type ProviderType = 'smtp' | 'ses' | 'mailgun' | 'sendgrid' | 'google' | 'microsoft'

export interface SmtpConfig {
  type: 'smtp'
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

export interface SesConfig {
  type: 'ses'
  accessKeyId: string
  secretAccessKey: string
  region: string
}

export interface MailgunConfig {
  type: 'mailgun'
  apiKey: string
  domain: string
  region?: 'us' | 'eu'
}

export interface SendGridConfig {
  type: 'sendgrid'
  apiKey: string
}

export type TransportConfig = SmtpConfig | SesConfig | MailgunConfig | SendGridConfig
