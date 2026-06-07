/**
 * Application Entry Point
 * Applies Postgres migrations and seeds system roles (idempotent), then exports
 * the Hono application for the Bun runtime. The identity domain now lives in
 * Postgres, so the app requires a reachable DATABASE_URL to boot.
 *
 * Tests never import this file — they import src/* directly and inject a PGlite
 * db — and the NODE_ENV guard keeps the bun-sql driver out of the test runtime.
 */
import app, { startBackgroundWorkers, stopBackgroundWorkers } from './src/app'
import { runMigrations } from './src/db/pg/migrate'
import { seedSystemRoles } from './src/db/pg/seed'
import { templateService } from './src/services/templateService'
import { systemSettingsService } from './src/services/systemSettingsService'
import { assertEncryptionKey } from './src/utils/crypto'
import { logger } from './src/utils/logger'

if (process.env.NODE_ENV !== 'test') {
  assertEncryptionKey() // fail fast: never run with secrets unencryptable
  await runMigrations()
  await seedSystemRoles()
  await templateService.seedStarterTemplates()
  await systemSettingsService.init() // load config cache (sync reads everywhere)
  await startBackgroundWorkers()

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`)
    stopBackgroundWorkers()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export default app
