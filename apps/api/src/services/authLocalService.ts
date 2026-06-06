import { db } from '../db/connection'
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

class AuthLocalService {
  /**
   * Register a new user. Creates a personal org for them.
   */
  async register(email: string, password: string, name: string): Promise<AuthSession | null> {
    const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase().trim())
    if (existing) return null

    const userId = generateId('usr')
    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })

    db.prepare(`
      INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)
    `).run(userId, email.toLowerCase().trim(), name.trim(), passwordHash)

    // Create personal org
    const org = orgService.create(userId, `${name.trim()}'s Workspace`)

    // Create session
    const session = this.createSession(userId, org.id)

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
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(
      email.toLowerCase().trim(), 'active'
    ) as (AuthUser & { password_hash: string }) | null

    if (!user) return null

    const valid = await Bun.password.verify(password, user.password_hash)
    if (!valid) return null

    // Update last login
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id)

    // Get user's default org (first active org they're a member of)
    const orgs = orgService.listForUser(user.id)
    const defaultOrgId = orgs.length > 0 ? orgs[0].id : null

    const session = this.createSession(user.id, defaultOrgId, ipAddress, userAgent)

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
  logout(token: string): boolean {
    const session = db.prepare('SELECT user_id, org_id FROM sessions WHERE token = ?').get(token) as { user_id: string; org_id: string | null } | null

    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)

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
   * Synchronous - bun:sqlite is sync.
   */
  validateSession(token: string): { user: AuthUser; orgId: string | null } | null {
    const row = db.prepare(`
      SELECT s.user_id, s.org_id, s.expires_at,
             u.id, u.email, u.name, u.status, u.is_platform_admin
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now') AND u.status = 'active'
    `).get(token) as any

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
  switchOrg(token: string, orgId: string): boolean {
    const result = db.prepare('UPDATE sessions SET org_id = ? WHERE token = ?').run(orgId, token)
    return result.changes > 0
  }

  /**
   * Get user by ID
   */
  getUser(userId: string): AuthUser | null {
    return db.prepare('SELECT id, email, name, status, is_platform_admin FROM users WHERE id = ?').get(userId) as AuthUser | null
  }

  /**
   * Get user by email
   */
  getUserByEmail(email: string): AuthUser | null {
    return db.prepare('SELECT id, email, name, status, is_platform_admin FROM users WHERE email = ?').get(email.toLowerCase().trim()) as AuthUser | null
  }

  /**
   * Create a platform super admin
   */
  async createPlatformAdmin(email: string, password: string, name: string): Promise<AuthUser | null> {
    const session = await this.register(email, password, name)
    if (!session) return null

    db.prepare('UPDATE users SET is_platform_admin = 1 WHERE id = ?').run(session.user.id)
    return { ...session.user, is_platform_admin: 1 }
  }

  /**
   * Promote existing user to platform admin
   */
  promoteToPlatformAdmin(userId: string): boolean {
    const result = db.prepare('UPDATE users SET is_platform_admin = 1 WHERE id = ?').run(userId)
    return result.changes > 0
  }

  /**
   * Create a password reset token (valid for 1 hour)
   */
  createPasswordResetToken(email: string): { token: string; userId: string } | null {
    const user = this.getUserByEmail(email)
    if (!user) return null

    // Invalidate previous tokens
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id)

    const token = this.generateToken()
    const id = generateId('prt')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(id, user.id, token, expiresAt)

    return { token, userId: user.id }
  }

  /**
   * Validate a password reset token
   */
  validateResetToken(token: string): { userId: string } | null {
    const row = db.prepare(`
      SELECT user_id FROM password_reset_tokens
      WHERE token = ? AND expires_at > datetime('now') AND used_at IS NULL
    `).get(token) as { user_id: string } | null

    return row ? { userId: row.user_id } : null
  }

  /**
   * Reset password using a valid token
   */
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const valid = this.validateResetToken(token)
    if (!valid) return false

    const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'argon2id' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, valid.userId)
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?").run(token)

    // Invalidate all sessions for security
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(valid.userId)

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
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | null
    if (!row) return false

    const valid = await Bun.password.verify(currentPassword, row.password_hash)
    if (!valid) return false

    const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'argon2id' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)

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
  updateProfile(userId: string, data: { name?: string; email?: string }): AuthUser | null {
    const user = this.getUser(userId)
    if (!user) return null

    if (data.email && data.email !== user.email) {
      const existing = this.getUserByEmail(data.email)
      if (existing) return null // email taken
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(data.email.toLowerCase().trim(), userId)
    }

    if (data.name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(data.name.trim(), userId)
    }

    return this.getUser(userId)
  }

  /**
   * Clean up expired sessions
   */
  cleanupSessions(): number {
    const result = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()
    return result.changes
  }

  /**
   * List all users (platform admin only)
   */
  /**
   * List all regular users. Platform admin is a separate identity —
   * never included in user lists, member lists, or any user-facing query.
   * Only the platform admin's own session knows they're platform admin.
   */
  listAllUsers(page = 1, limit = 50): { users: AuthUser[]; total: number } {
    const offset = (page - 1) * limit
    const total = (db.prepare('SELECT COUNT(*) as count FROM users WHERE is_platform_admin = 0').get() as any).count
    const users = db.prepare(`
      SELECT id, email, name, status, is_platform_admin, last_login_at, created_at
      FROM users WHERE is_platform_admin = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as AuthUser[]
    return { users, total }
  }

  /**
   * Get a user by email — excludes platform admin from lookups.
   * Platform admin can only be found by their own session, never by other users.
   */
  getUserByEmailPublic(email: string): AuthUser | null {
    return db.prepare('SELECT id, email, name, status, is_platform_admin FROM users WHERE email = ? AND is_platform_admin = 0').get(email.toLowerCase().trim()) as AuthUser | null
  }

  // ------- Private -------

  private createSession(userId: string, orgId: string | null, ipAddress?: string, userAgent?: string): AuthSession {
    const token = this.generateToken()
    const sessionId = generateId('ses')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    db.prepare(`
      INSERT INTO sessions (id, user_id, token, org_id, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, token, orgId, ipAddress || null, userAgent || null, expiresAt)

    const user = this.getUser(userId)!
    return { token, user, orgId, expiresAt }
  }

  // --------------------------------------------------------------------------
  // Username
  // --------------------------------------------------------------------------

  checkUsername(username: string, excludeUserId?: string): { available: boolean; suggestions: string[] } {
    const normalized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 30)
    if (!normalized || normalized.length < 3) return { available: false, suggestions: [] }

    const query = excludeUserId
      ? db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(normalized, excludeUserId)
      : db.prepare('SELECT 1 FROM users WHERE username = ?').get(normalized)

    if (!query) return { available: true, suggestions: [] }

    const suggestions: string[] = []
    for (let i = 1; i <= 5; i++) {
      const candidate = `${normalized}${i}`
      if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
        suggestions.push(candidate)
        if (suggestions.length >= 3) break
      }
    }
    return { available: false, suggestions }
  }

  setUsername(userId: string, username: string): boolean {
    const normalized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 30)
    if (!normalized || normalized.length < 3) throw new Error('Username must be at least 3 characters (letters, numbers, - _)')

    const existing = db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(normalized, userId)
    if (existing) throw new Error(`Username "${normalized}" is already taken`)

    const result = db.prepare("UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?").run(normalized, userId)
    return result.changes > 0
  }

  getUsername(userId: string): string | null {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any
    return row?.username || null
  }

  suggestUsername(email: string): string {
    const prefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20)
    if (prefix.length >= 3 && !db.prepare('SELECT 1 FROM users WHERE username = ?').get(prefix)) {
      return prefix
    }
    for (let i = 1; i <= 99; i++) {
      const candidate = `${prefix}${i}`
      if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) return candidate
    }
    return `${prefix}${Date.now() % 10000}`
  }

  private generateToken(): string {
    const bytes = new Uint8Array(48)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

export const authLocalService = new AuthLocalService()
