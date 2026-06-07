import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { PGlite } from '@electric-sql/pglite'
import * as schema from '../../src/db/pg/schema'

/**
 * Fresh in-memory Postgres (PGlite) + Drizzle, isolated per call.
 * Used by service tests so the data layer runs on real Postgres semantics
 * without Docker.
 */
export function freshDb() {
  return drizzle({ client: new PGlite(), schema })
}

export type TestDb = ReturnType<typeof freshDb>

// Migrating the full schema (many migrations / ~45 tables) per test is the dominant
// cost and, across ~20 PGlite test files, trips hook timeouts. Instead migrate ONCE
// per test file into a template PGlite, dump it, then clone that dump for each test
// (vitest isolates modules per file, so this cache is per-file). Cloning a pre-migrated
// dump is far cheaper than re-running every migration.
let templateDump: Promise<File | Blob> | null = null

async function getTemplateDump(): Promise<File | Blob> {
  if (!templateDump) {
    templateDump = (async () => {
      const seed = new PGlite()
      await migrate(drizzle({ client: seed, schema }), { migrationsFolder: './src/db/pg/migrations' })
      const dump = await seed.dumpDataDir()
      await seed.close()
      return dump
    })()
  }
  return templateDump
}

/** Fresh PGlite with all generated migrations applied — for schema/service tests. */
export async function freshDbMigrated(): Promise<TestDb> {
  const dump = await getTemplateDump()
  const client = new PGlite({ loadDataDir: dump })
  return drizzle({ client, schema })
}
