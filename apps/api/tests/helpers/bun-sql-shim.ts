// Vitest shim for `drizzle-orm/bun-sql` (a Bun-only module that can't load under the
// Node-based test runtime). Tests inject a PGlite db via __setTestDb, so the prod driver
// is never constructed — this stub just satisfies the static import in client.ts.
export function drizzle(): never {
  throw new Error('drizzle-orm/bun-sql is Bun-only; tests must inject a db via __setTestDb()')
}
