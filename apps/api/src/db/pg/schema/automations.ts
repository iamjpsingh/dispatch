// Automations domain (P2.5). Mirrors existing SQLite contracts: snake_case keys,
// JSON-as-text (trigger_config/flow_json/config_json/goal_condition), integer counts,
// ISO timestamps. org_id → organizations FK (nullable for legacy rows); automation_id
// FKs cascade; contact_id stays loose text (cross-entity pointer, as before).
import { pgTable, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const automations = pgTable(
  'automations',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    trigger_type: text('trigger_type').notNull(),
    trigger_config: text('trigger_config').notNull().default('{}'),
    entry_list_id: text('entry_list_id'),
    status: text('status').notNull().default('draft'),
    enrolled_count: integer('enrolled_count').notNull().default(0),
    completed_count: integer('completed_count').notNull().default(0),
    flow_json: text('flow_json').notNull().default('{"nodes":[],"edges":[]}'),
    goal_condition: text('goal_condition'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_auto_org').on(t.org_id), index('idx_auto_user').on(t.user_id), index('idx_auto_status').on(t.status)]
)

export const automation_steps = pgTable(
  'automation_steps',
  {
    id: text('id').primaryKey(),
    automation_id: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
    step_order: integer('step_order').notNull(),
    step_type: text('step_type').notNull(),
    config_json: text('config_json').notNull().default('{}'),
    next_step_id: text('next_step_id'),
    true_step_id: text('true_step_id'),
    false_step_id: text('false_step_id'),
  },
  (t) => [index('idx_as_automation').on(t.automation_id)]
)

export const automation_enrollments = pgTable(
  'automation_enrollments',
  {
    id: text('id').primaryKey(),
    automation_id: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
    contact_id: text('contact_id').notNull(),
    current_step_id: text('current_step_id'),
    status: text('status').notNull().default('active'),
    enrolled_at: ts('enrolled_at').defaultNow(),
    next_action_at: ts('next_action_at'),
    completed_at: ts('completed_at'),
    exit_reason: text('exit_reason'),
    waiting_for_event: text('waiting_for_event'),
    wait_true_step_id: text('wait_true_step_id'),
  },
  (t) => [
    unique('uq_enroll_automation_contact').on(t.automation_id, t.contact_id),
    index('idx_ae_automation').on(t.automation_id),
    index('idx_ae_next').on(t.next_action_at),
    index('idx_ae_contact').on(t.contact_id),
  ]
)

export type AutomationRow = typeof automations.$inferSelect
export type AutomationStepRow = typeof automation_steps.$inferSelect
export type AutomationEnrollmentRow = typeof automation_enrollments.$inferSelect
