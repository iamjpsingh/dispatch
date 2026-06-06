import { describe, it, expect } from 'vitest'
import { isNull } from 'drizzle-orm'
import { freshDbMigrated } from '../helpers/pg'
import { seedSystemRoles, SYSTEM_ROLES } from '../../src/db/pg/seed'
import { roles } from '../../src/db/pg/schema'

describe('P2.1 — system role seeding', () => {
  it('seeds all system roles idempotently (org_id null, is_system 1, JSON permissions)', async () => {
    const db = await freshDbMigrated()
    await seedSystemRoles(db)
    await seedSystemRoles(db) // re-seed must be a no-op (onConflictDoNothing)

    const sys = await db.select().from(roles).where(isNull(roles.org_id))
    expect(sys.length).toBe(SYSTEM_ROLES.length)

    const owner = sys.find((r) => r.name === 'org_owner')!
    expect(owner.is_system).toBe(1)
    expect(JSON.parse(owner.permissions)).toContain('org.manage')
  }, 30_000)
})
