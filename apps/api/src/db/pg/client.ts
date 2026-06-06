// Postgres data-layer client (P2).
// Prod runs on Bun's native SQL driver. Tests use an isolated PGlite instance via
// tests/helpers/pg.ts#freshDb (embedded Postgres, no Docker) — see the P2 design doc.
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch'

export const db = drizzle(DATABASE_URL, { schema })
export type Db = typeof db

/** Accessor for the singleton Postgres/Drizzle client (prod). */
export function getDb(): Db {
  return db
}
