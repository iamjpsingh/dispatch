// Identity domain (P2.1). Column types + property keys deliberately MIRROR the
// existing SQLite contracts so the service migration preserves return shapes with
// zero conversion: snake_case keys, integer booleans (0/1), JSON stored as text
// (services JSON.parse it), timestamps as ISO strings.
import { pgTable, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    plan: text('plan').notNull().default('free'),
    status: text('status').notNull().default('active'),
    settings: text('settings').notNull().default('{}'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_org_slug').on(t.slug), index('idx_org_status').on(t.status)]
)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    username: text('username').unique(),
    name: text('name').notNull(),
    password_hash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    is_platform_admin: integer('is_platform_admin').notNull().default(0),
    last_login_at: ts('last_login_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_users_email').on(t.email), index('idx_users_status').on(t.status)]
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    expires_at: ts('expires_at').notNull(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_sessions_token').on(t.token),
    index('idx_sessions_user').on(t.user_id),
    index('idx_sessions_expires').on(t.expires_at),
  ]
)

export const org_members = pgTable(
  'org_members',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    invited_by: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invited_at: ts('invited_at'),
    joined_at: ts('joined_at').defaultNow(),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_org_members_org_user').on(t.org_id, t.user_id),
    index('idx_om_org').on(t.org_id),
    index('idx_om_user').on(t.user_id),
    index('idx_om_role').on(t.role),
  ]
)

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_teams_org_name').on(t.org_id, t.name), index('idx_teams_org').on(t.org_id)]
)

export const team_members = pgTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    added_at: ts('added_at').defaultNow(),
  },
  (t) => [
    unique('uq_team_members_team_user').on(t.team_id, t.user_id),
    index('idx_tm_team').on(t.team_id),
    index('idx_tm_user').on(t.user_id),
  ]
)

export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    // null org_id = system role (seeded)
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    is_system: integer('is_system').notNull().default(0),
    permissions: text('permissions').notNull().default('[]'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_roles_org_name').on(t.org_id, t.name), index('idx_roles_org').on(t.org_id)]
)

export const user_permissions = pgTable(
  'user_permissions',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    granted: integer('granted').notNull().default(1),
    granted_by: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_user_perm').on(t.org_id, t.user_id, t.permission),
    index('idx_up_org_user').on(t.org_id, t.user_id),
  ]
)

export const password_reset_tokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expires_at: ts('expires_at').notNull(),
    used_at: ts('used_at'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_prt_token').on(t.token), index('idx_prt_user').on(t.user_id)]
)

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    token: text('token').notNull().unique(),
    invited_by: text('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    expires_at: ts('expires_at').notNull(),
    accepted_at: ts('accepted_at'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_inv_org_email_status').on(t.org_id, t.email, t.status),
    index('idx_inv_token').on(t.token),
    index('idx_inv_org').on(t.org_id),
    index('idx_inv_email').on(t.email),
    index('idx_inv_status').on(t.status),
  ]
)

// API keys (P4.E — migrated off data/apikeys.db). Mirrors the sqlite contract:
// argon2id key_hash, snake_case, integer-flag `enabled`, scopes as JSON text.
export const api_keys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    key_prefix: text('key_prefix').notNull(),
    key_hash: text('key_hash').notNull(),
    scopes: text('scopes').notNull().default('["read"]'),
    last_used_at: ts('last_used_at'),
    expires_at: ts('expires_at'),
    enabled: integer('enabled').notNull().default(1),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ak_org').on(t.org_id), index('idx_ak_user').on(t.user_id), index('idx_ak_prefix').on(t.key_prefix)]
)

export type UserRow = typeof users.$inferSelect
export type OrganizationRow = typeof organizations.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type OrgMemberRow = typeof org_members.$inferSelect
export type RoleRow = typeof roles.$inferSelect
export type InvitationRow = typeof invitations.$inferSelect
export type ApiKeyRow = typeof api_keys.$inferSelect
