/**
 * Authentication Middleware
 * Local SQLite auth with org context
 */
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { authLocalService, type AuthUser } from '../services/authLocalService'
import { COOKIE } from '../config'

// User type for context
export type User = AuthUser

// Extend Hono Context with user and orgId
declare module 'hono' {
  interface ContextVariableMap {
    orgId: string | null
  }
  interface Context {
    user?: User
  }
}

/**
 * Authentication middleware
 * Validates session token, attaches user and org context
 */
export async function authMiddleware(c: Context, next: Next) {
  const token = getToken(c)

  if (!token) {
    return c.json({ success: false, message: 'Authentication required' }, 401)
  }

  const session = authLocalService.validateSession(token)

  if (!session) {
    return c.json({ success: false, message: 'Invalid or expired session' }, 401)
  }

  c.user = session.user
  c.set('orgId', session.orgId)
  return next()
}

/**
 * Require authenticated user
 */
export function requireAuth(c: Context): User {
  if (!c.user) {
    throw new Error('User not authenticated')
  }
  return c.user
}

/**
 * Get current org ID from context
 */
export function getOrgId(c: Context): string {
  const orgId = c.get('orgId')
  if (!orgId) {
    throw new Error('No organization context')
  }
  return orgId
}

/**
 * Extract token from request
 */
function getToken(c: Context): string | undefined {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return getCookie(c, COOKIE.SESSION_NAME)
}
