// Apply generated Drizzle migrations to Postgres using the Bun-native SQL driver.
// drizzle-kit's CLI `migrate` needs a Node pg driver; our runtime is Bun, so we
// migrate with the same bun-sql driver the app uses. Run standalone to validate a
// migration against a real Postgres, or call runMigrations() at boot.
//   DATABASE_URL=postgres://dispatch:dispatch@localhost:5432/dispatch bun run src/db/pg/migrate.ts
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import * as schema from './schema'

export async function runMigrations(
  url = process.env.DATABASE_URL ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch',
): Promise<void> {
  const db = drizzle(url, { schema })
  await migrate(db, { migrationsFolder: `${import.meta.dir}/migrations` })
}

if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.log('✓ migrations applied')
      process.exit(0)
    })
    .catch((err) => {
      console.error('✗ migration failed:', err)
      process.exit(1)
    })
}
