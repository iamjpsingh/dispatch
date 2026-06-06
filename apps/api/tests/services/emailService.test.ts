import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' })
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

vi.mock('../../src/services/logService', () => ({
  logService: {
    addLog: vi.fn(),
    getLogs: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('../../src/services/d1Service', () => ({
  d1Service: {
    isConfigured: vi.fn().mockReturnValue(false),
    generateCampaignId: vi.fn().mockReturnValue('camp_test_123'),
    registerEmail: vi.fn().mockResolvedValue(null),
    injectTracking: vi.fn((html: string) => html),
  },
}))

vi.mock('../../src/config', () => ({
  TRACKING: {
    WORKER_URL: '',
    isConfigured: () => false,
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

import nodemailer from 'nodemailer'
import { logService } from '../../src/services/logService'
import { EmailService } from '../../src/services/emailService'
import type { EmailConfig, EmailJob, Contact } from '../../src/types/index'

describe('EmailService', () => {
  let emailService: EmailService

  const testConfig: EmailConfig = {
    host: 'smtp.test.com',
    port: 587,
    secure: false,
    auth: { user: 'user@test.com', pass: 'password' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    emailService = new EmailService()
  })

  // ============================================================================
  // createTransport
  // ============================================================================

  describe('createTransport', () => {
    it('creates a nodemailer transport with config', () => {
      emailService.createTransport(testConfig)

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        auth: { user: 'user@test.com', pass: 'password' },
      })
    })
  })

  // ============================================================================
  // sendSingleEmail
  // ============================================================================

  describe('sendSingleEmail', () => {
    it('throws when transporter not configured', async () => {
      await expect(emailService.sendSingleEmail({ to: 'a@b.com' })).rejects.toThrow('Email transporter not configured')
    })

    it('sends email when transporter is configured', async () => {
      emailService.createTransport(testConfig)

      const result = await emailService.sendSingleEmail({
        from: 'sender@test.com',
        to: 'recipient@test.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(result.messageId).toBe('test-msg-id')
    })
  })

  // ============================================================================
  // sendBulkEmails
  // ============================================================================

  describe('sendBulkEmails', () => {
    const makeJob = (contacts: Contact[], delay = 0): EmailJob => ({
      contacts,
      htmlContent: '<p>Hello {{FirstName}}</p>',
      subject: 'Test {{Company}}',
      fromEmail: 'sender@test.com',
      fromName: 'Sender Name',
      config: testConfig,
      delay,
    })

    it('throws when transporter not configured', async () => {
      const job = makeJob([{ Email: 'a@b.com', FirstName: 'Alice' }])
      await expect(emailService.sendBulkEmails(job)).rejects.toThrow('Email transporter not configured')
    })

    it('sends emails to all contacts', async () => {
      emailService.createTransport(testConfig)

      const contacts: Contact[] = [
        { Email: 'alice@test.com', FirstName: 'Alice', Company: 'Acme' },
        { Email: 'bob@test.com', FirstName: 'Bob', Company: 'Corp' },
      ]

      const job = makeJob(contacts)
      await emailService.sendBulkEmails(job)

      // Get the mock sendMail from the created transport
      const transport = (nodemailer.createTransport as any).mock.results[0].value
      expect(transport.sendMail).toHaveBeenCalledTimes(2)

      // Check first call has personalized content
      const firstCall = transport.sendMail.mock.calls[0][0]
      expect(firstCall.to).toBe('alice@test.com')
      expect(firstCall.html).toContain('Alice')
      expect(firstCall.subject).toContain('Acme')
      expect(firstCall.from).toContain('Sender Name')

      // Check second call
      const secondCall = transport.sendMail.mock.calls[1][0]
      expect(secondCall.to).toBe('bob@test.com')
      expect(secondCall.html).toContain('Bob')
    })

    it('logs successful sends', async () => {
      emailService.createTransport(testConfig)

      const job = makeJob([{ Email: 'alice@test.com', FirstName: 'Alice' }])
      await emailService.sendBulkEmails(job)

      expect(logService.addLog).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@test.com',
          status: 'Sent',
          messageId: 'test-msg-id',
        })
      )
    })

    it('logs failed sends', async () => {
      emailService.createTransport(testConfig)

      const transport = (nodemailer.createTransport as any).mock.results[0].value
      transport.sendMail.mockRejectedValueOnce(new Error('SMTP timeout'))

      const job = makeJob([{ Email: 'fail@test.com' }])
      await emailService.sendBulkEmails(job)

      expect(logService.addLog).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'fail@test.com',
          status: 'Failed',
          message: 'SMTP timeout',
        })
      )
    })

    it('continues sending after a failure', async () => {
      emailService.createTransport(testConfig)

      const transport = (nodemailer.createTransport as any).mock.results[0].value
      transport.sendMail.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce({ messageId: 'msg-2' })

      const job = makeJob([{ Email: 'a@test.com' }, { Email: 'b@test.com' }])
      await emailService.sendBulkEmails(job)

      expect(transport.sendMail).toHaveBeenCalledTimes(2)
      expect(logService.addLog).toHaveBeenCalledTimes(2)
    })

    it('includes List-Unsubscribe header', async () => {
      emailService.createTransport(testConfig)

      const job = makeJob([{ Email: 'a@test.com' }])
      await emailService.sendBulkEmails(job)

      const transport = (nodemailer.createTransport as any).mock.results[0].value
      const mailOpts = transport.sendMail.mock.calls[0][0]
      expect(mailOpts.headers['List-Unsubscribe']).toContain('mailto:sender@test.com')
      expect(mailOpts.headers['Precedence']).toBe('bulk')
    })
  })

  // ============================================================================
  // testConnection
  // ============================================================================

  describe('testConnection', () => {
    it('returns true on successful verification', async () => {
      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(true)
    })

    it('returns false on verification failure', async () => {
      const mockTransport = (nodemailer.createTransport as any).mock.results
      // Need to make the next createTransport call return a failing verify
      ;(nodemailer.createTransport as any).mockReturnValueOnce({
        sendMail: vi.fn(),
        verify: vi.fn().mockRejectedValue(new Error('Connection refused')),
      })

      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(false)
    })
  })
})
