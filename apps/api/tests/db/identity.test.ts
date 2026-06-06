import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDbMigrated } from '../helpers/pg'
import { organizations, users, sessions, org_members } from '../../src/db/pg/schema'

const future = () => new Date(Date.now() + 3_600_000).toISOString()

describe('P2.1 — identity schema (migration applied on PGlite)', () => {
  it('round-trips org + user + member + session with correct defaults', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', password_hash: 'x' })
    await db.insert(org_members).values({ id: 'om_1', org_id: 'org_1', user_id: 'usr_1', role: 'owner' })
    await db.insert(sessions).values({ id: 'ses_1', user_id: 'usr_1', token: 'tok', org_id: 'org_1', expires_at: future() })

    const u = await db.select().from(users).where(eq(users.email, 'a@b.com'))
    expect(u[0].name).toBe('A')
    expect(u[0].is_platform_admin).toBe(0) // integer-boolean default (contract-preserving)
    expect(u[0].status).toBe('active')

    const m = await db.select().from(org_members).where(eq(org_members.org_id, 'org_1'))
    expect(m[0].role).toBe('owner')
  }, 30_000)

  it('cascades sessions when the user is deleted (FK ON DELETE CASCADE)', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', password_hash: 'x' })
    await db.insert(sessions).values({ id: 'ses_1', user_id: 'usr_1', token: 'tok', expires_at: future() })

    await db.delete(users).where(eq(users.id, 'usr_1'))
    const s = await db.select().from(sessions)
    expect(s.length).toBe(0)
  }, 30_000)

  it('enforces unique org membership (org_id, user_id)', async () => {
    const db = await freshDbMigrated()
    await db.insert(organizations).values({ id: 'org_1', name: 'Acme', slug: 'acme' })
    await db.insert(users).values({ id: 'usr_1', email: 'a@b.com', name: 'A', password_hash: 'x' })
    await db.insert(org_members).values({ id: 'om_1', org_id: 'org_1', user_id: 'usr_1', role: 'member' })

    await expect(
      db.insert(org_members).values({ id: 'om_2', org_id: 'org_1', user_id: 'usr_1', role: 'admin' })
    ).rejects.toThrow()
  }, 30_000)
})
