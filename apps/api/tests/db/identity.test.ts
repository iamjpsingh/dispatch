import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDbMigrated } from '../helpers/pg'
import { organizations, users, sessions, orgMembers } from '../../src/db/pg/schema'

const future = () => new Date(Date.now() + 3_600_000).toISOString()

describe('P2.1 — identity schema (migration applied on PGlite)', () => {
  it('round-trips org + user + member + session with correct defaults', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', passwordHash: 'x' })
    await db.insert(orgMembers).values({ id: 'om_1', orgId: 'org_1', userId: 'usr_1', role: 'owner' })
    await db.insert(sessions).values({ id: 'ses_1', userId: 'usr_1', token: 'tok', orgId: 'org_1', expiresAt: future() })

    const u = await db.select().from(users).where(eq(users.email, 'a@b.com'))
    expect(u[0].name).toBe('A')
    expect(u[0].isPlatformAdmin).toBe(false) // boolean default
    expect(u[0].status).toBe('active') // text default

    const m = await db.select().from(orgMembers).where(eq(orgMembers.orgId, 'org_1'))
    expect(m[0].role).toBe('owner')
  }, 30_000)

  it('cascades sessions when the user is deleted (FK ON DELETE CASCADE)', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', passwordHash: 'x' })
    await db.insert(sessions).values({ id: 'ses_1', userId: 'usr_1', token: 'tok', expiresAt: future() })

    await db.delete(users).where(eq(users.id, 'usr_1'))
    const s = await db.select().from(sessions)
    expect(s.length).toBe(0)
  }, 30_000)

  it('enforces unique org membership (org_id, user_id)', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', passwordHash: 'x' })
    await db.insert(orgMembers).values({ id: 'om_1', orgId: 'org_1', userId: 'usr_1', role: 'member' })

    await expect(
      db.insert(orgMembers).values({ id: 'om_2', orgId: 'org_1', userId: 'usr_1', role: 'admin' })
    ).rejects.toThrow()
  }, 30_000)
})
