import { and, eq, ne, gt, lt, isNull, desc, count } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { users, sessions, password_reset_tokens } from '../db/pg/schema'
import { auditService } from './auditService'
import { orgService } from './orgService'
import { generateId } from '../utils/id'

export interface AuthUser {
  id: string
  email: string
  name: string
  status: string
  is_platform_admin: number
}

export interface AuthSession {
  token: string
  user: AuthUser
  orgId: string | null
  expiresAt: string
}

// Columns that make up an AuthUser (never selects password_hash).
const authUserSelect = {
  id: users.id,
  email: users.email,
  name: users.name,
  status: users.status,
  is_platform_admin: users.is_platform_admin,
}

class AuthLocalService {
  /**
   * Register a new user. Creates a personal org for them.
   */
  async register(email: string, password: string, name: string): Promise<AuthSession | null> {
    const db = getDb()
    const normalized = email.toLowerCase().trim()
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1)
    if (existing.length > 0) return null

    const userId = generateId('usr')
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })

    await db.insert(users).values({ id: userId, email: normalized, name: name.trim(), password_hash: passwordHash })

    // Create personal org
    const org = await orgService.create(userId, `${name.trim()}'s Workspace`)

    // Create session
    const session = await this.createSession(userId, org.id)

    auditService.log({
      orgId: org.id,
      actorId: userId,
      actorEmail: email,
      action: 'user.register',
      entityType: 'user',
      entityId: userId,
    })

    return session
  }

  /**
   * Login with email/password
   */
  async login(email: string, password: string, ipAddress?: string, userAgent?: string): Promise<AuthSession | null> {
    const db = getDb()
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase().trim()), eq(users.status, 'active')))
      .limit(1)

    if (!user) return null

    const valid = await Bun.password.verify(password, user.password_hash)
    if (!valid) return null

    // Update last login
    await db.update(users).set({ last_login_at: new Date().toISOString() }).where(eq(users.id, user.id))

    // Get user's default org (first active org they're a member of)
    const orgs = await orgService.listForUser(user.id)
    const defaultOrgId = orgs.length > 0 ? orgs[0].id : null

    const session = await this.createSession(user.id, defaultOrgId, ipAddress, userAgent)

    auditService.log({
      orgId: defaultOrgId || undefined,
      actorId: user.id,
      actorEmail: user.email,
      action: 'user.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      userAgent,
    })

    return session
  }

  /**
   * Logout - delete session
   */
  async logout(token: string): Promise<boolean> {
    const db = getDb()
    const [session] = await db.select({ user_id: sessions.user_id, org_id: sessions.org_id }).from(sessions).where(eq(sessions.token, token)).limit(1)

    await db.delete(sessions).where(eq(sessions.token, token))

    if (session) {
      auditService.log({
        orgId: session.org_id || undefined,
        actorId: session.user_id,
        action: 'user.logout',
        entityType: 'session',
      })
    }

    return true
  }

  /**
   * Validate session token. Returns user + org context.
   */
  async validateSession(token: string): Promise<{ user: AuthUser; orgId: string | null } | null> {
    const [row] = await getDb()
      .select({
        user_id: sessions.user_id,
        org_id: sessions.org_id,
        email: users.email,
        name: users.name,
        status: users.status,
        is_platform_admin: users.is_platform_admin,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.user_id, users.id))
      .where(and(eq(sessions.token, token), gt(sessions.expires_at, new Date().toISOString()), eq(users.status, 'active')))
      .limit(1)

    if (!row) return null

    return {
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        status: row.status,
        is_platform_admin: row.is_platform_admin,
      },
      orgId: row.org_id,
    }
  }

  /**
   * Switch active org for a session
   */
  async switchOrg(token: string, orgId: string): Promise<boolean> {
    const res = await getDb().update(sessions).set({ org_id: orgId }).where(eq(sessions.token, token)).returning({ id: sessions.id })
    return res.length > 0
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<AuthUser | null> {
    const [user] = await getDb().select(authUserSelect).from(users).where(eq(users.id, userId)).limit(1)
    return user ?? null
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<AuthUser | null> {
    const [user] = await getDb().select(authUserSelect).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1)
    return user ?? null
  }

  /**
   * Create a platform super admin
   */
  async createPlatformAdmin(email: string, password: string, name: string): Promise<AuthUser | null> {
    const session = await this.register(email, password, name)
    if (!session) return null

    await getDb().update(users).set({ is_platform_admin: 1 }).where(eq(users.id, session.user.id))
    return { ...session.user, is_platform_admin: 1 }
  }

  /**
   * Promote existing user to platform admin
   */
  async promoteToPlatformAdmin(userId: string): Promise<boolean> {
    const res = await getDb().update(users).set({ is_platform_admin: 1 }).where(eq(users.id, userId)).returning({ id: users.id })
    return res.length > 0
  }

  /**
   * Create a password reset token (valid for 1 hour)
   */
  async createPasswordResetToken(email: string): Promise<{ token: string; userId: string } | null> {
    const db = getDb()
    const user = await this.getUserByEmail(email)
    if (!user) return null

    // Invalidate previous tokens
    await db.delete(password_reset_tokens).where(and(eq(password_reset_tokens.user_id, user.id), isNull(password_reset_tokens.used_at)))

    const token = this.generateToken()
    const id = generateId('prt')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

    await db.insert(password_reset_tokens).values({ id, user_id: user.id, token, expires_at: expiresAt })

    return { token, userId: user.id }
  }

  /**
   * Validate a password reset token
   */
  async validateResetToken(token: string): Promise<{ userId: string } | null> {
    const [row] = await getDb()
      .select({ user_id: password_reset_tokens.user_id })
      .from(password_reset_tokens)
      .where(and(
        eq(password_reset_tokens.token, token),
        gt(password_reset_tokens.expires_at, new Date().toISOString()),
        isNull(password_reset_tokens.used_at),
      ))
      .limit(1)

    return row ? { userId: row.user_id } : null
  }

  /**
   * Reset password using a valid token
   */
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const db = getDb()
    const valid = await this.validateResetToken(token)
    if (!valid) return false

    const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'argon2id' })
    await db.update(users).set({ password_hash: passwordHash }).where(eq(users.id, valid.userId))
    await db.update(password_reset_tokens).set({ used_at: new Date().toISOString() }).where(eq(password_reset_tokens.token, token))

    // Invalidate all sessions for security
    await db.delete(sessions).where(eq(sessions.user_id, valid.userId))

    auditService.log({
      actorId: valid.userId,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: valid.userId,
    })

    return true
  }

  /**
   * Update user's password (when they know their current one)
   */
  async updatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const db = getDb()
    const [row] = await db.select({ password_hash: users.password_hash }).from(users).where(eq(users.id, userId)).limit(1)
    if (!row) return false

    const valid = await Bun.password.verify(currentPassword, row.password_hash)
    if (!valid) return false

    const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'argon2id' })
    await db.update(users).set({ password_hash: passwordHash }).where(eq(users.id, userId))

    auditService.log({
      actorId: userId,
      action: 'user.password_change',
      entityType: 'user',
      entityId: userId,
    })

    return true
  }

  /**
   * Update user's profile
   */
  async updateProfile(userId: string, data: { name?: string; email?: string }): Promise<AuthUser | null> {
    const db = getDb()
    const user = await this.getUser(userId)
    if (!user) return null

    if (data.email && data.email !== user.email) {
      const existing = await this.getUserByEmail(data.email)
      if (existing) return null // email taken
      await db.update(users).set({ email: data.email.toLowerCase().trim() }).where(eq(users.id, userId))
    }

    if (data.name) {
      await db.update(users).set({ name: data.name.trim() }).where(eq(users.id, userId))
    }

    return this.getUser(userId)
  }

  /**
   * Clean up expired sessions
   */
  async cleanupSessions(): Promise<number> {
    const res = await getDb().delete(sessions).where(lt(sessions.expires_at, new Date().toISOString())).returning({ id: sessions.id })
    return res.length
  }

  /**
   * List all regular users. Platform admin is a separate identity —
   * never included in user lists, member lists, or any user-facing query.
   * Only the platform admin's own session knows they're platform admin.
   */
  async listAllUsers(page = 1, limit = 50): Promise<{ users: AuthUser[]; total: number }> {
    const db = getDb()
    const offset = (page - 1) * limit
    const [totalRow] = await db.select({ value: count() }).from(users).where(eq(users.is_platform_admin, 0))
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
        is_platform_admin: users.is_platform_admin,
        last_login_at: users.last_login_at,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.is_platform_admin, 0))
      .orderBy(desc(users.created_at))
      .limit(limit)
      .offset(offset)
    return { users: rows as AuthUser[], total: totalRow?.value ?? 0 }
  }

  /**
   * Get a user by email — excludes platform admin from lookups.
   * Platform admin can only be found by their own session, never by other users.
   */
  async getUserByEmailPublic(email: string): Promise<AuthUser | null> {
    const [user] = await getDb()
      .select(authUserSelect)
      .from(users)
      .where(and(eq(users.email, email.toLowerCase().trim()), eq(users.is_platform_admin, 0)))
      .limit(1)
    return user ?? null
  }

  // ------- Private -------

  private async createSession(userId: string, orgId: string | null, ipAddress?: string, userAgent?: string): Promise<AuthSession> {
    const token = this.generateToken()
    const sessionId = generateId('ses')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    await getDb().insert(sessions).values({
      id: sessionId,
      user_id: userId,
      token,
      org_id: orgId,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      expires_at: expiresAt,
    })

    const user = (await this.getUser(userId))!
    return { token, user, orgId, expiresAt }
  }

  // --------------------------------------------------------------------------
  // Username
  // --------------------------------------------------------------------------

  async checkUsername(username: string, excludeUserId?: string): Promise<{ available: boolean; suggestions: string[] }> {
    const normalized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 30)
    if (!normalized || normalized.length < 3) return { available: false, suggestions: [] }

    if (!(await this.usernameTaken(normalized, excludeUserId))) return { available: true, suggestions: [] }

    const suggestions: string[] = []
    for (let i = 1; i <= 5; i++) {
      const candidate = `${normalized}${i}`
      if (!(await this.usernameTaken(candidate))) {
        suggestions.push(candidate)
        if (suggestions.length >= 3) break
      }
    }
    return { available: false, suggestions }
  }

  async setUsername(userId: string, username: string): Promise<boolean> {
    const normalized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 30)
    if (!normalized || normalized.length < 3) throw new Error('Username must be at least 3 characters (letters, numbers, - _)')

    if (await this.usernameTaken(normalized, userId)) throw new Error(`Username "${normalized}" is already taken`)

    const res = await getDb().update(users).set({ username: normalized, updated_at: new Date().toISOString() }).where(eq(users.id, userId)).returning({ id: users.id })
    return res.length > 0
  }

  async getUsername(userId: string): Promise<string | null> {
    const [row] = await getDb().select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1)
    return row?.username || null
  }

  async suggestUsername(email: string): Promise<string> {
    const prefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20)
    if (prefix.length >= 3 && !(await this.usernameTaken(prefix))) {
      return prefix
    }
    for (let i = 1; i <= 99; i++) {
      const candidate = `${prefix}${i}`
      if (!(await this.usernameTaken(candidate))) return candidate
    }
    return `${prefix}${Date.now() % 10000}`
  }

  private async usernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
    const where = excludeUserId
      ? and(eq(users.username, username), ne(users.id, excludeUserId))
      : eq(users.username, username)
    const rows = await getDb().select({ id: users.id }).from(users).where(where).limit(1)
    return rows.length > 0
  }

  private generateToken(): string {
    const bytes = new Uint8Array(48)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

export const authLocalService = new AuthLocalService()
