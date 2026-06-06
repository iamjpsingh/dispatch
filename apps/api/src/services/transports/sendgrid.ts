// src/services/transports/sendgrid.ts - SendGrid Transport (REST API v3)

import type { EmailTransport, SendOptions, SendResult, SendGridConfig } from './types'

export class SendGridTransport implements EmailTransport {
  readonly name = 'sendgrid'
  private apiKey: string

  constructor(config: SendGridConfig) {
    this.apiKey = config.apiKey
  }

  async send(options: SendOptions): Promise<SendResult> {
    const payload: Record<string, any> = {
      personalizations: [{
        to: [{ email: options.to }],
        subject: options.subject,
      }],
      from: { email: options.from.email, name: options.from.name },
      content: [{ type: 'text/html', value: options.html }],
    }

    if (options.text) {
      payload.content.unshift({ type: 'text/plain', value: options.text })
    }

    if (options.replyTo) {
      payload.reply_to = { email: options.replyTo }
    }

    if (options.headers && Object.keys(options.headers).length > 0) {
      payload.headers = options.headers
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`SendGrid error ${response.status}: ${errorBody}`)
    }

    // SendGrid returns message ID in x-message-id header
    const messageId = response.headers.get('x-message-id') || `sg_${crypto.randomUUID()}`
    return { messageId, provider: 'sendgrid' }
  }

  async verify(): Promise<boolean> {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/user/credits', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      return response.ok
    } catch {
      return false
    }
  }
}
