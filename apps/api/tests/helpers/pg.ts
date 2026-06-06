import { drizzle } from 'drizzle-orm/pglite'
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
