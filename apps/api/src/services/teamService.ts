import { db } from '../db/connection'
import { auditService } from './auditService'
import { generateId } from '../utils/id'

export interface Team {
  id: string
  org_id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  member_count?: number
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: string
  added_at: string
  // Joined
  email?: string
  name?: string
}

class TeamService {
  create(orgId: string, name: string, createdBy: string, description?: string): Team {
    const id = generateId('team')

    db.prepare(`
      INSERT INTO teams (id, org_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)
    `).run(id, orgId, name, description || null, createdBy)

    // Creator becomes team lead
    const tmId = generateId('tm')
    db.prepare(`
      INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, 'lead')
    `).run(tmId, id, createdBy)

    auditService.logActivity({
      orgId,
      actorId: createdBy,
      action: 'team.created',
      entityType: 'team',
      entityId: id,
      description: `Created team "${name}"`,
    })

    return this.get(orgId, id)!
  }

  get(orgId: string, teamId: string): Team | null {
    const team = db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t WHERE t.id = ? AND t.org_id = ?
    `).get(teamId, orgId) as Team | null
    return team
  }

  list(orgId: string): Team[] {
    return db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t WHERE t.org_id = ? ORDER BY t.name
    `).all(orgId) as Team[]
  }

  update(orgId: string, teamId: string, updates: { name?: string; description?: string }, actorId: string): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(teamId, orgId)

    const result = db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).run(...params)
    return result.changes > 0
  }

  delete(orgId: string, teamId: string, actorId: string): boolean {
    const team = this.get(orgId, teamId)
    if (!team) return false

    const result = db.prepare('DELETE FROM teams WHERE id = ? AND org_id = ?').run(teamId, orgId)

    if (result.changes > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'team.deleted',
        entityType: 'team',
        entityId: teamId,
        metadata: { name: team.name },
      })
    }

    return result.changes > 0
  }

  // ------- Members -------

  getMembers(teamId: string): TeamMember[] {
    return db.prepare(`
      SELECT tm.*, u.email, u.name FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
      ORDER BY tm.role DESC, u.name
    `).all(teamId) as TeamMember[]
  }

  addMember(orgId: string, teamId: string, userId: string, role: string, actorId: string): boolean {
    const id = generateId('tm')
    try {
      db.prepare(`
        INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)
      `).run(id, teamId, userId, role || 'member')

      auditService.logActivity({
        orgId,
        actorId,
        action: 'team.created',
        entityType: 'team_member',
        entityId: id,
        description: `Added user to team`,
        metadata: { teamId, userId, role },
      })

      return true
    } catch {
      return false // Duplicate
    }
  }

  removeMember(orgId: string, teamId: string, userId: string, actorId: string): boolean {
    const result = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId)
    return result.changes > 0
  }

  /**
   * Get all teams a user belongs to in an org
   */
  getUserTeams(orgId: string, userId: string): Team[] {
    return db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.org_id = ? AND tm.user_id = ?
      ORDER BY t.name
    `).all(orgId, userId) as Team[]
  }
}

export const teamService = new TeamService()
