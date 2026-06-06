import type Database from 'bun:sqlite'
import { db, logsDb } from './connection'
import { logger } from '../utils/logger'

interface Migration {
  id: string
  up: (mainDb: Database, logDb: Database) => void
}

const migrations: Migration[] = []

export function registerMigration(migration: Migration) {
  migrations.push(migration)
}

export function runMigrations() {
  // Create tracking table in main db
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(r => r.id)
  )

  const pending = migrations
    .filter(m => !applied.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (pending.length === 0) {
    logger.info('Database is up to date — no pending migrations')
    return
  }

  for (const migration of pending) {
    logger.info(`Running migration: ${migration.id}`)
    migration.up(db, logsDb)
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id)
    logger.info(`Migration applied: ${migration.id}`)
  }

  logger.info(`Applied ${pending.length} migration(s)`)
}
