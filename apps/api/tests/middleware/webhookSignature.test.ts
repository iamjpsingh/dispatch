// P8 T3 — explicit length-guard on timingSafeEqual: length-mismatched signatures must
// return false (not throw), and a correctly-computed HMAC must still verify true.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyMailgunSignature, verifySparkPostSignature } from '../../src/middleware/webhookSignature'

describe('webhookSignature — timingSafeEqual length-guard', () => {
  describe('verifyMailgunSignature', () => {
    it('returns false (does not throw) when the signature length differs from the computed HMAC', () => {
      expect(() =>
        verifyMailgunSignature('123', 'token', 'short', 'signing-key')
      ).not.toThrow()
      expect(verifyMailgunSignature('123', 'token', 'short', 'signing-key')).toBe(false)
    })

    it('returns true for a correctly-computed HMAC-SHA256', () => {
      const timestamp = '1234567890'
      const token = 'a-token'
      const signingKey = 'a-signing-key'
      const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex')

      expect(verifyMailgunSignature(timestamp, token, signature, signingKey)).toBe(true)
    })
  })

  describe('verifySparkPostSignature', () => {
    it('returns false (does not throw) when the signature length differs from the computed HMAC', () => {
      expect(() =>
        verifySparkPostSignature('body', 'short', 'auth-token')
      ).not.toThrow()
      expect(verifySparkPostSignature('body', 'short', 'auth-token')).toBe(false)
    })

    it('returns true for a correctly-computed HMAC-SHA1', () => {
      const body = 'the-request-body'
      const authToken = 'an-auth-token'
      const signature = createHmac('sha1', authToken).update(body).digest('hex')

      expect(verifySparkPostSignature(body, signature, authToken)).toBe(true)
    })
  })
})
