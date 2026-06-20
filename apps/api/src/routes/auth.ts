/**
 * Authentication Routes
 * Login, Register, Logout, Session Management
 */
import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import {
  RegisterSchema,
  LoginSchema,
  SwitchOrgSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  UpdateProfileSchema,
} from '@dispatch/shared/auth'
import { authLocalService } from '../services/authLocalService'
import { orgService } from '../services/orgService'
import { rbacService } from '../services/rbacService'
import { COOKIE, isHttps } from '../config'
import { error, success, ErrorMessages } from '../utils/response'
import { systemMailerService } from '../services/systemMailerService'
import { logger } from '../utils/logger'

const authRoutes = new Hono()
  /**
   * Register new user
   * POST /auth/register
   */
  .post('/auth/register', zValidator('json', RegisterSchema), async (c) => {
    try {
      const { email, name, password } = c.req.valid('json')

      const session = await authLocalService.register(email, password, name)
      if (!session) {
        return error(c, 'Registration failed. Email may already exist.', 400)
      }

      const secure = isHttps(c.req.raw.headers, c.req.url)
      setCookie(c, COOKIE.SESSION_NAME, session.token, {
        ...COOKIE.OPTIONS,
        secure,
      })

      const orgs = await orgService.listForUser(session.user.id)
      const role = session.orgId ? await rbacService.getUserRole(session.user.id, session.orgId) : null

      return success(c, {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          is_platform_admin: !!session.user.is_platform_admin,
        },
        orgId: session.orgId,
        role,
        orgs: orgs.map(o => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      }, 'Account created successfully')
    } catch (err) {
      logger.error('Registration error:', err)
      return error(c, 'Registration failed', 500)
    }
  })
  /**
   * Login user
   * POST /auth/login
   */
  .post('/auth/login', zValidator('json', LoginSchema), async (c) => {
    try {
      const { email, password } = c.req.valid('json')

      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip')
      const userAgent = c.req.header('user-agent')
      const session = await authLocalService.login(email, password, ipAddress, userAgent)
      if (!session) {
        return error(c, 'Invalid email or password', 401)
      }

      const secure = isHttps(c.req.raw.headers, c.req.url)
      setCookie(c, COOKIE.SESSION_NAME, session.token, {
        ...COOKIE.OPTIONS,
        secure,
      })

      const orgs = await orgService.listForUser(session.user.id)
      const role = session.orgId ? await rbacService.getUserRole(session.user.id, session.orgId) : null

      return success(c, {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          is_platform_admin: !!session.user.is_platform_admin,
        },
        orgId: session.orgId,
        role,
        orgs: orgs.map(o => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      }, 'Login successful')
    } catch (err) {
      logger.error('Login error:', err)
      return error(c, 'Login failed', 500)
    }
  })
  /**
   * Logout user
   * POST /auth/logout
   */
  .post('/auth/logout', async (c) => {
    try {
      const token = getCookie(c, COOKIE.SESSION_NAME)
      if (token) {
        await authLocalService.logout(token)
      }
      deleteCookie(c, COOKIE.SESSION_NAME)
      return success(c, undefined, 'Logged out successfully')
    } catch (err) {
      logger.error('Logout error:', err)
      return error(c, 'Logout failed', 500)
    }
  })
  /**
   * Get current user
   * GET /auth/me
   */
  .get('/auth/me', async (c) => {
    try {
      const token = getCookie(c, COOKIE.SESSION_NAME)
      if (!token) {
        return error(c, ErrorMessages.UNAUTHORIZED, 401)
      }

      const session = await authLocalService.validateSession(token)
      if (!session) {
        deleteCookie(c, COOKIE.SESSION_NAME)
        return error(c, ErrorMessages.SESSION_EXPIRED, 401)
      }

      const { user, orgId } = session
      const orgs = await orgService.listForUser(user.id)
      const role = orgId ? await rbacService.getUserRole(user.id, orgId) : null

      return success(c, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          is_platform_admin: !!user.is_platform_admin,
        },
        orgId,
        role,
        orgs: orgs.map(o => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      })
    } catch (err) {
      logger.error('Auth check error:', err)
      return error(c, 'Auth check failed', 500)
    }
  })
  /**
   * Switch active organization
   * POST /auth/switch-org
   */
  .post('/auth/switch-org', zValidator('json', SwitchOrgSchema), async (c) => {
    try {
      const token = getCookie(c, COOKIE.SESSION_NAME)
      if (!token) return error(c, ErrorMessages.UNAUTHORIZED, 401)

      const { orgId } = c.req.valid('json')

      const session = await authLocalService.validateSession(token)
      if (!session) return error(c, ErrorMessages.SESSION_EXPIRED, 401)

      // Verify user is member of target org
      const isMember = await rbacService.isMember(session.user.id, orgId)
      const isPlatformAdmin = await rbacService.isPlatformAdmin(session.user.id)
      if (!isMember && !isPlatformAdmin) {
        return error(c, 'You are not a member of this organization', 403)
      }

      await authLocalService.switchOrg(token, orgId)
      return success(c, { orgId }, 'Organization switched')
    } catch (err) {
      logger.error('Switch org error:', err)
      return error(c, 'Failed to switch organization', 500)
    }
  })
  /**
   * Forgot password — create reset token
   * POST /auth/forgot-password
   */
  .post('/auth/forgot-password', zValidator('json', ForgotPasswordSchema), async (c) => {
    try {
      const { email } = c.req.valid('json')

      // Always return success to prevent email enumeration
      const result = await authLocalService.createPasswordResetToken(email)
      if (result) {
        if (await systemMailerService.isConfigured()) {
          try {
            await systemMailerService.sendPasswordReset(email, result.token)
            logger.info(`Password reset email sent to ${email}`)
          } catch (mailErr: any) {
            logger.error(`Failed to send password reset email to ${email}: ${mailErr.message}`)
          }
        } else {
          logger.warn(`Password reset token created for ${email} but system mailer is not configured`)
        }
      }

      return success(c, undefined, 'If an account exists with that email, a reset link has been sent.')
    } catch (err) {
      logger.error('Forgot password error:', err)
      return error(c, 'Failed to process request', 500)
    }
  })
  /**
   * Validate reset token
   * GET /auth/reset-password/:token
   */
  .get('/auth/reset-password/:token', async (c) => {
    const token = c.req.param('token')
    const valid = await authLocalService.validateResetToken(token)
    if (!valid) {
      return error(c, 'Invalid or expired reset token', 400)
    }
    return success(c, { valid: true })
  })
  /**
   * Reset password with token
   * POST /auth/reset-password
   */
  .post('/auth/reset-password', zValidator('json', ResetPasswordSchema), async (c) => {
    try {
      const { token, password } = c.req.valid('json')

      const result = await authLocalService.resetPassword(token, password)
      if (!result) {
        return error(c, 'Invalid or expired reset token', 400)
      }

      return success(c, undefined, 'Password reset successfully. Please log in.')
    } catch (err) {
      logger.error('Reset password error:', err)
      return error(c, 'Failed to reset password', 500)
    }
  })
  /**
   * Change password (authenticated)
   * POST /auth/change-password
   */
  .post('/auth/change-password', zValidator('json', ChangePasswordSchema), async (c) => {
    try {
      const token = getCookie(c, COOKIE.SESSION_NAME)
      if (!token) return error(c, ErrorMessages.UNAUTHORIZED, 401)

      const session = await authLocalService.validateSession(token)
      if (!session) return error(c, ErrorMessages.SESSION_EXPIRED, 401)

      const { currentPassword, newPassword } = c.req.valid('json')

      const result = await authLocalService.updatePassword(session.user.id, currentPassword, newPassword)
      if (!result) {
        return error(c, 'Current password is incorrect', 400)
      }

      return success(c, undefined, 'Password changed successfully')
    } catch (err) {
      logger.error('Change password error:', err)
      return error(c, 'Failed to change password', 500)
    }
  })
  /**
   * Update profile
   * PUT /auth/profile
   */
  .put('/auth/profile', zValidator('json', UpdateProfileSchema), async (c) => {
    try {
      const token = getCookie(c, COOKIE.SESSION_NAME)
      if (!token) return error(c, ErrorMessages.UNAUTHORIZED, 401)

      const session = await authLocalService.validateSession(token)
      if (!session) return error(c, ErrorMessages.SESSION_EXPIRED, 401)

      const data = c.req.valid('json')

      const updated = await authLocalService.updateProfile(session.user.id, data)
      if (!updated) {
        return error(c, 'Failed to update profile. Email may already be in use.', 400)
      }

      return success(c, {
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          is_platform_admin: !!updated.is_platform_admin,
        },
      }, 'Profile updated')
    } catch (err) {
      logger.error('Update profile error:', err)
      return error(c, 'Failed to update profile', 500)
    }
  })
  // ==========================================================================
  // Username
  // ==========================================================================
  .get('/auth/check-username', async (c) => {
    const username = c.req.query('username')
    if (!username) return error(c, 'username query param required', 400)
    const token = getCookie(c, COOKIE.SESSION_NAME)
    const session = token ? await authLocalService.validateSession(token) : null
    const result = await authLocalService.checkUsername(username, session?.user.id)
    return success(c, result)
  })
  .put('/auth/profile/username', async (c) => {
    const token = getCookie(c, COOKIE.SESSION_NAME)
    if (!token) return error(c, 'Authentication required', 401)
    const session = await authLocalService.validateSession(token)
    if (!session) return error(c, 'Invalid session', 401)

    const body = await c.req.json() as { username: string }
    if (!body.username) return error(c, 'username is required', 400)

    try {
      await authLocalService.setUsername(session.user.id, body.username)
      return success(c, undefined, 'Username updated')
    } catch (e: any) {
      return error(c, e.message, 400)
    }
  })
  .get('/auth/profile/username/suggest', async (c) => {
    const token = getCookie(c, COOKIE.SESSION_NAME)
    if (!token) return error(c, 'Authentication required', 401)
    const session = await authLocalService.validateSession(token)
    if (!session) return error(c, 'Invalid session', 401)

    const suggestion = await authLocalService.suggestUsername(session.user.email)
    return success(c, { suggestion })
  })

export default authRoutes
export type AuthRoutes = typeof authRoutes
