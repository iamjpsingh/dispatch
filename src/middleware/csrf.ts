// src/middleware/csrf.ts - CSRF Protection Middleware
// Double-submit cookie pattern (stateless, no session dependency)

import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'x-csrf-token'
const TOKEN_LENGTH = 32

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Issue a CSRF token cookie on every response
 */
export async function csrfTokenIssuer(c: Context, next: Next) {
  await next()

  // Only set cookie if not already present
  const existing = getCookie(c, CSRF_COOKIE)
  if (!existing) {
    const token = generateToken()
    setCookie(c, CSRF_COOKIE, token, {
      httpOnly: false,  // Must be readable by JS
      sameSite: 'Lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
  }
}

/**
 * Validate CSRF token on mutation requests
 * Skips GET, HEAD, OPTIONS, and API key authenticated requests
 */
export async function csrfProtection(c: Context, next: Next) {
  const method = c.req.method

  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next()
  }

  // Skip if using API key auth (Bearer token = machine-to-machine)
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return next()
  }

  // Skip tracking/webhook endpoints (external callers)
  const path = c.req.path
  if (
    path.startsWith('/api/track/') ||
    path.startsWith('/api/tracking/') ||
    path.startsWith('/api/webhooks/')
  ) {
    return next()
  }

  // Validate: header token must match cookie token
  const cookieToken = getCookie(c, CSRF_COOKIE)
  const headerToken = c.req.header(CSRF_HEADER)

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return c.json({
      success: false,
      message: 'CSRF validation failed. Include X-CSRF-Token header.',
    }, 403)
  }

  return next()
}
