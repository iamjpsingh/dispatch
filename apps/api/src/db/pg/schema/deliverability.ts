// Analytics / engagement / deliverability domain (P2.6). Mirrors existing SQLite
// contracts: snake_case keys, JSON-as-text, integer flags/counts, REAL→real, ISO
// timestamps, date-strings as text. org-keyed tables FK organizations; user_id stays
// loose text (these are user/config-keyed analytics, as before).
import { pgTable, text, integer, real, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

// ---- analyticsService ----
export const campaign_analytics = pgTable(
  'campaign_analytics',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    campaign_id: text('campaign_id').notNull(),
    campaign_name: text('campaign_name').notNull().default(''),
    total_sent: integer('total_sent').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    unsubscribed: integer('unsubscribed').notNull().default(0),
    computed_at: ts('computed_at').notNull().defaultNow(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_ca_user_campaign').on(t.user_id, t.campaign_id), index('idx_ca_org').on(t.org_id)]
)

export const link_analytics = pgTable(
  'link_analytics',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    campaign_id: text('campaign_id').notNull(),
    url: text('url').notNull(),
    click_count: integer('click_count').notNull().default(0),
    unique_clicks: integer('unique_clicks').notNull().default(0),
    first_clicked_at: ts('first_clicked_at'),
    last_clicked_at: ts('last_clicked_at'),
  },
  (t) => [unique('uq_la_user_campaign_url').on(t.user_id, t.campaign_id, t.url), index('idx_la_org').on(t.org_id)]
)

export const event_analytics = pgTable(
  'event_analytics',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    campaign_id: text('campaign_id'),
    event_type: text('event_type').notNull(),
    recipient_email: text('recipient_email'),
    user_agent: text('user_agent'),
    client_name: text('client_name'),
    device_type: text('device_type').default('unknown'),
    geo_country: text('geo_country'),
    geo_city: text('geo_city'),
    event_hour: integer('event_hour'),
    event_day: integer('event_day'),
    url: text('url'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ea_org').on(t.org_id), index('idx_ea_user_campaign').on(t.user_id, t.campaign_id), index('idx_ea_type').on(t.event_type)]
)

// ---- scoringEngine ----
export const engagement_events = pgTable(
  'engagement_events',
  {
    id: text('id').primaryKey(),
    contact_id: text('contact_id').notNull(),
    user_id: text('user_id').notNull(),
    campaign_id: text('campaign_id'),
    event_type: text('event_type').notNull(),
    points: integer('points').notNull(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ee_contact').on(t.contact_id), index('idx_ee_user').on(t.user_id)]
)

// ---- routingEngine ----
export const provider_stats = pgTable(
  'provider_stats',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    config_id: text('config_id').notNull(),
    provider_type: text('provider_type').notNull(),
    config_name: text('config_name').notNull().default(''),
    date: text('date').notNull(),
    sent_count: integer('sent_count').notNull().default(0),
    failed_count: integer('failed_count').notNull().default(0),
    bounce_count: integer('bounce_count').notNull().default(0),
    avg_send_time_ms: real('avg_send_time_ms').notNull().default(0),
    daily_limit: integer('daily_limit').notNull().default(500),
    cost_per_email: real('cost_per_email').notNull().default(0),
    is_healthy: integer('is_healthy').notNull().default(1),
    last_error: text('last_error'),
    last_checked_at: ts('last_checked_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_ps_user_config_date').on(t.user_id, t.config_id, t.date)]
)

export const routing_config = pgTable('routing_config', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().unique(),
  weights_json: text('weights_json').notNull().default('{}'),
  failover_enabled: integer('failover_enabled').notNull().default(1),
  min_success_rate: real('min_success_rate').notNull().default(0.8),
  max_avg_send_time_ms: integer('max_avg_send_time_ms').notNull().default(30000),
  created_at: ts('created_at').notNull().defaultNow(),
  updated_at: ts('updated_at').notNull().defaultNow(),
})

export const failover_log = pgTable(
  'failover_log',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    from_config_id: text('from_config_id').notNull(),
    to_config_id: text('to_config_id').notNull(),
    reason: text('reason').notNull(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_fl_user').on(t.user_id)]
)

// ---- warmupService ----
export const warmup_plans = pgTable(
  'warmup_plans',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    config_id: text('config_id').notNull(),
    config_name: text('config_name').notNull().default(''),
    status: text('status').notNull().default('active'),
    schedule_json: text('schedule_json').notNull(),
    current_day: integer('current_day').notNull().default(1),
    total_days: integer('total_days').notNull(),
    emails_sent_today: integer('emails_sent_today').notNull().default(0),
    daily_target: integer('daily_target').notNull().default(0),
    started_at: ts('started_at').defaultNow(),
    completed_at: ts('completed_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wp_user').on(t.user_id), index('idx_wp_config').on(t.config_id)]
)

export const warmup_logs = pgTable(
  'warmup_logs',
  {
    id: text('id').primaryKey(),
    plan_id: text('plan_id').notNull().references(() => warmup_plans.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    date: text('date').notNull(),
    target: integer('target').notNull(),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    bounce_rate: real('bounce_rate').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_wl_plan').on(t.plan_id)]
)

// ---- sendingDomainService (was in dispatch.db) ----
export const sending_domains = pgTable(
  'sending_domains',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    verification_status: text('verification_status').notNull().default('pending'),
    dkim_selector: text('dkim_selector'),
    dkim_record: text('dkim_record'),
    spf_included: integer('spf_included').notNull().default(0),
    return_path: text('return_path'),
    verified_at: ts('verified_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_sd_org_domain').on(t.org_id, t.domain), index('idx_sd_org').on(t.org_id)]
)

export const sending_emails = pgTable(
  'sending_emails',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    domain_id: text('domain_id').notNull().references(() => sending_domains.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    display_name: text('display_name'),
    is_default: integer('is_default').notNull().default(0),
    assigned_to: text('assigned_to'),
    status: text('status').notNull().default('active'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('uq_se_org_email').on(t.org_id, t.email), index('idx_se_org').on(t.org_id), index('idx_se_domain').on(t.domain_id), index('idx_se_assigned').on(t.assigned_to)]
)

export type CampaignAnalyticsRow = typeof campaign_analytics.$inferSelect
export type SendingDomainRow = typeof sending_domains.$inferSelect
export type SendingEmailRow = typeof sending_emails.$inferSelect
export type WarmupPlanRow = typeof warmup_plans.$inferSelect
export type ProviderStatRow = typeof provider_stats.$inferSelect
