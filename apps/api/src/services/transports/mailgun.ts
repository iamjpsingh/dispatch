// src/services/transports/mailgun.ts - Mailgun Transport (REST API)

import type { EmailTransport, SendOptions, SendResult, MailgunConfig } from './types'

export class MailgunTransport implements EmailTransport {
  readonly name = 'mailgun'
  private config: MailgunConfig
  private baseUrl: string

  constructor(config: MailgunConfig) {
    this.config = config
    this.baseUrl = config.region === 'eu'
      ? `https://api.eu.mailgun.net/v3/${config.domain}`
      : `https://api.mailgun.net/v3/${config.domain}`
  }

  async send(options: SendOptions): Promise<SendResult> {
    const form = new FormData()
    form.append('from', `${options.from.name} <${options.from.email}>`)
    form.append('to', options.to)
    form.append('subject', options.subject)
    form.append('html', options.html)

    if (options.text) form.append('text', options.text)
    if (options.replyTo) form.append('h:Reply-To', options.replyTo)

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        form.append(`h:${key}`, value)
      }
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${this.config.apiKey}`)}`,
      },
      body: form,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Mailgun error ${response.status}: ${errorBody}`)
    }

    const result = await response.json() as { id: string; message: string }
    return { messageId: result.id || '', provider: 'mailgun' }
  }

  async verify(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/domains/${this.config.domain}`, {
        headers: {
          Authorization: `Basic ${btoa(`api:${this.config.apiKey}`)}`,
        },
      })
      return response.ok
    } catch {
      return false
    }
  }
}
