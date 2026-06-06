import { db } from '../db/connection'
import { auditService } from './auditService'
import { orgService } from './orgService'
import { authLocalService } from './authLocalService'
import { systemMailerService } from './systemMailerService'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'

export interface Invitation {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  invited_by: string
  status: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  // Joined fields
  org_name?: string
  inviter_name?: string
  inviter_email?: string
}

class InvitationService {
  /**
   * Create and send an invitation
   */
  create(orgId: string, email: string, role: string, invitedBy: string): Invitation {
    const normalizedEmail = email.toLowerCase().trim()

    // Check if user is already a member
    const existingUser = authLocalService.getUserByEmail(normalizedEmail)
    if (existingUser) {
      const member = orgService.getMember(orgId, existingUser.id)
      if (member && member.status === 'active') {
        throw new Error('User is already a member of this organization')
      }
    }

    // Check for existing pending invitation
    const existing = db.prepare(`
      SELECT id FROM invitations WHERE org_id = ? AND email = ? AND status = 'pending' AND expires_at > datetime('now')
    `).get(orgId, normalizedEmail)
    if (existing) {
      throw new Error('An invitation has already been sent to this email')
    }

    const id = generateId('inv')
    const token = this.generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    db.prepare(`
      INSERT INTO invitations (id, org_id, email, role, token, invited_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, normalizedEmail, role, token, invitedBy, expiresAt)

    auditService.log({
      orgId,
      actorId: invitedBy,
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: id,
      metadata: { email: normalizedEmail, role },
    })

    // Send invitation email
    const invitation = this.getById(id)!
    if (systemMailerService.isConfigured()) {
      systemMailerService.sendInvitation(
        normalizedEmail,
        invitation.org_name || 'the organization',
        invitation.inviter_name || 'Someone',
        role,
        token,
      ).catch(err => logger.error(`Failed to send invitation email to ${normalizedEmail}: ${err.message}`))
    } else {
      logger.warn(`Invitation created for ${normalizedEmail} but system mailer is not configured`)
    }

    return invitation
  }

  /**
   * Get invitation by ID
   */
  getById(id: string): Invitation | null {
    return db.prepare(`
      SELECT i.*, o.name as org_name, u.name as inviter_name, u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.org_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.id = ?
    `).get(id) as Invitation | null
  }

  /**
   * Get invitation by token
   */
  getByToken(token: string): Invitation | null {
    return db.prepare(`
      SELECT i.*, o.name as org_name, u.name as inviter_name, u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.org_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
    `).get(token) as Invitation | null
  }

  /**
   * Accept an invitation. If user doesn't exist, they must register first.
   * Returns the orgId they were added to.
   */
  accept(token: string, userId: string): { orgId: string; role: string } | null {
    const invitation = this.getByToken(token)
    if (!invitation) return null

    // Verify the accepting user's email matches
    const user = authLocalService.getUser(userId)
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return null
    }

    // Add user to org
    orgService.addMember(invitation.org_id, userId, invitation.role, invitation.invited_by)

    // Mark invitation as accepted
    db.prepare(`
      UPDATE invitations SET status = 'accepted', accepted_at = datetime('now')
      WHERE id = ?
    `).run(invitation.id)

    auditService.log({
      orgId: invitation.org_id,
      actorId: userId,
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
    })

    return { orgId: invitation.org_id, role: invitation.role }
  }

  /**
   * Cancel an invitation
   */
  cancel(invitationId: string, actorId: string): boolean {
    const invitation = this.getById(invitationId)
    if (!invitation || invitation.status !== 'pending') return false

    const result = db.prepare("UPDATE invitations SET status = 'cancelled' WHERE id = ?").run(invitationId)

    if (result.changes > 0) {
      auditService.log({
        orgId: invitation.org_id,
        actorId,
        action: 'invitation.cancelled',
        entityType: 'invitation',
        entityId: invitationId,
      })
    }

    return result.changes > 0
  }

  /**
   * Resend an invitation (resets expiry)
   */
  resend(invitationId: string, actorId: string): Invitation | null {
    const invitation = this.getById(invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(newExpiry, invitationId)

    // Resend invitation email
    if (systemMailerService.isConfigured()) {
      systemMailerService.sendInvitation(
        invitation.email,
        invitation.org_name || 'the organization',
        invitation.inviter_name || 'Someone',
        invitation.role,
        invitation.token,
      ).catch(err => logger.error(`Failed to resend invitation email to ${invitation.email}: ${err.message}`))
    }

    return this.getById(invitationId)
  }

  /**
   * List pending invitations for an org
   */
  listForOrg(orgId: string): Invitation[] {
    return db.prepare(`
      SELECT i.*, o.name as org_name, u.name as inviter_name, u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.org_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.org_id = ? AND i.status = 'pending'
      ORDER BY i.created_at DESC
    `).all(orgId) as Invitation[]
  }

  /**
   * List pending invitations for an email (for users to see what orgs they've been invited to)
   */
  listForEmail(email: string): Invitation[] {
    return db.prepare(`
      SELECT i.*, o.name as org_name, u.name as inviter_name, u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.org_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
      ORDER BY i.created_at DESC
    `).all(email.toLowerCase().trim()) as Invitation[]
  }

  /**
   * Clean up expired invitations
   */
  cleanupExpired(): number {
    const result = db.prepare(`
      UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')
    `).run()
    return result.changes
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

export const invitationService = new InvitationService()
