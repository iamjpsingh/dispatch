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
import { templateService } from './src/services/templateService'
import { systemSettingsService } from './src/services/systemSettingsService'

if (process.env.NODE_ENV !== 'test') {
  await runMigrations()
  await seedSystemRoles()
  await templateService.seedStarterTemplates()
  await systemSettingsService.init() // load config cache (sync reads everywhere)
}

export default app
