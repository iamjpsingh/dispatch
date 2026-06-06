import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '003_auth_extended',
  up: (mainDb: Database, _logDb: Database) => {
    mainDb.exec(`
      -- Password reset tokens
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

      -- Organization invitations
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member', 'readonly')),
        token TEXT UNIQUE NOT NULL,
        invited_by TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, email, status),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_inv_token ON invitations(token);
      CREATE INDEX IF NOT EXISTS idx_inv_org ON invitations(org_id);
      CREATE INDEX IF NOT EXISTS idx_inv_email ON invitations(email);
      CREATE INDEX IF NOT EXISTS idx_inv_status ON invitations(status);
    `)
  },
})
