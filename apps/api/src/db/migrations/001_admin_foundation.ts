import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '001_admin_foundation',
  up: (mainDb: Database, logDb: Database) => {
    // ──────────────────────────────────────────────
    // Main database tables
    // ──────────────────────────────────────────────

    mainDb.exec(`
      -- Organizations
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
        settings TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_org_status ON organizations(status);

      -- Local Users (replacing D1 dependency for auth)
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending', 'deactivated')),
        is_platform_admin INTEGER DEFAULT 0,
        last_login_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        org_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      -- Organization Members
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member', 'readonly')),
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
        invited_by TEXT,
        invited_at TEXT,
        joined_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, user_id),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_om_org ON org_members(org_id);
      CREATE INDEX IF NOT EXISTS idx_om_user ON org_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_om_role ON org_members(role);

      -- Teams
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, name),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

      -- Team Members
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK (role IN ('lead', 'member')),
        added_at TEXT DEFAULT (datetime('now')),
        UNIQUE(team_id, user_id),
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);

      -- Roles (custom role definitions per org)
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0,
        permissions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, name),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id);

      -- Permission overrides per user (additive or subtractive)
      CREATE TABLE IF NOT EXISTS user_permissions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted INTEGER DEFAULT 1,
        granted_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(org_id, user_id, permission),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_up_org_user ON user_permissions(org_id, user_id);
    `)

    // ──────────────────────────────────────────────
    // Logs database tables
    // ──────────────────────────────────────────────

    logDb.exec(`
      -- Audit Logs (security-sensitive actions)
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        actor_id TEXT NOT NULL,
        actor_email TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        changes TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

      -- Activity Logs (product actions, less sensitive)
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        actor_id TEXT NOT NULL,
        actor_email TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        description TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activity_org ON activity_logs(org_id);
      CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(action);
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
    `)

    // ──────────────────────────────────────────────
    // Seed system roles (org_id = NULL for system-wide)
    // ──────────────────────────────────────────────

    const systemRoles = [
      {
        id: 'role_platform_admin',
        name: 'platform_super_admin',
        description: 'Full platform access - can see all orgs, users, and system data',
        permissions: JSON.stringify(['*']),
      },
      {
        id: 'role_org_owner',
        name: 'org_owner',
        description: 'Full organization access',
        permissions: JSON.stringify([
          'org.view', 'org.manage', 'org.delete',
          'users.view', 'users.manage', 'users.invite', 'users.remove',
          'teams.view', 'teams.manage',
          'roles.view', 'roles.manage',
          'permissions.view', 'permissions.manage',
          'settings.view', 'settings.manage',
          'smtp.view', 'smtp.manage',
          'campaigns.view', 'campaigns.manage', 'campaigns.delete',
          'contacts.view', 'contacts.manage', 'contacts.import', 'contacts.export',
          'templates.view', 'templates.manage',
          'automations.view', 'automations.manage',
          'segments.view', 'segments.manage',
          'analytics.view', 'analytics.export',
          'reports.view', 'reports.export',
          'webhooks.view', 'webhooks.manage',
          'apikeys.view', 'apikeys.manage',
          'audit.view',
          'logs.view',
          'billing.view', 'billing.manage',
        ]),
      },
      {
        id: 'role_org_admin',
        name: 'org_admin',
        description: 'Admin access - everything except org deletion and billing',
        permissions: JSON.stringify([
          'org.view',
          'users.view', 'users.manage', 'users.invite',
          'teams.view', 'teams.manage',
          'roles.view', 'roles.manage',
          'permissions.view', 'permissions.manage',
          'settings.view', 'settings.manage',
          'smtp.view', 'smtp.manage',
          'campaigns.view', 'campaigns.manage', 'campaigns.delete',
          'contacts.view', 'contacts.manage', 'contacts.import', 'contacts.export',
          'templates.view', 'templates.manage',
          'automations.view', 'automations.manage',
          'segments.view', 'segments.manage',
          'analytics.view', 'analytics.export',
          'reports.view', 'reports.export',
          'webhooks.view', 'webhooks.manage',
          'apikeys.view', 'apikeys.manage',
          'audit.view',
          'logs.view',
        ]),
      },
      {
        id: 'role_org_manager',
        name: 'org_manager',
        description: 'Manager access - campaigns, contacts, templates, reports',
        permissions: JSON.stringify([
          'org.view',
          'users.view',
          'teams.view',
          'settings.view',
          'smtp.view',
          'campaigns.view', 'campaigns.manage',
          'contacts.view', 'contacts.manage', 'contacts.import',
          'templates.view', 'templates.manage',
          'automations.view', 'automations.manage',
          'segments.view', 'segments.manage',
          'analytics.view',
          'reports.view',
          'logs.view',
        ]),
      },
      {
        id: 'role_org_member',
        name: 'org_member',
        description: 'Member access - create and view own campaigns and contacts',
        permissions: JSON.stringify([
          'org.view',
          'users.view',
          'teams.view',
          'campaigns.view', 'campaigns.manage',
          'contacts.view', 'contacts.manage',
          'templates.view',
          'segments.view',
          'analytics.view',
          'reports.view',
        ]),
      },
      {
        id: 'role_readonly',
        name: 'readonly',
        description: 'Read-only access to org data',
        permissions: JSON.stringify([
          'org.view',
          'users.view',
          'teams.view',
          'campaigns.view',
          'contacts.view',
          'templates.view',
          'segments.view',
          'analytics.view',
          'reports.view',
          'logs.view',
        ]),
      },
    ]

    const insertRole = mainDb.prepare(`
      INSERT OR IGNORE INTO roles (id, org_id, name, description, is_system, permissions)
      VALUES (?, NULL, ?, ?, 1, ?)
    `)

    for (const role of systemRoles) {
      insertRole.run(role.id, role.name, role.description, role.permissions)
    }
  },
})
