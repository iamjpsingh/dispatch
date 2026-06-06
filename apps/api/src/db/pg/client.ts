// Postgres data-layer client (P2).
// Prod: Bun-native SQL, constructed lazily on first use.
// Tests: a PGlite-backed db is injected via __setTestDb (see tests/helpers/pg.ts), and
// vitest aliases 'drizzle-orm/bun-sql' to a stub so Node never loads the Bun-only module.
import { drizzle } from 'drizzle-orm/bun-sql'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

let _prod: Db | null = null
let _test: Db | null = null

/** TEST ONLY — inject a PGlite-backed db so getDb() returns it. Pass null to clear. */
export function __setTestDb(db: Db | null): void {
  _test = db
}

/** The singleton Postgres/Drizzle client (test db if injected, else lazy prod bun-sql). */
export function getDb(): Db {
  if (_test) return _test
  if (!_prod) {
    const url = process.env.DATABASE_URL ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch'
    _prod = drizzle(url, { schema }) as unknown as Db
  }
  return _prod
}
