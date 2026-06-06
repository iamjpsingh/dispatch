import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Mocks must be declared before importing the route module under test.
// ---------------------------------------------------------------------------

// The /api/tracking/event endpoint is authenticated ONLY by a shared secret.
// We control that secret value via the config mock so we can exercise the
// fail-closed paths deterministically (no reliance on process.env at import).
vi.mock('../../src/config', () => ({
  TRACKING: {
    WORKER_URL: '',
    isConfigured: () => false,
    TRACKING_SYNC_SECRET: 'test-secret',
  },
}))

vi.mock('../../src/services/d1Service', () => ({
  d1Service: {
    isConfigured: () => false,
    getWorkerUrl: () => '',
  },
}))

vi.mock('../../src/services/contactService', () => ({
  contactService: {
    getContactByEmail: vi.fn(),
  },
}))

vi.mock('../../src/services/eventBus', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

import { contactService } from '../../src/services/contactService'
import { eventBus } from '../../src/services/eventBus'
import trackingRoutes from '../../src/routes/tracking'

const SECRET = 'test-secret'

function createApp() {
  const app = new Hono()
  // Mounted under /api in production (app.route('/api', trackingRoutes)).
  app.route('/api', trackingRoutes)
  return app
}

function eventRequest(opts: { secret?: string | null; body: unknown }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.secret !== null && opts.secret !== undefined) {
    headers['X-Tracking-Secret'] = opts.secret
  }
  return new Request('http://localhost/api/tracking/event', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
}

describe('POST /api/tracking/event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------
  // (a) Auth: fail CLOSED on missing / wrong secret
  // ---------------------------------------------------------------------
  it('rejects a request with a missing secret header (401/403) and does not emit', async () => {
    const app = createApp()
    const res = await app.fetch(
      eventRequest({ secret: null, body: { type: 'open', email: 'a@b.com' } })
    )

    expect([401, 403]).toContain(res.status)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('rejects a request with a wrong secret (401/403) and does not emit', async () => {
    const app = createApp()
    const res = await app.fetch(
      eventRequest({ secret: 'wrong-secret', body: { type: 'open', email: 'a@b.com' } })
    )

    expect([401, 403]).toContain(res.status)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------
  // (b) Happy path: valid secret + open + known email -> emit
  // ---------------------------------------------------------------------
  it('emits email_opened with contactId as 5th arg for a known email', async () => {
    const app = createApp()
    vi.mocked(contactService.getContactByEmail).mockReturnValue({
      id: 'contact-123',
      org_id: 'org-1',
      user_id: 'user-9',
    } as any)

    const res = await app.fetch(
      eventRequest({
        secret: SECRET,
        body: { type: 'open', email: 'known@example.com', campaignId: 'camp-7', messageId: 'msg-1' },
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      'email_opened',
      'user-9',
      expect.objectContaining({ email: 'known@example.com', campaignId: 'camp-7', messageId: 'msg-1' }),
      'camp-7',
      'contact-123'
    )
  })

  it('maps click -> email_clicked and forwards url', async () => {
    const app = createApp()
    vi.mocked(contactService.getContactByEmail).mockReturnValue({
      id: 'contact-123',
      org_id: 'org-1',
      user_id: 'user-9',
    } as any)

    const res = await app.fetch(
      eventRequest({
        secret: SECRET,
        body: { type: 'click', email: 'known@example.com', campaignId: 'camp-7', url: 'https://x.test/y' },
      })
    )

    expect(res.status).toBe(200)
    expect(eventBus.emit).toHaveBeenCalledWith(
      'email_clicked',
      'user-9',
      expect.objectContaining({ url: 'https://x.test/y' }),
      'camp-7',
      'contact-123'
    )
  })

  it('rejects an unknown event type with 400 and does not emit', async () => {
    const app = createApp()
    const res = await app.fetch(
      eventRequest({ secret: SECRET, body: { type: 'bounce', email: 'a@b.com' } })
    )

    expect(res.status).toBe(400)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------
  // (c) Unknown email -> 200 matched:false, no emit
  // ---------------------------------------------------------------------
  it('returns 200 matched:false for an unknown email and does not emit', async () => {
    const app = createApp()
    vi.mocked(contactService.getContactByEmail).mockReturnValue(null as any)

    const res = await app.fetch(
      eventRequest({ secret: SECRET, body: { type: 'open', email: 'nobody@example.com' } })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.matched).toBe(false)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Fail-closed when the secret is NOT configured at all (empty string).
// A separate suite with its own module mock so we can flip the config.
// ---------------------------------------------------------------------------
describe('POST /api/tracking/event (no secret configured)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('rejects even a correct-looking request when TRACKING_SYNC_SECRET is empty', async () => {
    vi.doMock('../../src/config', () => ({
      TRACKING: { WORKER_URL: '', isConfigured: () => false, TRACKING_SYNC_SECRET: '' },
    }))
    vi.doMock('../../src/services/d1Service', () => ({
      d1Service: { isConfigured: () => false, getWorkerUrl: () => '' },
    }))
    vi.doMock('../../src/services/contactService', () => ({
      contactService: { getContactByEmail: vi.fn() },
    }))
    const emitSpy = vi.fn().mockResolvedValue(undefined)
    vi.doMock('../../src/services/eventBus', () => ({ eventBus: { emit: emitSpy } }))
    vi.doMock('../../src/utils/logger', () => ({
      logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    }))

    const { default: routes } = await import('../../src/routes/tracking')
    const app = new Hono()
    app.route('/api', routes)

    const res = await app.fetch(
      new Request('http://localhost/api/tracking/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tracking-Secret': '' },
        body: JSON.stringify({ type: 'open', email: 'a@b.com' }),
      })
    )

    expect([401, 403]).toContain(res.status)
    expect(emitSpy).not.toHaveBeenCalled()
  })
})
