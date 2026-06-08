import nodemailer from 'nodemailer'
import { logger } from '../utils/logger'
import type { EmailConfig } from '../types/index'

export class EmailService {
  async testConnection(config: EmailConfig): Promise<boolean> {
    try {
      const testTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
      })

      await testTransporter.verify()
      return true
    } catch (error) {
      logger.error('SMTP connection test failed:', error)
      return false
    }
  }
}

export const emailService = new EmailService()
