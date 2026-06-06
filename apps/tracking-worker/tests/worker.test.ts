import { describe, it, expect, beforeEach } from 'vitest'
import worker from '../src/index'
import { createMockEnv, createMockExecutionContext } from './helpers/mockD1'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(path: string, init?: RequestInit) {
  return new Request(`https://worker.test${path}`, init)
}

function jsonReq(path: string, body: any, headers?: Record<string, string>) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function jsonBody(res: Response) {
  return res.json() as Promise<any>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tracking Worker', () => {
  let env: ReturnType<typeof createMockEnv>
  let ctx: ReturnType<typeof createMockExecutionContext>

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockExecutionContext()
  })

  // =========================================================================
  // Health
  // =========================================================================

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await worker.fetch(req('/health'), env, ctx as any)
      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.status).toBe('ok')
      expect(data.timestamp).toBeDefined()
    })
  })

  // =========================================================================
  // CORS
  // =========================================================================

  describe('CORS', () => {
    it('OPTIONS preflight returns CORS headers', async () => {
      const res = await worker.fetch(req('/api/auth/login', { method: 'OPTIONS' }), env, ctx as any)
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    })

    it('returns wildcard origin when ALLOWED_ORIGINS is empty', async () => {
      const res = await worker.fetch(req('/health'), env, ctx as any)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('reflects matching origin when ALLOWED_ORIGINS is set', async () => {
      const envWithOrigins = createMockEnv({ ALLOWED_ORIGINS: 'https://app.example.com,https://other.example.com' })
      const request = req('/health')
      // Manually set origin header
      const reqWithOrigin = new Request('https://worker.test/health', {
        headers: { Origin: 'https://app.example.com' },
      })
      const res = await worker.fetch(reqWithOrigin, envWithOrigins, ctx as any)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
      expect(res.headers.get('Vary')).toBe('Origin')
    })

    it('returns first allowed origin when request origin does not match', async () => {
      const envWithOrigins = createMockEnv({ ALLOWED_ORIGINS: 'https://app.example.com' })
      const reqWithBadOrigin = new Request('https://worker.test/health', {
        headers: { Origin: 'https://evil.com' },
      })
      const res = await worker.fetch(reqWithBadOrigin, envWithOrigins, ctx as any)
      // Falls back to first allowed origin (non-matching, effectively denies)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    })
  })

  // =========================================================================
  // Tracking pixel – GET /o/:id
  // =========================================================================

  describe('GET /o/:id (tracking pixel)', () => {
    it('returns a 1x1 GIF image', async () => {
      const res = await worker.fetch(req('/o/abc123'), env, ctx as any)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/gif')
      expect(res.headers.get('Cache-Control')).toContain('no-store')

      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      // GIF89a magic bytes
      expect(bytes[0]).toBe(0x47) // G
      expect(bytes[1]).toBe(0x49) // I
      expect(bytes[2]).toBe(0x46) // F
    })

    it('calls ctx.waitUntil for background DB write', async () => {
      await worker.fetch(req('/o/track1'), env, ctx as any)
      // waitUntil should have been called once
      await ctx._flush()
      // No assertion error means the background task ran
    })
  })

  // =========================================================================
  // Click redirect – GET /c/:id
  // =========================================================================

  describe('GET /c/:id (click redirect)', () => {
    it('returns 302 redirect to target URL', async () => {
      const target = 'https://example.com/landing'
      const res = await worker.fetch(req(`/c/click1?url=${encodeURIComponent(target)}`), env, ctx as any)
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe(target)
    })

    it('returns 400 when url param is missing', async () => {
      const res = await worker.fetch(req('/c/click1'), env, ctx as any)
      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('Missing URL')
    })
  })

  // =========================================================================
  // Auth – Register
  // =========================================================================

  describe('POST /api/auth/register', () => {
    it('registers a new user and returns token', async () => {
      // Mock: no existing user found
      env.DB._mockQuery((sql: string) => sql.includes('SELECT id FROM users'), { first: null })

      const res = await worker.fetch(
        jsonReq('/api/auth/register', {
          email: 'test@example.com',
          password: 'StrongP@ss1',
          name: 'Test User',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.token).toBeDefined()
      expect(data.user.email).toBe('test@example.com')
    })

    it('returns 400 when email is missing', async () => {
      const res = await worker.fetch(jsonReq('/api/auth/register', { password: 'pass123' }), env, ctx as any)
      expect(res.status).toBe(400)
      const data = await jsonBody(res)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Email and password required')
    })

    it('returns 400 when password is missing', async () => {
      const res = await worker.fetch(jsonReq('/api/auth/register', { email: 'a@b.com' }), env, ctx as any)
      expect(res.status).toBe(400)
      const data = await jsonBody(res)
      expect(data.success).toBe(false)
    })

    it('returns 400 when email already exists', async () => {
      env.DB._mockQuery((sql: string) => sql.includes('SELECT id FROM users'), { first: { id: 'existing-user' } })

      const res = await worker.fetch(
        jsonReq('/api/auth/register', {
          email: 'taken@example.com',
          password: 'StrongP@ss1',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(400)
      const data = await jsonBody(res)
      expect(data.error).toContain('already registered')
    })
  })

  // =========================================================================
  // Auth – Login
  // =========================================================================

  describe('POST /api/auth/login', () => {
    it('returns 400 when email/password missing', async () => {
      const res = await worker.fetch(jsonReq('/api/auth/login', {}), env, ctx as any)
      expect(res.status).toBe(400)
      const data = await jsonBody(res)
      expect(data.error).toContain('Email and password required')
    })

    it('returns 401 when user not found', async () => {
      env.DB._mockQuery((sql: string) => sql.includes('SELECT id, email, password_hash'), { first: null })

      const res = await worker.fetch(
        jsonReq('/api/auth/login', {
          email: 'nobody@example.com',
          password: 'pass',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(401)
      const data = await jsonBody(res)
      expect(data.error).toContain('Invalid credentials')
    })

    it('returns 401 when password is wrong', async () => {
      // Create a real hash for "correct_password" so "wrong_password" fails
      // We use the worker's PBKDF2 implementation indirectly — mock a stored hash
      // that was generated from a known password using PBKDF2.
      // For simplicity, mock the DB to return a hash that won't match.
      const encoder = new TextEncoder()
      const salt = new Uint8Array(16)
      crypto.getRandomValues(salt)
      const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode('correct_password'), 'PBKDF2', false, [
        'deriveBits',
      ])
      const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
      )
      const saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const hashHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const storedHash = `${saltHex}:${hashHex}`

      env.DB._mockQuery((sql: string) => sql.includes('SELECT id, email, password_hash'), {
        first: {
          id: 'user1',
          email: 'user@example.com',
          password_hash: storedHash,
          name: 'User',
        },
      })

      const res = await worker.fetch(
        jsonReq('/api/auth/login', {
          email: 'user@example.com',
          password: 'wrong_password',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(401)
      const data = await jsonBody(res)
      expect(data.error).toContain('Invalid credentials')
    })

    it('returns 200 with token when credentials are correct', async () => {
      // Hash the password "my_secret" properly with PBKDF2
      const encoder = new TextEncoder()
      const salt = new Uint8Array(16)
      crypto.getRandomValues(salt)
      const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode('my_secret'), 'PBKDF2', false, [
        'deriveBits',
      ])
      const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
      )
      const saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const hashHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const storedHash = `${saltHex}:${hashHex}`

      env.DB._mockQuery((sql: string) => sql.includes('SELECT id, email, password_hash'), {
        first: {
          id: 'user1',
          email: 'user@example.com',
          password_hash: storedHash,
          name: 'Test',
        },
      })

      const res = await worker.fetch(
        jsonReq('/api/auth/login', {
          email: 'user@example.com',
          password: 'my_secret',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.token).toBeDefined()
      expect(typeof data.token).toBe('string')
      expect(data.token.length).toBeGreaterThan(0)
      expect(data.user.email).toBe('user@example.com')
    })
  })

  // =========================================================================
  // Auth – Validate session
  // =========================================================================

  describe('GET /api/auth/validate', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await worker.fetch(req('/api/auth/validate'), env, ctx as any)
      expect(res.status).toBe(401)
      const data = await jsonBody(res)
      expect(data.error).toContain('No token')
    })

    it('returns 401 when token is invalid/expired', async () => {
      env.DB._mockQuery((sql: string) => sql.includes('sessions') && sql.includes('token'), { first: null })

      const res = await worker.fetch(
        req('/api/auth/validate', {
          headers: { Authorization: 'Bearer invalid_token' },
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(401)
      const data = await jsonBody(res)
      expect(data.error).toContain('Invalid or expired')
    })

    it('returns 200 with user data for valid session', async () => {
      env.DB._mockQuery((sql: string) => sql.includes('sessions') && sql.includes('token'), {
        first: {
          user_id: 'u1',
          email: 'valid@example.com',
          name: 'Valid User',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      })

      const res = await worker.fetch(
        req('/api/auth/validate', {
          headers: { Authorization: 'Bearer valid_token_123' },
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.user.email).toBe('valid@example.com')
      expect(data.user.name).toBe('Valid User')
    })
  })

  // =========================================================================
  // Config – requires auth
  // =========================================================================

  describe('GET /api/configs', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(req('/api/configs'), env, ctx as any)
      expect(res.status).toBe(401)
      const data = await jsonBody(res)
      expect(data.error).toContain('Unauthorized')
    })

    it('returns configs for authenticated user', async () => {
      // Mock the auth session lookup
      env.DB._mockQuery((sql: string) => sql.includes('sessions') && sql.includes('JOIN users'), {
        first: { user_id: 'u1', email: 'user@example.com', name: 'User' },
      })
      // Mock config results
      env.DB._mockQuery((sql: string) => sql.includes('smtp_configs') && sql.includes('SELECT'), {
        results: [{ id: 'c1', name: 'Gmail', host: 'smtp.gmail.com', port: 465 }],
      })

      const res = await worker.fetch(
        req('/api/configs', {
          headers: { Authorization: 'Bearer tok123' },
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.configs).toBeInstanceOf(Array)
    })
  })

  // =========================================================================
  // Email registration – POST /api/email
  // =========================================================================

  describe('POST /api/email', () => {
    it('registers an email and returns tracking_id', async () => {
      const res = await worker.fetch(
        jsonReq('/api/email', {
          user_id: 'u1',
          campaign_id: 'camp1',
          campaign_name: 'Test Campaign',
          subject: 'Hello',
          from_email: 'sender@example.com',
          from_name: 'Sender',
          recipient_email: 'recipient@example.com',
          recipient_name: 'Recipient',
        }),
        env,
        ctx as any
      )

      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.tracking_id).toBeDefined()
      expect(typeof data.tracking_id).toBe('string')
      expect(data.email_id).toBeDefined()
    })
  })

  // =========================================================================
  // Unsubscribe – GET /u/:id
  // =========================================================================

  describe('GET /u/:id (unsubscribe page)', () => {
    it('returns HTML unsubscribe confirmation page', async () => {
      const res = await worker.fetch(req('/u/unsub123'), env, ctx as any)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/html')

      const html = await res.text()
      expect(html).toContain('unsubscribed')
      expect(html).toContain('unsub123')
    })

    it('POST /u/:id returns plain text confirmation', async () => {
      const res = await worker.fetch(req('/u/unsub456', { method: 'POST' }), env, ctx as any)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/plain')

      const text = await res.text()
      expect(text).toContain('unsubscribed')
    })
  })

  // =========================================================================
  // Not found
  // =========================================================================

  describe('Unknown routes', () => {
    it('GET /random returns 404', async () => {
      const res = await worker.fetch(req('/random'), env, ctx as any)
      expect(res.status).toBe(404)
    })

    it('GET /api/nonexistent returns 404', async () => {
      const res = await worker.fetch(req('/api/nonexistent'), env, ctx as any)
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Auth – Logout
  // =========================================================================

  describe('POST /api/auth/logout', () => {
    it('returns success even without token', async () => {
      const res = await worker.fetch(req('/api/auth/logout', { method: 'POST' }), env, ctx as any)
      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
    })

    it('returns success with Bearer token', async () => {
      const res = await worker.fetch(
        req('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer some_token' },
        }),
        env,
        ctx as any
      )
      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
    })
  })

  // =========================================================================
  // Bounce webhook – POST /api/bounce
  // =========================================================================

  describe('POST /api/bounce', () => {
    it('returns 400 when email or user_id missing', async () => {
      const res = await worker.fetch(jsonReq('/api/bounce', { bounce_type: 'hard' }), env, ctx as any)
      expect(res.status).toBe(400)
      const data = await jsonBody(res)
      expect(data.success).toBe(false)
    })

    it('records a hard bounce', async () => {
      const res = await worker.fetch(
        jsonReq('/api/bounce', {
          email: 'bounced@example.com',
          user_id: 'u1',
          bounce_type: 'hard',
          tracking_id: 'track1',
        }),
        env,
        ctx as any
      )
      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.success).toBe(true)
      expect(data.message).toContain('hard_bounce')
    })

    it('records a soft bounce', async () => {
      const res = await worker.fetch(
        jsonReq('/api/bounce', {
          email: 'soft@example.com',
          user_id: 'u1',
          bounce_type: 'soft',
        }),
        env,
        ctx as any
      )
      expect(res.status).toBe(200)
      const data = await jsonBody(res)
      expect(data.message).toContain('soft_bounce')
    })
  })

  // =========================================================================
  // Suppression – requires auth
  // =========================================================================

  describe('GET /api/suppressions', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(req('/api/suppressions'), env, ctx as any)
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/suppressions/check', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(jsonReq('/api/suppressions/check', { emails: ['a@b.com'] }), env, ctx as any)
      expect(res.status).toBe(401)
    })
  })

  // =========================================================================
  // Stats & Dashboard – requires auth
  // =========================================================================

  describe('GET /api/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(req('/api/stats'), env, ctx as any)
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/logs', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(req('/api/logs'), env, ctx as any)
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/dashboard', () => {
    it('returns 401 without auth', async () => {
      const res = await worker.fetch(req('/api/dashboard'), env, ctx as any)
      expect(res.status).toBe(401)
    })
  })
})
