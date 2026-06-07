// src/boot.ts - shared boot prerequisites for both process entrypoints (API + worker).
// Idempotent: runMigrations/seeds are safe to re-run, so the worker calling boot()
// after the API has already migrated is a no-op.
import { runMigrations } from './db/pg/migrate'
import { seedSystemRoles } from './db/pg/seed'
import { templateService } from './services/templateService'
import { systemSettingsService } from './services/systemSettingsService'
import { assertEncryptionKey } from './utils/crypto'

export async function boot() {
  assertEncryptionKey() // fail fast: never run with secrets unencryptable
  await runMigrations()
  await seedSystemRoles()
  await templateService.seedStarterTemplates()
  await systemSettingsService.init() // load config cache (sync reads everywhere)
}
