// Campaigns domain (P2.3). Mirrors the existing SQLite contracts: snake_case keys,
// JSON-as-text (tags/draft_data/ab_config/rotation_config), integer counts, ISO-string
// timestamps. org_id/user_id carry real FKs to identity; template_id/list_id/segment_id
// stay loose nullable text (cross-entity pointers the app tolerates dangling, as before).
import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations, users } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const campaigns = pgTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull().default('one_time'),
    status: text('status').notNull().default('draft'),
    template_id: text('template_id'),
    list_id: text('list_id'),
    segment_id: text('segment_id'),
    subject: text('subject').notNull(),
    from_name: text('from_name').notNull(),
    from_email: text('from_email').notNull(),
    reply_to: text('reply_to'),
    tags: text('tags').notNull().default('[]'),
    folder: text('folder'),
    draft_data: text('draft_data'),
    ab_config: text('ab_config'),
    rotation_config: text('rotation_config'),
    batch_size: integer('batch_size').notNull().default(20),
    email_delay: integer('email_delay').notNull().default(45),
    batch_delay: integer('batch_delay').notNull().default(60),
    total_recipients: integer('total_recipients').notNull().default(0),
    sent_count: integer('sent_count').notNull().default(0),
    failed_count: integer('failed_count').notNull().default(0),
    open_count: integer('open_count').notNull().default(0),
    click_count: integer('click_count').notNull().default(0),
    bounce_count: integer('bounce_count').notNull().default(0),
    unsubscribe_count: integer('unsubscribe_count').notNull().default(0),
    job_id: text('job_id'),
    scheduled_at: ts('scheduled_at'),
    sent_at: ts('sent_at'),
    completed_at: ts('completed_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_camp_org').on(t.org_id),
    index('idx_camp_user').on(t.user_id),
    index('idx_camp_status').on(t.status),
    index('idx_camp_type').on(t.type),
    index('idx_camp_scheduled').on(t.scheduled_at),
  ]
)

export const ab_variants = pgTable(
  'ab_variants',
  {
    id: text('id').primaryKey(),
    campaign_id: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    variant_label: text('variant_label').notNull(),
    subject: text('subject'),
    template_id: text('template_id'),
    sender_name: text('sender_name'),
    sender_email: text('sender_email'),
    percentage: integer('percentage').notNull(),
    sent_count: integer('sent_count').notNull().default(0),
    open_count: integer('open_count').notNull().default(0),
    click_count: integer('click_count').notNull().default(0),
    is_winner: integer('is_winner').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ab_campaign').on(t.campaign_id)]
)

export type CampaignRow = typeof campaigns.$inferSelect
export type ABVariantRow = typeof ab_variants.$inferSelect
