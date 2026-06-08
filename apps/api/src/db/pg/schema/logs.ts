// Send-log domain (P5.3). Replaces the global ./logs/email-logs.json file store with
// an org-scoped Postgres table — every read/write is keyed by org_id (R9). Column keys
// snake_case; created_at is an ISO string (mode:'string') to match the rest of the schema.
import { pgTable, text, index } from 'drizzle-orm/pg-core'
import { timestamp } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const email_logs = pgTable(
  'email_logs',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    status: text('status').notNull(),
    message: text('message'),
    message_id: text('message_id'),
    first_name: text('first_name'),
    company: text('company'),
    subject: text('subject'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_el_org_created').on(t.org_id, t.created_at), index('idx_el_status').on(t.status)]
)

export type EmailLogRow = typeof email_logs.$inferSelect
