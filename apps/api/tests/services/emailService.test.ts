import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('nodemailer', () => {
  const verifyMock = vi.fn().mockResolvedValue(true)
  return {
    default: {
      createTransport: vi.fn(() => ({ sendMail: vi.fn(), verify: verifyMock })),
    },
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), startup: vi.fn() },
}))

import nodemailer from 'nodemailer'
import { EmailService } from '../../src/services/emailService'
import type { EmailConfig } from '../../src/types/index'

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

  describe('testConnection', () => {
    it('returns true on successful verification', async () => {
      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(true)
    })

    it('returns false on verification failure', async () => {
      ;(nodemailer.createTransport as any).mockReturnValueOnce({
        sendMail: vi.fn(),
        verify: vi.fn().mockRejectedValue(new Error('Connection refused')),
      })

      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(false)
    })
  })
})
