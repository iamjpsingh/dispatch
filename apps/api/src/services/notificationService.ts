// src/services/notificationService.ts - Job completion notification service
import nodemailer from 'nodemailer'
import { d1UserDatabase, type D1SMTPConfig } from './d1UserDatabase'
import type { EmailLog, NotificationConfig } from '../types/index'

import { logger } from '../utils/logger'
import { createNotificationSubject, createNotificationHTML } from '../templates/notificationTemplates'

export interface JobStats {
  sent: number
  failed: number
  total: number
  errors: number
  successRate: number
}

export interface JobDetails {
  id: string
  subject: string
  startTime: string
  endTime: string
  duration: string
  configUsed: string
  batchMode: boolean
  userId: string
}

export interface NotificationTemplateData {
  stats: JobStats
  details: JobDetails
  user: {
    name: string
    email: string
  }
}

class NotificationService {
  private transporter: nodemailer.Transporter | null = null
  private globalConfig: NotificationConfig | null = null

  /**
   * Setup global notification sender (optional - for admin notifications)
   */
  setupGlobalNotificationSender(config: NotificationConfig): void {
    this.globalConfig = config
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    })

    logger.info('Global notification service configured')
  }

  /**
   * Send job completion notification using user's SMTP config
   */
  async sendJobCompletionNotification(
    userId: string,
    notifyEmail: string,
    jobStats: Omit<JobStats, 'successRate'>,
    jobDetails: Omit<JobDetails, 'duration' | 'userId'>,
    configUsed: string
  ): Promise<boolean> {
    try {
      // Calculate additional stats
      const successRate = jobStats.total > 0 ? (jobStats.sent / jobStats.total) * 100 : 0

      const duration = this.calculateDuration(jobDetails.startTime, jobDetails.endTime)

      const completeJobStats: JobStats = {
        ...jobStats,
        successRate: parseFloat(successRate.toFixed(1)),
      }

      const completeJobDetails: JobDetails = {
        ...jobDetails,
        duration,
        userId,
        configUsed,
      }

      // Try to use user's SMTP config first
      const userConfig = await d1UserDatabase.getUserDefaultSMTPConfig(userId)
      if (userConfig) {
        return await this.sendWithUserConfig(userConfig, notifyEmail, completeJobStats, completeJobDetails, {
          name: 'User',
          email: notifyEmail,
        })
      }

      // Fallback to global config if available
      if (this.globalConfig && this.transporter) {
        return await this.sendWithGlobalConfig(notifyEmail, completeJobStats, completeJobDetails, {
          name: 'User',
          email: notifyEmail,
        })
      }

      logger.error('No notification sender configured')
      return false
    } catch (error) {
      logger.error('Failed to send job completion notification:', error)
      return false
    }
  }

  /**
   * Send notification using user's SMTP configuration
   */
  private async sendWithUserConfig(
    userConfig: D1SMTPConfig,
    notifyEmail: string,
    jobStats: JobStats,
    jobDetails: JobDetails,
    user: any
  ): Promise<boolean> {
    try {
      // Create transporter with user's config
      const userTransporter = nodemailer.createTransport({
        host: userConfig.host,
        port: userConfig.port,
        secure: !!userConfig.secure,
        auth: {
          user: userConfig.username,
          pass: userConfig.password,
        },
      })

      const mailOptions = {
        from: `${userConfig.from_name || 'Email Campaign'} <${userConfig.from_email}>`,
        to: notifyEmail,
        subject: createNotificationSubject(jobStats),
        html: createNotificationHTML({
          stats: jobStats,
          details: jobDetails,
          user,
        }),
      }

      await userTransporter.sendMail(mailOptions)
      logger.debug(`User config notification sent to ${notifyEmail} using ${userConfig.name}`)
      return true
    } catch (error) {
      logger.error('Failed to send with user config:', error)
      return false
    }
  }

  /**
   * Send notification using global configuration
   */
  private async sendWithGlobalConfig(
    notifyEmail: string,
    jobStats: JobStats,
    jobDetails: JobDetails,
    user: any
  ): Promise<boolean> {
    try {
      if (!this.transporter || !this.globalConfig) {
        return false
      }

      const mailOptions = {
        from: `${this.globalConfig.fromName} <${this.globalConfig.user}>`,
        to: notifyEmail,
        subject: createNotificationSubject(jobStats),
        html: createNotificationHTML({
          stats: jobStats,
          details: jobDetails,
          user,
        }),
      }

      await this.transporter.sendMail(mailOptions)
      logger.debug(`Global config notification sent to ${notifyEmail}`)
      return true
    } catch (error) {
      logger.error('Failed to send with global config:', error)
      return false
    }
  }

  /**
   * Calculate duration between start and end time
   */
  private calculateDuration(startTime: string, endTime: string): string {
    const start = new Date(startTime)
    const end = new Date(endTime)
    const diffMs = end.getTime() - start.getTime()

    const hours = Math.floor(diffMs / 3600000)
    const minutes = Math.floor((diffMs % 3600000) / 60000)
    const seconds = Math.floor((diffMs % 60000) / 1000)

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  /**
   * Send test notification (for testing purposes)
   */
  async sendTestNotification(userId: string, testEmail: string): Promise<boolean> {
    const mockStats: JobStats = {
      sent: 85,
      failed: 15,
      total: 100,
      errors: 0,
      successRate: 85,
    }

    const mockDetails: JobDetails = {
      id: 'test_campaign_123',
      subject: 'Test Campaign - Welcome Email',
      startTime: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
      endTime: new Date().toISOString(),
      duration: '10m 30s',
      configUsed: 'Test SMTP Configuration',
      batchMode: true,
      userId,
    }

    return await this.sendJobCompletionNotification(
      userId,
      testEmail,
      {
        sent: mockStats.sent,
        failed: mockStats.failed,
        total: mockStats.total,
        errors: mockStats.errors,
      },
      {
        id: mockDetails.id,
        subject: mockDetails.subject,
        startTime: mockDetails.startTime,
        endTime: mockDetails.endTime,
        configUsed: mockDetails.configUsed,
        batchMode: mockDetails.batchMode,
      },
      mockDetails.configUsed
    )
  }
}

export const notificationService = new NotificationService()

// Initialize global notification service if configured
if (process.env.NOTIFICATION_SMTP_USER) {
  const globalConfig: NotificationConfig = {
    host: process.env.NOTIFICATION_SMTP_HOST || process.env.SMTP_HOST || '',
    port: parseInt(process.env.NOTIFICATION_SMTP_PORT || process.env.SMTP_PORT || '587'),
    secure: (process.env.NOTIFICATION_SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
    user: process.env.NOTIFICATION_SMTP_USER || '',
    pass: process.env.NOTIFICATION_SMTP_PASS || '',
    fromName: process.env.NOTIFICATION_FROM_NAME || 'Email Campaign Notifications',
  }

  notificationService.setupGlobalNotificationSender(globalConfig)
}
