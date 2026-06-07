// P2 net — teamService on real (PGlite) Postgres. Team CRUD, org_id scoping,
// UNIQUE(team_id,user_id) membership semantics, member_count, joined member
// listing/order, getUserTeams, and a Postgres landing cross-check.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
// auditService writes to the bun:sqlite logs db (side-effect); stub it out so the
// net exercises only the Postgres data layer.
vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn(), logActivity: vi.fn() } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, teams, team_members } from '../../src/db/pg/schema'
import { teamService } from '../../src/services/teamService'

const ORG = 'org_t'
const ORG2 = 'org_t2'
const USER = 'usr_t'
const USER2 = 'usr_t2'
const ACTOR = 'usr_actor'

describe('P2 — teamService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org T', slug: 'org-t' },
      { id: ORG2, name: 'Org T2', slug: 'org-t2' },
    ])
    await db.insert(users).values([
      { id: USER, email: 'alice@test.com', name: 'Alice', password_hash: 'x' },
      { id: USER2, email: 'bob@test.com', name: 'Bob', password_hash: 'x' },
      { id: ACTOR, email: 'actor@test.com', name: 'Zoe', password_hash: 'x' },
    ])
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates a team, makes creator the lead, and reads it back with member_count', async () => {
    const team = await teamService.create(ORG, 'Eng', USER, 'Engineering')
    expect(team.name).toBe('Eng')
    expect(team.org_id).toBe(ORG)
    expect(team.description).toBe('Engineering')
    expect(team.created_by).toBe(USER)
    expect(team.member_count).toBe(1) // creator auto-added as lead

    const got = await teamService.get(ORG, team.id)
    expect(got?.id).toBe(team.id)
    expect(got?.member_count).toBe(1)

    const members = await teamService.getMembers(team.id)
    expect(members).toHaveLength(1)
    expect(members[0].user_id).toBe(USER)
    expect(members[0].role).toBe('lead')
    expect(members[0].email).toBe('alice@test.com') // joined from users
    expect(members[0].name).toBe('Alice')
  })

  it('scopes get/update/delete by org_id', async () => {
    const team = await teamService.create(ORG, 'Sales', USER)

    // wrong org cannot read
    expect(await teamService.get(ORG2, team.id)).toBeNull()
    // wrong org cannot mutate
    expect(await teamService.update(ORG2, team.id, { name: 'X' }, ACTOR)).toBe(false)
    expect(await teamService.delete(ORG2, team.id, ACTOR)).toBe(false)

    // right org can
    expect(await teamService.update(ORG, team.id, { name: 'Sales EU', description: 'd' }, ACTOR)).toBe(true)
    expect((await teamService.get(ORG, team.id))?.name).toBe('Sales EU')
    expect((await teamService.get(ORG, team.id))?.description).toBe('d')

    expect(await teamService.delete(ORG, team.id, ACTOR)).toBe(true)
    expect(await teamService.get(ORG, team.id)).toBeNull()
  })

  it('update with no fields is a no-op returning false', async () => {
    const team = await teamService.create(ORG, 'NoOp', USER)
    expect(await teamService.update(ORG, team.id, {}, ACTOR)).toBe(false)
  })

  it('lists teams for the org only, ordered by name', async () => {
    await teamService.create(ORG, 'Zeta', USER)
    await teamService.create(ORG, 'Alpha', USER)
    await teamService.create(ORG2, 'Other', USER)

    const list = await teamService.list(ORG)
    expect(list).toHaveLength(2)
    expect(list.map((t) => t.name)).toEqual(['Alpha', 'Zeta']) // ORDER BY name
    expect(list.every((t) => t.member_count === 1)).toBe(true)
  })

  it('enforces UNIQUE(team_id,user_id): duplicate addMember returns false', async () => {
    const team = await teamService.create(ORG, 'Eng', USER)

    // creator (USER) is already a lead member -> re-adding is a duplicate
    expect(await teamService.addMember(ORG, team.id, USER, 'member', ACTOR)).toBe(false)
    expect((await teamService.get(ORG, team.id))?.member_count).toBe(1)

    // a new user can be added once
    expect(await teamService.addMember(ORG, team.id, USER2, 'member', ACTOR)).toBe(true)
    expect((await teamService.get(ORG, team.id))?.member_count).toBe(2)

    // ...but not twice
    expect(await teamService.addMember(ORG, team.id, USER2, 'member', ACTOR)).toBe(false)
    expect((await teamService.get(ORG, team.id))?.member_count).toBe(2)
  })

  it('orders members by role DESC then name, and removes members', async () => {
    const team = await teamService.create(ORG, 'Eng', USER) // USER=Alice is lead
    await teamService.addMember(ORG, team.id, USER2, 'member', ACTOR) // Bob member
    await teamService.addMember(ORG, team.id, ACTOR, 'member', ACTOR) // Zoe member

    const members = await teamService.getMembers(team.id)
    // role DESC -> 'member','member','lead' is reverse-alpha so 'member' rows precede 'lead';
    // within equal roles, ORDER BY name ASC.
    expect(members.map((m) => m.role)).toEqual(['member', 'member', 'lead'])
    expect(members.map((m) => m.name)).toEqual(['Bob', 'Zoe', 'Alice'])

    expect(await teamService.removeMember(ORG, team.id, USER2, ACTOR)).toBe(true)
    expect((await teamService.get(ORG, team.id))?.member_count).toBe(2)
    // removing a non-member is a no-op
    expect(await teamService.removeMember(ORG, team.id, 'ghost', ACTOR)).toBe(false)
  })

  it('getUserTeams returns only the org teams the user belongs to', async () => {
    const a = await teamService.create(ORG, 'Alpha', USER) // USER is lead
    const b = await teamService.create(ORG, 'Beta', ACTOR) // USER not a member
    await teamService.addMember(ORG, b.id, USER, 'member', ACTOR) // now USER is in Beta too
    const c = await teamService.create(ORG, 'Gamma', ACTOR) // USER not a member
    await teamService.create(ORG2, 'Cross', USER) // other org, should be excluded

    const mine = await teamService.getUserTeams(ORG, USER)
    expect(mine.map((t) => t.name)).toEqual(['Alpha', 'Beta']) // ORDER BY name, only ORG, only USER
    expect(mine.map((t) => t.id).sort()).toEqual([a.id, b.id].sort())
    expect(mine.some((t) => t.id === c.id)).toBe(false)
  })

  it('cascades team_members when a team is deleted (FK ON DELETE CASCADE)', async () => {
    const team = await teamService.create(ORG, 'Eng', USER)
    await teamService.addMember(ORG, team.id, USER2, 'member', ACTOR)
    await teamService.delete(ORG, team.id, ACTOR)

    const remaining = await db.select().from(team_members).where(eq(team_members.team_id, team.id))
    expect(remaining).toHaveLength(0)
  })

  it('Postgres landing cross-check: rows persist with expected shape/types', async () => {
    const team = await teamService.create(ORG, 'Landing', USER, 'desc')

    const [tRow] = await db.select().from(teams).where(eq(teams.id, team.id))
    expect(tRow.org_id).toBe(ORG)
    expect(tRow.name).toBe('Landing')
    expect(tRow.description).toBe('desc')
    expect(tRow.created_by).toBe(USER)
    expect(typeof tRow.created_at).toBe('string') // ISO timestamp (mode:'string')
    expect(typeof tRow.updated_at).toBe('string')

    const [mRow] = await db.select().from(team_members).where(eq(team_members.team_id, team.id))
    expect(mRow.team_id).toBe(team.id)
    expect(mRow.user_id).toBe(USER)
    expect(mRow.role).toBe('lead')
    expect(typeof mRow.added_at).toBe('string')
  })
})
