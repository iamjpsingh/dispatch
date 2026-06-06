import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { PGlite } from '@electric-sql/pglite'
import * as schema from '../../src/db/pg/schema'

/**
 * Fresh in-memory Postgres (PGlite) + Drizzle, isolated per call.
 * Used by service tests so the data layer runs on real Postgres semantics
 * without Docker. Apply generated migrations to the returned db once P2.1
 * introduces tables (drizzle-orm/pglite/migrator).
 */
export function freshDb() {
  return drizzle({ client: new PGlite(), schema })
}

export type TestDb = ReturnType<typeof freshDb>

/** Fresh PGlite with all generated migrations applied — for schema/service tests. */
export async function freshDbMigrated(): Promise<TestDb> {
  const db = freshDb()
  await migrate(db, { migrationsFolder: './src/db/pg/migrations' })
  return db
}
