import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '005_tracking_config',
  up: (mainDb: Database, _logDb: Database) => {
    mainDb.exec(`
      -- Per-org tracking domain configuration
      CREATE TABLE IF NOT EXISTS tracking_configs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        worker_name TEXT NOT NULL,
        d1_database_id TEXT NOT NULL,
        open_path TEXT DEFAULT 'o',
        click_path TEXT DEFAULT 'c',
        unsub_path TEXT DEFAULT 'u',
        use_subdomain INTEGER DEFAULT 0,
        subdomain TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
        deployed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, domain)
      );

      CREATE INDEX IF NOT EXISTS idx_tracking_configs_org ON tracking_configs(org_id);
    `)
  },
})
