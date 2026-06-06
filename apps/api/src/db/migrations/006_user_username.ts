import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '006_user_username',
  up: (mainDb: Database, _logDb: Database) => {
    // Add username column to users (idempotent)
    try { mainDb.exec('ALTER TABLE users ADD COLUMN username TEXT') } catch {}
    mainDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL')

    // Add sending_domains and sending_emails tables
    mainDb.exec(`
      CREATE TABLE IF NOT EXISTS sending_domains (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
        dkim_selector TEXT,
        dkim_record TEXT,
        spf_included INTEGER DEFAULT 0,
        return_path TEXT,
        verified_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, domain)
      );

      CREATE INDEX IF NOT EXISTS idx_sd_org ON sending_domains(org_id);

      CREATE TABLE IF NOT EXISTS sending_emails (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        is_default INTEGER DEFAULT 0,
        assigned_to TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (domain_id) REFERENCES sending_domains(id) ON DELETE CASCADE,
        UNIQUE(org_id, email)
      );

      CREATE INDEX IF NOT EXISTS idx_se_org ON sending_emails(org_id);
      CREATE INDEX IF NOT EXISTS idx_se_domain ON sending_emails(domain_id);
      CREATE INDEX IF NOT EXISTS idx_se_assigned ON sending_emails(assigned_to);
    `)
  },
})
