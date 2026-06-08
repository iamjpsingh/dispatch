// src/boot.ts - shared boot prerequisites for both process entrypoints (API + worker).
// Migrations + seeds run ONLY in the API process (opts.migrate/seed). The worker skips
// them and relies on docker-compose `depends_on: api (service_healthy)` so the schema
// exists first — this avoids two processes racing runMigrations() at startup.
import { runMigrations } from './db/pg/migrate'
import { seedSystemRoles } from './db/pg/seed'
import { templateService } from './services/templateService'
import { systemSettingsService } from './services/systemSettingsService'
import { storageService } from './services/storageService'
import { assertEncryptionKey } from './utils/crypto'
import { logger } from './utils/logger'

export async function boot(opts: { migrate?: boolean; seed?: boolean } = {}): Promise<void> {
  const { migrate = true, seed = true } = opts
  assertEncryptionKey() // fail fast: never run with secrets unencryptable
  if (migrate) await runMigrations()
  if (seed) {
    await seedSystemRoles()
    await templateService.seedStarterTemplates()
  }
  await systemSettingsService.init() // load config cache (sync reads everywhere)
  // Ensure the object-storage bucket exists (MinIO starts empty). Tolerant: storage is a
  // best-effort dependency (import-file persistence degrades gracefully), so a storage
  // outage at boot logs a warning rather than crashing the process.
  try {
    await storageService.ensureBucket()
  } catch (err) {
    logger.warn('storageService.ensureBucket failed at boot — object storage may be unavailable:', err)
  }
}
