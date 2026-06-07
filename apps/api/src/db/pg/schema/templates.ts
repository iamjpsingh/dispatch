// Templates domain (P2.3). Mirrors existing SQLite contracts: snake_case keys,
// JSON-as-text (variables), integer flags/counts, ISO-string timestamps.
// NOTE: starter templates are system-wide — org_id IS NULL + is_starter=1 + a
// sentinel user_id '__system__'. So templates.org_id is NULLABLE (FK still enforced
// for non-null) and user_id is plain text (no FK — the sentinel is not a real user),
// matching the original (which had no cross-DB FK on user_id).
import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    // null org_id = system starter template (visible to every org)
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('general'),
    subject: text('subject'),
    html_content: text('html_content').notNull(),
    text_content: text('text_content'),
    variables: text('variables').notNull().default('[]'),
    mjml_source: text('mjml_source'),
    is_starter: integer('is_starter').notNull().default(0),
    version: integer('version').notNull().default(1),
    parent_id: text('parent_id'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_tpl_org').on(t.org_id),
    index('idx_tpl_user').on(t.user_id),
    index('idx_tpl_category').on(t.category),
    index('idx_tpl_starter').on(t.is_starter),
    index('idx_tpl_parent').on(t.parent_id),
  ]
)

export const template_sections = pgTable(
  'template_sections',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('general'),
    html_content: text('html_content').notNull(),
    thumbnail: text('thumbnail'),
    usage_count: integer('usage_count').notNull().default(0),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ts_org').on(t.org_id), index('idx_ts_category').on(t.category)]
)

export type TemplateRow = typeof templates.$inferSelect
export type TemplateSectionRow = typeof template_sections.$inferSelect
