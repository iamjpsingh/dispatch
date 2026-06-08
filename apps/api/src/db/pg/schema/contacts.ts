// Contacts domain (P2.2). Column types + property keys MIRROR the existing SQLite
// contracts so the service migration preserves return shapes with zero conversion:
// snake_case keys, JSON stored as text (services JSON.parse it), integers for counts/
// scores, timestamps as ISO strings. Now in the same Postgres DB as identity, so
// org_id/user_id/list_id carry real FKs (the P2 goal — no more cross-DB orphans).
import { pgTable, text, integer, timestamp, index, unique, primaryKey } from 'drizzle-orm/pg-core'
import { organizations, users } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const contact_lists = pgTable(
  'contact_lists',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    contact_count: integer('contact_count').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_cl_org').on(t.org_id), index('idx_cl_user').on(t.user_id)]
)

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    list_id: text('list_id').notNull().references(() => contact_lists.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    first_name: text('first_name'),
    last_name: text('last_name'),
    company: text('company'),
    phone: text('phone'),
    tags: text('tags').notNull().default('[]'),
    custom_fields: text('custom_fields').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    engagement_score: integer('engagement_score').notNull().default(50),
    source: text('source'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_contacts_list_email').on(t.list_id, t.email),
    index('idx_c_org').on(t.org_id),
    index('idx_c_user').on(t.user_id),
    index('idx_c_list').on(t.list_id),
    index('idx_c_email').on(t.email),
    index('idx_c_status').on(t.status),
    index('idx_c_score').on(t.engagement_score),
  ]
)

export const import_history = pgTable(
  'import_history',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // No FK: history survives deletion of the list it described (matches old behavior).
    list_id: text('list_id').notNull(),
    filename: text('filename').notNull(),
    format: text('format').notNull(),
    total_rows: integer('total_rows').notNull().default(0),
    imported: integer('imported').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    invalid: integer('invalid').notNull().default(0),
    field_mapping: text('field_mapping'),
    file_key: text('file_key'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ih_org').on(t.org_id), index('idx_ih_user').on(t.user_id)]
)

export const segments = pgTable(
  'segments',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull().default('dynamic'),
    rules_json: text('rules_json'),
    contact_count: integer('contact_count').notNull().default(0),
    last_calculated_at: ts('last_calculated_at'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_seg_org').on(t.org_id), index('idx_seg_user').on(t.user_id), index('idx_seg_type').on(t.type)]
)

export const segment_contacts = pgTable(
  'segment_contacts',
  {
    segment_id: text('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
    // No FK on contact_id: preserves the old INSERT-OR-IGNORE leniency (contacts lived
    // in a separate DB). Membership is scoped/cascaded via segment_id.
    contact_id: text('contact_id').notNull(),
    added_at: ts('added_at').defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.segment_id, t.contact_id] }),
    index('idx_sc_segment').on(t.segment_id),
    index('idx_sc_contact').on(t.contact_id),
  ]
)

export type ContactListRow = typeof contact_lists.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type ImportHistoryRow = typeof import_history.$inferSelect
export type SegmentRow = typeof segments.$inferSelect
export type SegmentContactRow = typeof segment_contacts.$inferSelect
