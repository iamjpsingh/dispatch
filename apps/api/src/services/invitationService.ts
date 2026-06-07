import { and, eq, gt, lt, desc } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { invitations, organizations, users } from '../db/pg/schema'
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

// i.* + joined org name + inviter name/email
const invitationSelect = {
  id: invitations.id,
  org_id: invitations.org_id,
  email: invitations.email,
  role: invitations.role,
  token: invitations.token,
  invited_by: invitations.invited_by,
  status: invitations.status,
  expires_at: invitations.expires_at,
  accepted_at: invitations.accepted_at,
  created_at: invitations.created_at,
  org_name: organizations.name,
  inviter_name: users.name,
  inviter_email: users.email,
}

class InvitationService {
  /**
   * Create and send an invitation
   */
  async create(orgId: string, email: string, role: string, invitedBy: string): Promise<Invitation> {
    const db = getDb()
    const normalizedEmail = email.toLowerCase().trim()

    // Check if user is already a member
    const existingUser = await authLocalService.getUserByEmail(normalizedEmail)
    if (existingUser) {
      const member = await orgService.getMember(orgId, existingUser.id)
      if (member && member.status === 'active') {
        throw new Error('User is already a member of this organization')
      }
    }

    // Check for existing pending invitation
    const existing = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(
        eq(invitations.org_id, orgId),
        eq(invitations.email, normalizedEmail),
        eq(invitations.status, 'pending'),
        gt(invitations.expires_at, new Date().toISOString()),
      ))
      .limit(1)
    if (existing.length > 0) {
      throw new Error('An invitation has already been sent to this email')
    }

    const id = generateId('inv')
    const token = this.generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    await db.insert(invitations).values({ id, org_id: orgId, email: normalizedEmail, role, token, invited_by: invitedBy, expires_at: expiresAt })

    auditService.log({
      orgId,
      actorId: invitedBy,
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: id,
      metadata: { email: normalizedEmail, role },
    })

    // Send invitation email
    const invitation = (await this.getById(id))!
    if (await systemMailerService.isConfigured()) {
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
  async getById(id: string): Promise<Invitation | null> {
    const [row] = await getDb()
      .select(invitationSelect)
      .from(invitations)
      .innerJoin(organizations, eq(invitations.org_id, organizations.id))
      .innerJoin(users, eq(invitations.invited_by, users.id))
      .where(eq(invitations.id, id))
      .limit(1)
    return (row as Invitation) ?? null
  }

  /**
   * Get invitation by token
   */
  async getByToken(token: string): Promise<Invitation | null> {
    const [row] = await getDb()
      .select(invitationSelect)
      .from(invitations)
      .innerJoin(organizations, eq(invitations.org_id, organizations.id))
      .innerJoin(users, eq(invitations.invited_by, users.id))
      .where(and(eq(invitations.token, token), eq(invitations.status, 'pending'), gt(invitations.expires_at, new Date().toISOString())))
      .limit(1)
    return (row as Invitation) ?? null
  }

  /**
   * Accept an invitation. If user doesn't exist, they must register first.
   * Returns the orgId they were added to.
   */
  async accept(token: string, userId: string): Promise<{ orgId: string; role: string } | null> {
    const invitation = await this.getByToken(token)
    if (!invitation) return null

    // Verify the accepting user's email matches
    const user = await authLocalService.getUser(userId)
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return null
    }

    // Add user to org
    await orgService.addMember(invitation.org_id, userId, invitation.role, invitation.invited_by)

    // Mark invitation as accepted
    await getDb().update(invitations).set({ status: 'accepted', accepted_at: new Date().toISOString() }).where(eq(invitations.id, invitation.id))

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
  async cancel(invitationId: string, actorId: string): Promise<boolean> {
    const invitation = await this.getById(invitationId)
    if (!invitation || invitation.status !== 'pending') return false

    const res = await getDb().update(invitations).set({ status: 'cancelled' }).where(eq(invitations.id, invitationId)).returning({ id: invitations.id })

    if (res.length > 0) {
      auditService.log({
        orgId: invitation.org_id,
        actorId,
        action: 'invitation.cancelled',
        entityType: 'invitation',
        entityId: invitationId,
      })
    }

    return res.length > 0
  }

  /**
   * Resend an invitation (resets expiry)
   */
  async resend(invitationId: string, actorId: string): Promise<Invitation | null> {
    const invitation = await this.getById(invitationId)
    if (!invitation || invitation.status !== 'pending') return null

    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await getDb().update(invitations).set({ expires_at: newExpiry }).where(eq(invitations.id, invitationId))

    // Resend invitation email
    if (await systemMailerService.isConfigured()) {
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
  async listForOrg(orgId: string): Promise<Invitation[]> {
    const rows = await getDb()
      .select(invitationSelect)
      .from(invitations)
      .innerJoin(organizations, eq(invitations.org_id, organizations.id))
      .innerJoin(users, eq(invitations.invited_by, users.id))
      .where(and(eq(invitations.org_id, orgId), eq(invitations.status, 'pending')))
      .orderBy(desc(invitations.created_at))
    return rows as Invitation[]
  }

  /**
   * List pending invitations for an email (for users to see what orgs they've been invited to)
   */
  async listForEmail(email: string): Promise<Invitation[]> {
    const rows = await getDb()
      .select(invitationSelect)
      .from(invitations)
      .innerJoin(organizations, eq(invitations.org_id, organizations.id))
      .innerJoin(users, eq(invitations.invited_by, users.id))
      .where(and(eq(invitations.email, email.toLowerCase().trim()), eq(invitations.status, 'pending'), gt(invitations.expires_at, new Date().toISOString())))
      .orderBy(desc(invitations.created_at))
    return rows as Invitation[]
  }

  /**
   * Clean up expired invitations
   */
  async cleanupExpired(): Promise<number> {
    const res = await getDb()
      .update(invitations)
      .set({ status: 'expired' })
      .where(and(eq(invitations.status, 'pending'), lt(invitations.expires_at, new Date().toISOString())))
      .returning({ id: invitations.id })
    return res.length
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

export const invitationService = new InvitationService()
