// Integrations domain (P2.7a): webhooks, plugins, forms, landing pages, RSS feeds.
// Mirrors existing SQLite contracts (snake_case, JSON-as-text, integer flags, ISO ts).
// org-keyed tables FK organizations; user_id stays loose text; child tables cascade.
import { pgTable, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').notNull().default('[]'),
    enabled: integer('enabled').notNull().default(1),
    last_triggered_at: ts('last_triggered_at'),
    failure_count: integer('failure_count').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wh_org').on(t.org_id), index('idx_wh_user').on(t.user_id)]
)

export const webhook_logs = pgTable(
  'webhook_logs',
  {
    id: text('id').primaryKey(),
    webhook_id: text('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
    event_type: text('event_type').notNull(),
    status: text('status').notNull(),
    status_code: integer('status_code'),
    response_body: text('response_body'),
    error: text('error'),
    duration_ms: integer('duration_ms').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_whl_webhook').on(t.webhook_id)]
)

export const plugins = pgTable(
  'plugins',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull().default('1.0.0'),
    description: text('description'),
    author: text('author'),
    type: text('type').notNull(),
    status: text('status').notNull().default('installed'),
    manifest_json: text('manifest_json').notNull(),
    settings_json: text('settings_json').notNull().default('{}'),
    entry_path: text('entry_path'),
    error_message: text('error_message'),
    installed_at: ts('installed_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_plugin_user').on(t.user_id)]
)

export const form_endpoints = pgTable(
  'form_endpoints',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    list_id: text('list_id').notNull(),
    field_mapping: text('field_mapping').notNull().default('{}'),
    required_fields: text('required_fields').notNull().default('["email"]'),
    allowed_domains: text('allowed_domains').notNull().default('[]'),
    redirect_url: text('redirect_url'),
    actions: text('actions').notNull().default('[]'),
    double_optin: integer('double_optin').notNull().default(0),
    success_message: text('success_message').notNull().default('Thank you for subscribing!'),
    submission_count: integer('submission_count').notNull().default(0),
    status: text('status').notNull().default('active'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_fe_org').on(t.org_id)]
)

export const form_submissions = pgTable(
  'form_submissions',
  {
    id: text('id').primaryKey(),
    form_id: text('form_id').notNull().references(() => form_endpoints.id, { onDelete: 'cascade' }),
    data: text('data').notNull(),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_fs_form').on(t.form_id)]
)

export const landing_pages = pgTable(
  'landing_pages',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    template: text('template').notNull().default('lead_capture'),
    html_content: text('html_content').notNull().default(''),
    css_content: text('css_content').notNull().default(''),
    meta_description: text('meta_description'),
    meta_image: text('meta_image'),
    form_id: text('form_id'),
    tracking_enabled: integer('tracking_enabled').notNull().default(1),
    published: integer('published').notNull().default(0),
    visit_count: integer('visit_count').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_lp_org_slug').on(t.org_id, t.slug), index('idx_lp_org').on(t.org_id)]
)

export type WebhookRow = typeof webhooks.$inferSelect
export type PluginRow = typeof plugins.$inferSelect
export type FormEndpointRow = typeof form_endpoints.$inferSelect
export type LandingPageRow = typeof landing_pages.$inferSelect
