import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '004_system_settings',
  up: (mainDb: Database, _logDb: Database) => {
    mainDb.exec(`
      -- Platform-level key-value settings (system mailer config, etc.)
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      );
    `)
  },
})
