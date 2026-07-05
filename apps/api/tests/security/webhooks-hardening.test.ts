// P8 T1 — webhooks.ts hardening: SSRF guard, fail-closed verification, dead eventBus removal.
// Mocks bounceProcessor + webhookSignature (key/verify helpers) so we control the
// verification outcome deterministically; isAllowedSnsUrl/verifyMailgunSignature etc.
// (the pure crypto/URL helpers) are left real via importOriginal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../src/services/bounceProcessor', () => ({
  parseSES: vi.fn(),
  parseMailgun: vi.fn(),
  parseSendGrid: vi.fn(),
  parsePostmark: vi.fn(),
  parseSparkPost: vi.fn(),
  processBounce: vi.fn(),
}))

vi.mock('../../src/middleware/webhookSignature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/middleware/webhookSignature')>()
  return {
    ...actual,
    verifySNSSignature: vi.fn(),
    getMailgunSigningKey: vi.fn(),
    getSendGridVerificationKey: vi.fn(),
    getSparkPostAuthToken: vi.fn(),
  }
})

// webhookService isn't exercised by the public bounce/inbound endpoints, but stub it
// so importing webhooksRoutes never risks a real DB call.
vi.mock('../../src/services/webhookService', () => ({
  webhookService: {
    create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn(),
    toggleEnabled: vi.fn(), getLogs: vi.fn(), clearLogs: vi.fn(), testWebhook: vi.fn(),
  },
}))

import { processBounce } from '../../src/services/bounceProcessor'
import { verifySNSSignature, getMailgunSigningKey } from '../../src/middleware/webhookSignature'
import webhooksRoutes from '../../src/routes/webhooks'

function appFor() {
  const app = new Hono()
  app.route('/', webhooksRoutes)
  return app
}

const jsonReq = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('P8 T1 — webhooks hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1a — SSRF guard on SNS SubscriptionConfirmation', () => {
    it('rejects a metadata-endpoint SubscribeURL with 401 and never fetches it', async () => {
      vi.mocked(verifySNSSignature).mockResolvedValue(true) // signature "valid" — URL allowlist must still catch this
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'))

      const res = await appFor().fetch(jsonReq('/webhooks/bounce/ses', {
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'http://169.254.169.254/latest/meta-data/',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      }))

      expect(res.status).toBe(401)
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })
  })

  describe('1b — fail-closed verification (Mailgun)', () => {
    it('rejects with 401 when no signing key is configured, even for a well-formed bounce', async () => {
      vi.mocked(getMailgunSigningKey).mockResolvedValue(null)

      const res = await appFor().fetch(jsonReq('/webhooks/bounce/mailgun', {
        'event-data': {
          event: 'failed',
          recipient: 'a@example.com',
          signature: { timestamp: '123', token: 'tok', signature: 'sig' },
        },
      }))

      expect(res.status).toBe(401)
      expect(processBounce).not.toHaveBeenCalled()
    })
  })

  describe('1c — dead eventBus.emit removed from inbound reply handlers', () => {
    it('POST /webhooks/inbound/sendgrid returns 200 without throwing', async () => {
      const formData = new FormData()
      formData.append('from', 'sender@example.com')
      formData.append('to', 'reply@dispatch.test')
      formData.append('subject', 'Re: Campaign')
      formData.append('text', 'thanks!')

      const res = await appFor().fetch(
        new Request('http://localhost/webhooks/inbound/sendgrid', { method: 'POST', body: formData })
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })
  })
})
