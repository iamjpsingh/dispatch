// src/boot.ts - shared boot prerequisites for both process entrypoints (API + worker).
// Migrations + seeds run ONLY in the API process (opts.migrate/seed). The worker skips
// them and relies on docker-compose `depends_on: api (service_healthy)` so the schema
// exists first — this avoids two processes racing runMigrations() at startup.
import { runMigrations } from './db/pg/migrate'
import { seedSystemRoles } from './db/pg/seed'
import { templateService } from './services/templateService'
import { systemSettingsService } from './services/systemSettingsService'
import { assertEncryptionKey } from './utils/crypto'

export async function boot(opts: { migrate?: boolean; seed?: boolean } = {}): Promise<void> {
  const { migrate = true, seed = true } = opts
  assertEncryptionKey() // fail fast: never run with secrets unencryptable
  if (migrate) await runMigrations()
  if (seed) {
    await seedSystemRoles()
    await templateService.seedStarterTemplates()
  }
  await systemSettingsService.init() // load config cache (sync reads everywhere)
}
