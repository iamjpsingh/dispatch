// src/services/transports/smtp.ts - SMTP Transport (wraps Nodemailer)

import nodemailer from 'nodemailer'
import type { EmailTransport, SendOptions, SendResult, SmtpConfig } from './types'

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp'
  private transporter: nodemailer.Transporter

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    })
  }

  async send(options: SendOptions): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: `${options.from.name} <${options.from.email}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
    })

    return { messageId: info.messageId, provider: 'smtp' }
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify()
      return true
    } catch {
      return false
    }
  }
}
