// src/services/teamService.ts - Team Management (Postgres/Drizzle, async)

import { and, eq, asc, desc, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { teams, team_members, users } from '../db/pg/schema'
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

const now = () => new Date().toISOString()

// Correlated subquery: number of members for a team row. Mirrors the original
// `(SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count`.
// Columns are written table-qualified so the inner team_members.team_id correlates
// to the outer teams.id (Drizzle interpolates bare column names here, which would
// otherwise both bind to team_members inside the subquery).
const memberCount = sql<number>`(select count(*)::int from team_members where team_members.team_id = teams.id)`

class TeamService {
  async create(orgId: string, name: string, createdBy: string, description?: string): Promise<Team> {
    const db = getDb()
    const id = generateId('team')

    await db.insert(teams).values({
      id,
      org_id: orgId,
      name,
      description: description || null,
      created_by: createdBy,
    })

    // Creator becomes team lead
    await db.insert(team_members).values({
      id: generateId('tm'),
      team_id: id,
      user_id: createdBy,
      role: 'lead',
    })

    auditService.logActivity({
      orgId,
      actorId: createdBy,
      action: 'team.created',
      entityType: 'team',
      entityId: id,
      description: `Created team "${name}"`,
    })

    return (await this.get(orgId, id))!
  }

  async get(orgId: string, teamId: string): Promise<Team | null> {
    const [row] = await getDb()
      .select({
        id: teams.id,
        org_id: teams.org_id,
        name: teams.name,
        description: teams.description,
        created_by: teams.created_by,
        created_at: teams.created_at,
        updated_at: teams.updated_at,
        member_count: memberCount,
      })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.org_id, orgId)))
      .limit(1)
    return (row as Team) ?? null
  }

  async list(orgId: string): Promise<Team[]> {
    const rows = await getDb()
      .select({
        id: teams.id,
        org_id: teams.org_id,
        name: teams.name,
        description: teams.description,
        created_by: teams.created_by,
        created_at: teams.created_at,
        updated_at: teams.updated_at,
        member_count: memberCount,
      })
      .from(teams)
      .where(eq(teams.org_id, orgId))
      .orderBy(asc(teams.name))
    return rows as Team[]
  }

  async update(
    orgId: string,
    teamId: string,
    updates: { name?: string; description?: string },
    _actorId: string
  ): Promise<boolean> {
    const values: Partial<typeof teams.$inferInsert> = {}

    if (updates.name !== undefined) values.name = updates.name
    if (updates.description !== undefined) values.description = updates.description

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(teams)
      .set(values)
      .where(and(eq(teams.id, teamId), eq(teams.org_id, orgId)))
      .returning({ id: teams.id })
    return res.length > 0
  }

  async delete(orgId: string, teamId: string, actorId: string): Promise<boolean> {
    const team = await this.get(orgId, teamId)
    if (!team) return false

    const res = await getDb()
      .delete(teams)
      .where(and(eq(teams.id, teamId), eq(teams.org_id, orgId)))
      .returning({ id: teams.id })

    if (res.length > 0) {
      auditService.log({
        orgId,
        actorId,
        action: 'team.deleted',
        entityType: 'team',
        entityId: teamId,
        metadata: { name: team.name },
      })
    }

    return res.length > 0
  }

  // ------- Members -------

  async getMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await getDb()
      .select({
        id: team_members.id,
        team_id: team_members.team_id,
        user_id: team_members.user_id,
        role: team_members.role,
        added_at: team_members.added_at,
        email: users.email,
        name: users.name,
      })
      .from(team_members)
      .innerJoin(users, eq(team_members.user_id, users.id))
      .where(eq(team_members.team_id, teamId))
      .orderBy(desc(team_members.role), asc(users.name))
    return rows as TeamMember[]
  }

  async addMember(orgId: string, teamId: string, userId: string, role: string, actorId: string): Promise<boolean> {
    const id = generateId('tm')

    // UNIQUE(team_id, user_id): a duplicate membership is a no-op returning false.
    const res = await getDb()
      .insert(team_members)
      .values({ id, team_id: teamId, user_id: userId, role: role || 'member' })
      .onConflictDoNothing({ target: [team_members.team_id, team_members.user_id] })
      .returning({ id: team_members.id })

    if (res.length === 0) return false // Duplicate

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
  }

  async removeMember(orgId: string, teamId: string, userId: string, _actorId: string): Promise<boolean> {
    // Tenant-scope by the owning team: never delete a membership from another org's team.
    const [owned] = await getDb()
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.org_id, orgId)))
      .limit(1)
    if (!owned) return false
    const res = await getDb()
      .delete(team_members)
      .where(and(eq(team_members.team_id, teamId), eq(team_members.user_id, userId)))
      .returning({ id: team_members.id })
    return res.length > 0
  }

  /**
   * Get all teams a user belongs to in an org
   */
  async getUserTeams(orgId: string, userId: string): Promise<Team[]> {
    const rows = await getDb()
      .select({
        id: teams.id,
        org_id: teams.org_id,
        name: teams.name,
        description: teams.description,
        created_by: teams.created_by,
        created_at: teams.created_at,
        updated_at: teams.updated_at,
        member_count: memberCount,
      })
      .from(teams)
      .innerJoin(team_members, eq(teams.id, team_members.team_id))
      .where(and(eq(teams.org_id, orgId), eq(team_members.user_id, userId)))
      .orderBy(asc(teams.name))
    return rows as Team[]
  }
}

export const teamService = new TeamService()
