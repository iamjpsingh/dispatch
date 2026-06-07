// Queue + deliverability-control domain (P2.4). Mirrors existing SQLite contracts
// (snake_case, JSON-as-text, integer flags/counts, ISO timestamps). Org-keyed control
// tables (email_preferences, frequency_*, graymail_*) carry a real FK to organizations.
// jobs/scheduled_jobs/suppression keep loose user_id text (transient queue rows, no FK;
// P4 replaces the queue with BullMQ). suppression_list gains a nullable org_id — the
// structural step toward unifying suppression + preferences on org_id; the send-time
// enforcement that consults both is wired in P4.
import { pgTable, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    campaign_id: text('campaign_id'),
    org_id: text('org_id'), // threaded for compliance/tenancy; nullable (legacy enqueue paths)
    user_id: text('user_id').notNull(),
    type: text('type').notNull().default('batch'),
    status: text('status').notNull().default('pending'),
    priority: integer('priority').notNull().default(5),
    config_id: text('config_id'),
    config_json: text('config_json').notNull(),
    contacts_json: text('contacts_json').notNull(),
    html_content: text('html_content').notNull().default(''),
    subject: text('subject').notNull().default(''),
    from_email: text('from_email').notNull().default(''),
    from_name: text('from_name').notNull().default(''),
    config_name: text('config_name'),
    notify_email: text('notify_email'),
    total_count: integer('total_count').notNull().default(0),
    sent_count: integer('sent_count').notNull().default(0),
    failed_count: integer('failed_count').notNull().default(0),
    last_processed_index: integer('last_processed_index').notNull().default(0),
    batch_size: integer('batch_size').default(20),
    email_delay_sec: integer('email_delay_sec').default(45),
    batch_delay_min: integer('batch_delay_min').default(60),
    scheduled_at: ts('scheduled_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    started_at: ts('started_at'),
    completed_at: ts('completed_at'),
    updated_at: ts('updated_at').notNull().defaultNow(),
    last_error: text('last_error'),
    retry_count: integer('retry_count').notNull().default(0),
  },
  (t) => [
    index('idx_jobs_status').on(t.status),
    index('idx_jobs_user').on(t.user_id),
    index('idx_jobs_priority').on(t.priority, t.created_at),
    index('idx_jobs_scheduled').on(t.scheduled_at),
  ]
)

export const dead_letters = pgTable(
  'dead_letters',
  {
    id: text('id').primaryKey(),
    job_id: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    recipient_email: text('recipient_email').notNull(),
    recipient_name: text('recipient_name'),
    error_message: text('error_message'),
    error_code: text('error_code'),
    error_type: text('error_type'),
    attempts: integer('attempts').notNull().default(1),
    created_at: ts('created_at').notNull().defaultNow(),
    last_attempt_at: ts('last_attempt_at'),
  },
  (t) => [index('idx_dl_job').on(t.job_id)]
)

export const suppression_list = pgTable(
  'suppression_list',
  {
    id: text('id').primaryKey(),
    // nullable org_id: the structural step toward org-scoped suppression (unification);
    // user_id remains the operative key until P4 wires org-scoped enforcement.
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    email: text('email').notNull(),
    reason: text('reason').notNull(),
    source: text('source'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_suppress_user_email').on(t.user_id, t.email),
    index('idx_suppress_user').on(t.user_id),
    index('idx_suppress_email').on(t.email),
    index('idx_suppress_org_email').on(t.org_id, t.email),
  ]
)

export const scheduled_jobs = pgTable(
  'scheduled_jobs',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    email_job: text('email_job').notNull(),
    batch_config: text('batch_config'),
    scheduled_time: ts('scheduled_time').notNull(),
    notify_email: text('notify_email'),
    notify_browser: integer('notify_browser').default(0),
    status: text('status').default('scheduled'),
    created_at: ts('created_at').defaultNow(),
    started_at: ts('started_at'),
    completed_at: ts('completed_at'),
    contact_count: integer('contact_count'),
    subject: text('subject'),
    use_batch: integer('use_batch').default(0),
    config_name: text('config_name'),
    // P4.3: BullMQ scheduling — repeatable (cron) vs one-shot (delayed) jobs.
    cron_pattern: text('cron_pattern'),
    is_repeating: integer('is_repeating').notNull().default(0),
  },
  (t) => [index('idx_sched_user').on(t.user_id), index('idx_sched_time').on(t.scheduled_time)]
)

export const email_preferences = pgTable(
  'email_preferences',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    preference: text('preference').notNull().default('subscribed'),
    pause_until: ts('pause_until'),
    reason: text('reason'),
    updated_at: ts('updated_at').notNull().defaultNow(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_pref_org_email').on(t.org_id, t.email),
    index('idx_pref_org_email').on(t.org_id, t.email),
    index('idx_pref_preference').on(t.preference),
  ]
)

export const frequency_log = pgTable(
  'frequency_log',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    campaign_id: text('campaign_id'),
    sent_at: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [index('idx_freqlog_org_email').on(t.org_id, t.email)]
)

export const frequency_config = pgTable('frequency_config', {
  org_id: text('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  max_per_window: integer('max_per_window').notNull().default(5),
  window_hours: integer('window_hours').notNull().default(168),
  enabled: integer('enabled').notNull().default(0),
  updated_at: ts('updated_at').notNull().defaultNow(),
})

export const graymail_tracker = pgTable(
  'graymail_tracker',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    sends_since_engagement: integer('sends_since_engagement').notNull().default(0),
    last_sent_at: ts('last_sent_at'),
    last_engaged_at: ts('last_engaged_at'),
    is_graymail: integer('is_graymail').notNull().default(0),
  },
  (t) => [unique('uq_graymail_org_email').on(t.org_id, t.email)]
)

export const graymail_config = pgTable('graymail_config', {
  org_id: text('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull().default(0),
  threshold: integer('threshold').notNull().default(11),
  updated_at: ts('updated_at').notNull().defaultNow(),
})

export type JobRow = typeof jobs.$inferSelect
export type DeadLetterRow = typeof dead_letters.$inferSelect
export type SuppressionRow = typeof suppression_list.$inferSelect
export type ScheduledJobRow = typeof scheduled_jobs.$inferSelect
export type EmailPreferenceRow = typeof email_preferences.$inferSelect
