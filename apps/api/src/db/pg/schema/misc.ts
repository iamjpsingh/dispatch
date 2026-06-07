// Misc domain (P2.7b): WhatsApp, audit/activity logs, system settings. Mirrors the
// existing SQLite contracts (snake_case, JSON-as-text, integer flags, ISO ts).
// (teams/team_members already live in ./identity — teamService just swaps onto them.)
import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const whatsapp_configs = pgTable(
  'whatsapp_configs',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('meta'),
    phone_number_id: text('phone_number_id').notNull(),
    business_account_id: text('business_account_id'),
    access_token: text('access_token').notNull(),
    phone_display: text('phone_display'),
    webhook_verify_token: text('webhook_verify_token'),
    status: text('status').notNull().default('active'),
    daily_limit: integer('daily_limit').notNull().default(1000),
    sent_today: integer('sent_today').notNull().default(0),
    last_reset_date: text('last_reset_date'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wac_org').on(t.org_id)]
)

export const whatsapp_templates = pgTable(
  'whatsapp_templates',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    config_id: text('config_id').notNull().references(() => whatsapp_configs.id, { onDelete: 'cascade' }),
    meta_template_name: text('meta_template_name').notNull(),
    meta_template_id: text('meta_template_id'),
    language: text('language').notNull().default('en'),
    category: text('category').notNull().default('MARKETING'),
    status: text('status').notNull().default('PENDING'),
    components_json: text('components_json').notNull().default('[]'),
    example_json: text('example_json'),
    body_text: text('body_text'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wat_org').on(t.org_id), index('idx_wat_config').on(t.config_id)]
)

export const whatsapp_messages = pgTable(
  'whatsapp_messages',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    config_id: text('config_id').notNull(),
    campaign_id: text('campaign_id'),
    contact_id: text('contact_id'),
    phone_number: text('phone_number').notNull(),
    template_id: text('template_id'),
    message_type: text('message_type').notNull().default('template'),
    content_json: text('content_json').notNull().default('{}'),
    wamid: text('wamid'),
    status: text('status').notNull().default('queued'),
    error_message: text('error_message'),
    sent_at: ts('sent_at'),
    delivered_at: ts('delivered_at'),
    read_at: ts('read_at'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wam_org').on(t.org_id), index('idx_wam_campaign').on(t.campaign_id)]
)

export const audit_logs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id'),
    actor_id: text('actor_id').notNull(),
    actor_email: text('actor_email'),
    action: text('action').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id'),
    changes: text('changes'),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    metadata: text('metadata').default('{}'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_audit_org').on(t.org_id), index('idx_audit_actor').on(t.actor_id)]
)

export const activity_logs = pgTable(
  'activity_logs',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id'),
    actor_id: text('actor_id').notNull(),
    actor_email: text('actor_email'),
    action: text('action').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id'),
    description: text('description'),
    metadata: text('metadata').default('{}'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_activity_org').on(t.org_id)]
)

export const system_settings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_by: text('updated_by'),
  updated_at: ts('updated_at').notNull().defaultNow(),
  created_at: ts('created_at').notNull().defaultNow(),
})

export type WhatsappConfigRow = typeof whatsapp_configs.$inferSelect
export type AuditLogRow = typeof audit_logs.$inferSelect
export type SystemSettingRow = typeof system_settings.$inferSelect
