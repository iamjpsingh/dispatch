// Identity domain (P2.1): organizations, users, sessions, membership, roles, invitations.
// Mirrors the SQLite DDL from migrations 001/003/006, now with real Postgres FKs.
import { pgTable, text, boolean, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core'

// timestamptz stored/returned as ISO strings (matches the existing TEXT-datetime contract)
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    plan: text('plan').$type<'free' | 'starter' | 'pro' | 'enterprise'>().default('free').notNull(),
    status: text('status').$type<'active' | 'suspended' | 'archived'>().default('active').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
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
    passwordHash: text('password_hash').notNull(),
    status: text('status').$type<'active' | 'suspended' | 'pending' | 'deactivated'>().default('active').notNull(),
    isPlatformAdmin: boolean('is_platform_admin').default(false).notNull(),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('idx_users_email').on(t.email), index('idx_users_status').on(t.status)]
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_sessions_token').on(t.token),
    index('idx_sessions_user').on(t.userId),
    index('idx_sessions_expires').on(t.expiresAt),
  ]
)

export const orgMembers = pgTable(
  'org_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'owner' | 'admin' | 'manager' | 'member' | 'readonly'>().default('member').notNull(),
    status: text('status').$type<'active' | 'invited' | 'suspended' | 'removed'>().default('active').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: ts('invited_at'),
    joinedAt: ts('joined_at').defaultNow(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    unique('uq_org_members_org_user').on(t.orgId, t.userId),
    index('idx_om_org').on(t.orgId),
    index('idx_om_user').on(t.userId),
    index('idx_om_role').on(t.role),
  ]
)

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [unique('uq_teams_org_name').on(t.orgId, t.name), index('idx_teams_org').on(t.orgId)]
)

export const teamMembers = pgTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'lead' | 'member'>().default('member').notNull(),
    addedAt: ts('added_at').defaultNow(),
  },
  (t) => [
    unique('uq_team_members_team_user').on(t.teamId, t.userId),
    index('idx_tm_team').on(t.teamId),
    index('idx_tm_user').on(t.userId),
  ]
)

export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    // null org_id = system role (seeded). FK still cascades for org-scoped custom roles.
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false).notNull(),
    permissions: jsonb('permissions').$type<string[]>().default([]).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [unique('uq_roles_org_name').on(t.orgId, t.name), index('idx_roles_org').on(t.orgId)]
)

export const userPermissions = pgTable(
  'user_permissions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    granted: boolean('granted').default(true).notNull(),
    grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    unique('uq_user_perm').on(t.orgId, t.userId, t.permission),
    index('idx_up_org_user').on(t.orgId, t.userId),
  ]
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_prt_token').on(t.token), index('idx_prt_user').on(t.userId)]
)

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<'owner' | 'admin' | 'manager' | 'member' | 'readonly'>().default('member').notNull(),
    token: text('token').notNull().unique(),
    invitedBy: text('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<'pending' | 'accepted' | 'expired' | 'cancelled'>().default('pending').notNull(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    unique('uq_inv_org_email_status').on(t.orgId, t.email, t.status),
    index('idx_inv_token').on(t.token),
    index('idx_inv_org').on(t.orgId),
    index('idx_inv_email').on(t.email),
    index('idx_inv_status').on(t.status),
  ]
)

export type Organization = typeof organizations.$inferSelect
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type OrgMember = typeof orgMembers.$inferSelect
export type Role = typeof roles.$inferSelect
export type Invitation = typeof invitations.$inferSelect
