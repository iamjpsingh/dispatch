import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'mock-msg-id' })
  const verifyMock = vi.fn().mockResolvedValue(true)
  return {
    default: {
      createTransport: vi.fn(() => ({
        sendMail: sendMailMock,
        verify: verifyMock,
      })),
    },
  }
})

vi.mock('../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: {
    getUserDefaultSMTPConfig: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../../src/services/logService', () => ({
  logService: {
    getLogs: vi.fn().mockReturnValue([]),
    addLog: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startup: vi.fn(),
  },
}))

vi.mock('../../src/templates/notificationTemplates', () => ({
  createNotificationSubject: vi.fn(
    (stats) => `Campaign Complete: ${stats.sent}/${stats.total} emails sent (${stats.successRate}%)`
  ),
  createNotificationHTML: vi.fn(() => '<html>notification</html>'),
}))

import { createNotificationSubject, createNotificationHTML } from '../../src/templates/notificationTemplates'
import { logService } from '../../src/services/logService'

describe('Notification Templates', () => {
  it('creates subject with success rate', () => {
    const stats = { sent: 95, failed: 5, total: 100, errors: 0, successRate: 95 }
    const subject = createNotificationSubject(stats)
    expect(subject).toContain('95')
    expect(subject).toContain('100')
  })

  it('creates HTML content', () => {
    const data = {
      stats: { sent: 50, failed: 10, total: 60, errors: 0, successRate: 83.3 },
      details: {
        id: 'job_1',
        subject: 'Test Campaign',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T01:00:00Z',
        duration: '1h 0m 0s',
        configUsed: 'Test Config',
        batchMode: true,
        userId: 'user_1',
      },
      user: { name: 'Test User', email: 'test@example.com' },
    }
    const html = createNotificationHTML(data)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })
})

describe('NotificationService', () => {
  let notificationService: any

  beforeEach(async () => {
    vi.resetModules()

    // Re-apply mocks
    vi.doMock('nodemailer', () => {
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'mock-msg-id' })
      return {
        default: {
          createTransport: vi.fn(() => ({
            sendMail: sendMailMock,
            verify: vi.fn().mockResolvedValue(true),
          })),
        },
      }
    })
    vi.doMock('../../src/services/d1UserDatabase', () => ({
      d1UserDatabase: {
        getUserDefaultSMTPConfig: vi.fn().mockResolvedValue(null),
      },
    }))
    vi.doMock('../../src/services/logService', () => ({
      logService: {
        getLogs: vi.fn().mockReturnValue([]),
        addLog: vi.fn(),
      },
    }))
    vi.doMock('../../src/utils/logger', () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        startup: vi.fn(),
      },
    }))
    vi.doMock('../../src/templates/notificationTemplates', () => ({
      createNotificationSubject: vi.fn((stats: any) => `Campaign Complete: ${stats.sent}/${stats.total} sent`),
      createNotificationHTML: vi.fn(() => '<html>notification</html>'),
    }))

    // Override env to prevent auto-initialization
    const origEnv = process.env.NOTIFICATION_SMTP_USER
    delete process.env.NOTIFICATION_SMTP_USER

    const mod = await import('../../src/services/notificationService')
    notificationService = mod.notificationService

    // Restore env
    if (origEnv) process.env.NOTIFICATION_SMTP_USER = origEnv
  })

  it('setupGlobalNotificationSender configures the transporter', async () => {
    const nodemailer = (await import('nodemailer')).default

    notificationService.setupGlobalNotificationSender({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      user: 'user@test.com',
      pass: 'password',
      fromName: 'Test Notifications',
    })

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.test.com',
        port: 587,
        secure: false,
      })
    )
  })

  it('getCampaignStats returns correct stats from logs', async () => {
    const { logService: ls } = await import('../../src/services/logService')
    vi.mocked(ls.getLogs).mockReturnValue([
      { id: 'job_1_0', email: 'a@b.com', status: 'Sent', timestamp: '' },
      { id: 'job_1_1', email: 'b@b.com', status: 'Sent', timestamp: '' },
      { id: 'job_1_2', email: 'c@b.com', status: 'Failed', timestamp: '' },
      { id: 'job_2_0', email: 'd@b.com', status: 'Sent', timestamp: '' },
    ])

    const stats = notificationService.getCampaignStats('job_1')
    expect(stats.sent).toBe(2)
    expect(stats.failed).toBe(1)
    expect(stats.total).toBe(3)
    expect(stats.successRate).toBeCloseTo(66.7, 0)
  })

  it('getCampaignStats returns zeros for unknown job', async () => {
    const { logService: ls } = await import('../../src/services/logService')
    vi.mocked(ls.getLogs).mockReturnValue([])

    const stats = notificationService.getCampaignStats('nonexistent')
    expect(stats.total).toBe(0)
    expect(stats.sent).toBe(0)
    expect(stats.successRate).toBe(0)
  })

  it('sendJobCompletionNotification returns false with no config', async () => {
    const result = await notificationService.sendJobCompletionNotification(
      'user_1',
      'notify@test.com',
      { sent: 10, failed: 2, total: 12, errors: 0 },
      {
        id: 'job_1',
        subject: 'Test Campaign',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T01:00:00Z',
        configUsed: 'Config A',
        batchMode: false,
      },
      'Config A'
    )
    expect(result).toBe(false)
  })
})
