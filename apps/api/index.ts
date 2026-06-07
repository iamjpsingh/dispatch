/**
 * Application Entry Point
 * Applies Postgres migrations and seeds system roles (idempotent), then exports
 * the Hono application for the Bun runtime. The identity domain now lives in
 * Postgres, so the app requires a reachable DATABASE_URL to boot.
 *
 * Tests never import this file — they import src/* directly and inject a PGlite
 * db — and the NODE_ENV guard keeps the bun-sql driver out of the test runtime.
 */
import app from './src/app'
import { runMigrations } from './src/db/pg/migrate'
import { seedSystemRoles } from './src/db/pg/seed'

if (process.env.NODE_ENV !== 'test') {
  await runMigrations()
  await seedSystemRoles()
}

export default app
