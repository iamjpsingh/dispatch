// src/services/automationService.ts - Email Marketing Automation (Drip Sequences)

import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { eventBus } from './eventBus'
import { logger } from '../utils/logger'
import { generateId } from '../utils/id'
import { evaluateCondition } from './conditionEngine'
import { contactService } from './contactService'
import { whatsappService } from './whatsappService'

// ============================================================================
// Types
// ============================================================================

export type TriggerType = 'list_join' | 'tag_added' | 'score_change' | 'date_field' | 'form_submit' | 'manual' | 'api'
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'completed'
export type StepType =
  | 'send_email' | 'send_whatsapp' | 'send_notification'
  | 'wait' | 'delay_until' | 'send_window'
  | 'condition' | 'has_tag' | 'in_list' | 'score_check' | 'filter' | 'split_test'
  | 'email_opened' | 'email_clicked' | 'form_submitted' | 'whatsapp_delivered' | 'whatsapp_read'
  | 'http_request' | 'score_change'
  | 'update_contact' | 'add_tag' | 'remove_tag' | 'move_to_list'
  | 'add_dnc' | 'remove_dnc'
  | 'webhook' | 'end'
export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'exited'

export interface Automation {
  id: string
  org_id: string
  user_id: string
  name: string
  description: string | null
  trigger_type: TriggerType
  trigger_config: string // JSON
  entry_list_id: string | null
  status: AutomationStatus
  enrolled_count: number
  completed_count: number
  flow_json: string // JSON: full flowchart definition
  created_at: string
  updated_at: string
}

export interface AutomationInput {
  name: string
  description?: string
  trigger_type: TriggerType
  trigger_config?: Record<string, unknown>
  entry_list_id?: string
  flow?: AutomationFlow
}

export interface AutomationStep {
  id: string
  automation_id: string
  step_order: number
  step_type: StepType
  config_json: string // JSON
  next_step_id: string | null
  true_step_id: string | null
  false_step_id: string | null
}

export interface AutomationEnrollment {
  id: string
  automation_id: string
  contact_id: string
  current_step_id: string | null
  status: EnrollmentStatus
  enrolled_at: string
  next_action_at: string | null
  completed_at: string | null
  exit_reason: string | null
}

export interface AutomationFlow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type FlowNode =
  | { id: string; type: 'trigger'; triggerType: TriggerType; config?: Record<string, unknown> }
  | { id: string; type: 'send_email'; templateId: string; subject: string }
  | { id: string; type: 'wait'; duration: number; unit: 'hours' | 'days' | 'weeks' }
  | { id: string; type: 'condition'; field: string; operator: string; value: string }
  | { id: string; type: 'filter'; field: string; operator: string; value: string }
  | { id: string; type: 'split_test'; paths: { label: string; percentage: number }[] }
  | { id: string; type: 'delay_until'; date?: string; field?: string }
  | { id: string; type: 'http_request'; url: string; method: string; headers?: Record<string, string>; bodyTemplate?: string }
  | { id: string; type: 'score_change'; amount: number; reason?: string }
  | { id: string; type: 'update_contact'; field: string; value: string }
  | { id: string; type: 'add_tag'; tag: string }
  | { id: string; type: 'remove_tag'; tag: string }
  | { id: string; type: 'move_to_list'; listId: string }
  | { id: string; type: 'webhook'; url: string; method: 'GET' | 'POST' }
  | { id: string; type: 'end' }

export interface FlowEdge {
  from: string
  to: string
  label?: 'true' | 'false' | 'default'
}

// ============================================================================
// Service
// ============================================================================

class AutomationService {
  private db: Database
  private workerInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    const dbPath = './data/automations.db'
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.initSchema()
    this.registerEventHandlers()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_type TEXT NOT NULL CHECK (trigger_type IN (
          'list_join', 'tag_added', 'score_change', 'date_field', 'manual', 'api'
        )),
        trigger_config TEXT NOT NULL DEFAULT '{}',
        entry_list_id TEXT,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
        enrolled_count INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        flow_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_auto_user ON automations(user_id);
      CREATE INDEX IF NOT EXISTS idx_auto_status ON automations(status);

      CREATE TABLE IF NOT EXISTS automation_steps (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        step_type TEXT NOT NULL CHECK (step_type IN (
          'send_email', 'wait', 'condition', 'update_contact', 'add_tag',
          'remove_tag', 'move_to_list', 'webhook', 'end'
        )),
        config_json TEXT NOT NULL DEFAULT '{}',
        next_step_id TEXT,
        true_step_id TEXT,
        false_step_id TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_as_automation ON automation_steps(automation_id);

      CREATE TABLE IF NOT EXISTS automation_enrollments (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        current_step_id TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'exited')),
        enrolled_at TEXT DEFAULT (datetime('now')),
        next_action_at TEXT,
        completed_at TEXT,
        exit_reason TEXT,
        FOREIGN KEY (automation_id) REFERENCES automations(id),
        UNIQUE(automation_id, contact_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ae_automation ON automation_enrollments(automation_id);
      CREATE INDEX IF NOT EXISTS idx_ae_next ON automation_enrollments(next_action_at) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_ae_contact ON automation_enrollments(contact_id);
    `)

    // Add columns to existing tables (idempotent)
    try { this.db.exec('ALTER TABLE automations ADD COLUMN org_id TEXT') } catch {}
    try { this.db.exec('ALTER TABLE automations ADD COLUMN goal_condition TEXT') } catch {}
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_auto_org ON automations(org_id)')

    // Decision-node wait state: which tracking event an enrollment is waiting
    // for, and the Yes (true) step to jump to if that event arrives before the
    // No-path timeout fires. (idempotent)
    try { this.db.exec('ALTER TABLE automation_enrollments ADD COLUMN waiting_for_event TEXT') } catch {}
    try { this.db.exec('ALTER TABLE automation_enrollments ADD COLUMN wait_true_step_id TEXT') } catch {}

    // Expand step_type CHECK constraint (SQLite doesn't support ALTER CHECK, so new types work via INSERT)
    // New types: send_whatsapp, filter, split_test, delay_until, http_request, score_change

    logger.info('Automations database initialized (data/automations.db)')
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(orgId: string, userId: string, input: AutomationInput): Automation {
    const id = generateId('auto')

    this.db.prepare(`
      INSERT INTO automations (id, org_id, user_id, name, description, trigger_type, trigger_config, entry_list_id, flow_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, orgId, userId, input.name,
      input.description || null,
      input.trigger_type,
      JSON.stringify(input.trigger_config || {}),
      input.entry_list_id || null,
      JSON.stringify(input.flow || { nodes: [], edges: [] })
    )

    return this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Automation
  }

  get(orgId: string, automationId: string): Automation | null {
    return this.db.prepare(`
      SELECT * FROM automations WHERE id = ? AND org_id = ?
    `).get(automationId, orgId) as Automation | null
  }

  update(orgId: string, automationId: string, updates: Partial<AutomationInput> & { goal_condition?: string | null; flow_json?: string }): boolean {
    const sets: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description) }
    if (updates.trigger_type !== undefined) { sets.push('trigger_type = ?'); params.push(updates.trigger_type) }
    if (updates.trigger_config !== undefined) { sets.push('trigger_config = ?'); params.push(JSON.stringify(updates.trigger_config)) }
    if (updates.entry_list_id !== undefined) { sets.push('entry_list_id = ?'); params.push(updates.entry_list_id) }
    if (updates.flow !== undefined) { sets.push('flow_json = ?'); params.push(JSON.stringify(updates.flow)) }
    if (updates.flow_json !== undefined) { sets.push('flow_json = ?'); params.push(updates.flow_json) }
    if (updates.goal_condition !== undefined) { sets.push('goal_condition = ?'); params.push(updates.goal_condition) }

    if (sets.length === 0) return false

    sets.push("updated_at = datetime('now')")
    params.push(automationId, orgId)

    const result = this.db.prepare(`
      UPDATE automations SET ${sets.join(', ')} WHERE id = ? AND org_id = ? AND status IN ('draft', 'paused')
    `).run(...params)

    return result.changes > 0
  }

  delete(orgId: string, automationId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM automations WHERE id = ? AND org_id = ? AND status IN ('draft', 'completed')
    `).run(automationId, orgId)
    return result.changes > 0
  }

  list(orgId: string): Automation[] {
    return this.db.prepare(`
      SELECT * FROM automations WHERE org_id = ? ORDER BY updated_at DESC
    `).all(orgId) as Automation[]
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  activate(orgId: string, automationId: string): boolean {
    // First, compile flow into steps
    const automation = this.get(orgId, automationId)
    if (!automation) return false

    const flow: AutomationFlow = JSON.parse(automation.flow_json)
    this.compileFlowToSteps(automationId, flow)

    const result = this.db.prepare(`
      UPDATE automations SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND status IN ('draft', 'paused')
    `).run(automationId, orgId)

    return result.changes > 0
  }

  pause(orgId: string, automationId: string): boolean {
    const result = this.db.prepare(`
      UPDATE automations SET status = 'paused', updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND status = 'active'
    `).run(automationId, orgId)
    return result.changes > 0
  }

  deactivate(orgId: string, automationId: string): boolean {
    const result = this.db.prepare(`
      UPDATE automations SET status = 'completed', updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
    `).run(automationId, orgId)
    return result.changes > 0
  }

  // --------------------------------------------------------------------------
  // Enrollment
  // --------------------------------------------------------------------------

  enrollContact(automationId: string, contactId: string): boolean {
    const firstStep = this.db.prepare(`
      SELECT id FROM automation_steps WHERE automation_id = ? ORDER BY step_order ASC LIMIT 1
    `).get(automationId) as { id: string } | null

    if (!firstStep) return false

    const id = generateId('enr')

    try {
      this.db.prepare(`
        INSERT INTO automation_enrollments (id, automation_id, contact_id, current_step_id, next_action_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(id, automationId, contactId, firstStep.id)

      this.db.prepare(`
        UPDATE automations SET enrolled_count = enrolled_count + 1 WHERE id = ?
      `).run(automationId)

      return true
    } catch {
      // Duplicate enrollment
      return false
    }
  }

  exitContact(automationId: string, contactId: string, reason: string): boolean {
    const result = this.db.prepare(`
      UPDATE automation_enrollments
      SET status = 'exited', exit_reason = ?, completed_at = datetime('now')
      WHERE automation_id = ? AND contact_id = ? AND status = 'active'
    `).run(reason, automationId, contactId)
    return result.changes > 0
  }

  getEnrollments(automationId: string, limit = 50, offset = 0): AutomationEnrollment[] {
    return this.db.prepare(`
      SELECT * FROM automation_enrollments WHERE automation_id = ?
      ORDER BY enrolled_at DESC LIMIT ? OFFSET ?
    `).all(automationId, limit, offset) as AutomationEnrollment[]
  }

  // --------------------------------------------------------------------------
  // Steps
  // --------------------------------------------------------------------------

  getSteps(automationId: string): AutomationStep[] {
    return this.db.prepare(`
      SELECT * FROM automation_steps WHERE automation_id = ? ORDER BY step_order
    `).all(automationId) as AutomationStep[]
  }

  private compileFlowToSteps(automationId: string, flow: AutomationFlow): void {
    // Clear existing steps
    this.db.prepare('DELETE FROM automation_steps WHERE automation_id = ?').run(automationId)

    if (!flow.nodes || flow.nodes.length === 0) return

    const stmt = this.db.prepare(`
      INSERT INTO automation_steps (id, automation_id, step_order, step_type, config_json, next_step_id, true_step_id, false_step_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < flow.nodes.length; i++) {
        const node = flow.nodes[i]
        const stepId = `step_${automationId}_${i}`

        // Find outgoing edges
        const defaultEdge = flow.edges.find(e => e.from === node.id && (!e.label || e.label === 'default'))
        const trueEdge = flow.edges.find(e => e.from === node.id && e.label === 'true')
        const falseEdge = flow.edges.find(e => e.from === node.id && e.label === 'false')

        // Map edge targets to step IDs
        const findStepId = (nodeId: string) => {
          const idx = flow.nodes.findIndex(n => n.id === nodeId)
          return idx >= 0 ? `step_${automationId}_${idx}` : null
        }

        const { id: _, type, ...config } = node as any

        stmt.run(
          stepId,
          automationId,
          i,
          type,
          JSON.stringify(config),
          defaultEdge ? findStepId(defaultEdge.to) : null,
          trueEdge ? findStepId(trueEdge.to) : null,
          falseEdge ? findStepId(falseEdge.to) : null
        )
      }
    })

    transaction()
  }

  // --------------------------------------------------------------------------
  // Worker (process due enrollments)
  // --------------------------------------------------------------------------

  /**
   * Process all due enrollment actions. Called by worker interval.
   * Returns number of enrollments processed.
   */
  async processDueActions(): Promise<number> {
    const due = this.db.prepare(`
      SELECT e.*, s.step_type, s.config_json, s.next_step_id, s.true_step_id, s.false_step_id, a.org_id
      FROM automation_enrollments e
      JOIN automation_steps s ON e.current_step_id = s.id
      JOIN automations a ON e.automation_id = a.id
      WHERE e.status = 'active' AND e.next_action_at <= datetime('now')
      ORDER BY e.next_action_at
      LIMIT 100
    `).all() as (AutomationEnrollment & { step_type: StepType; config_json: string; next_step_id: string | null; true_step_id: string | null; false_step_id: string | null; org_id: string })[]

    let processed = 0

    for (const enrollment of due) {
      try {
        // Check goal condition before executing step
        if (await this.checkGoal(enrollment)) {
          this.exitWithGoal(enrollment.id, enrollment.automation_id)
          processed++
          continue
        }

        await this.executeStep(enrollment)
        processed++
      } catch (err) {
        logger.error(`Automation step error for enrollment ${enrollment.id}:`, err)
      }
    }

    return processed
  }

  private async executeStep(enrollment: AutomationEnrollment & { step_type: StepType; config_json: string; next_step_id: string | null; true_step_id: string | null; false_step_id: string | null; org_id: string }): Promise<void> {
    const config = JSON.parse(enrollment.config_json)

    switch (enrollment.step_type) {
      case 'send_email':
        // Emit event - the email sending is handled by the queue/campaign system
        eventBus.emit('automation_step_completed', '', {
          automationId: enrollment.automation_id,
          contactId: enrollment.contact_id,
          stepType: 'send_email',
          templateId: config.templateId,
          subject: config.subject,
        })
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break

      case 'send_whatsapp': {
        // Send WhatsApp template message to contact
        const waContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        const customFields = waContact?.custom_fields ? JSON.parse(waContact.custom_fields) : {}
        const phone = waContact?.phone || customFields.phone || customFields.phone_number || null
        if (phone && config.config_id && config.template_name) {
          whatsappService.sendTemplate(enrollment.org_id || '', config.config_id, {
            phone,
            template_name: config.template_name,
            language: config.language || 'en',
            components: config.components || [],
            contact_id: enrollment.contact_id,
          }).catch((err) => logger.error('WhatsApp automation send error:', err))
        } else {
          logger.warn(`WhatsApp step skipped: missing phone/config for contact ${enrollment.contact_id}`)
        }
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'wait': {
        const duration = config.duration || 1
        const unit = config.unit || 'days'
        const delayMs = this.unitToMs(duration, unit)
        const nextAt = new Date(Date.now() + delayMs).toISOString()

        // Move to next step but schedule the action time
        this.db.prepare(`
          UPDATE automation_enrollments SET current_step_id = ?, next_action_at = ? WHERE id = ?
        `).run(enrollment.next_step_id, nextAt, enrollment.id)
        break
      }

      case 'condition': {
        // Evaluate condition against contact data
        const contact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        if (contact) {
          const result = evaluateCondition(contact, { field: config.field, operator: config.operator, value: config.value })
          this.advanceToNext(enrollment.id, result ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        } else {
          // Contact not found — take false branch
          this.advanceToNext(enrollment.id, enrollment.false_step_id || enrollment.next_step_id)
        }
        break
      }

      case 'filter': {
        // Filter is like condition but only has one output (pass or exit)
        const filterContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        if (filterContact && evaluateCondition(filterContact, { field: config.field, operator: config.operator, value: config.value })) {
          this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          // Filtered out — exit automation
          this.db.prepare(`
            UPDATE automation_enrollments SET status = 'exited', exit_reason = 'filtered', completed_at = datetime('now') WHERE id = ?
          `).run(enrollment.id)
        }
        break
      }

      case 'split_test': {
        // A/B split — randomly choose path based on percentages
        const paths: { label: string; percentage: number }[] = config.paths || []
        const rand = Math.random() * 100
        let cumulative = 0
        let chosenIndex = 0
        for (let i = 0; i < paths.length; i++) {
          cumulative += paths[i].percentage
          if (rand < cumulative) { chosenIndex = i; break }
        }
        // For split tests, step has multiple next_step references encoded in config
        const nextSteps: string[] = config.next_steps || []
        this.advanceToNext(enrollment.id, nextSteps[chosenIndex] || enrollment.next_step_id)
        break
      }

      case 'delay_until': {
        // Wait until a specific date or contact field date
        let targetDate: string
        if (config.field) {
          const dateContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
          const customFields = dateContact ? JSON.parse(dateContact.custom_fields || '{}') : {}
          targetDate = customFields[config.field] || new Date().toISOString()
        } else {
          targetDate = config.date || new Date().toISOString()
        }
        if (new Date(targetDate) <= new Date()) {
          this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          this.db.prepare(`
            UPDATE automation_enrollments SET next_action_at = ? WHERE id = ?
          `).run(targetDate, enrollment.id)
        }
        break
      }

      case 'http_request': {
        // Call external API
        const url = config.url
        if (url) {
          fetch(url, {
            method: config.method || 'POST',
            headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
            body: config.bodyTemplate || JSON.stringify({ contactId: enrollment.contact_id }),
          }).catch((err) => logger.error('HTTP request node error:', err))
        }
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'score_change': {
        // Change engagement score
        eventBus.emit('automation_step_completed', '', {
          automationId: enrollment.automation_id,
          contactId: enrollment.contact_id,
          stepType: 'score_change',
          amount: config.amount || 0,
          reason: config.reason || 'automation',
        })
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'add_tag':
      case 'remove_tag':
      case 'update_contact':
      case 'move_to_list':
      case 'add_dnc':
      case 'remove_dnc':
        // Emit event for contact updates
        eventBus.emit('automation_step_completed', '', {
          automationId: enrollment.automation_id,
          contactId: enrollment.contact_id,
          stepType: enrollment.step_type,
          config,
        })
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break

      case 'send_notification': {
        // Internal team notification
        eventBus.emit('automation_step_completed', '', {
          automationId: enrollment.automation_id,
          contactId: enrollment.contact_id,
          stepType: 'send_notification',
          to_email: config.to_email,
          subject: config.subject,
          message: config.message,
        })
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'has_tag': {
        // Condition: check if contact has a specific tag
        const tagContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        const tags = tagContact?.tags ? tagContact.tags.split(',').map((t: string) => t.trim().toLowerCase()) : []
        const hasTag = tags.includes((config.tag || '').toLowerCase())
        this.advanceToNext(enrollment.id, hasTag ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        break
      }

      case 'in_list': {
        // Condition: check if contact is in a specific list
        const inListResult = config.list_id ? true : false // Simplified — would need contactService.isInList()
        this.advanceToNext(enrollment.id, inListResult ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        break
      }

      case 'score_check': {
        // Condition: check engagement score against threshold
        const scoreContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        const score = scoreContact?.engagement_score || 0
        const threshold = config.value || 0
        let scoreResult = false
        switch (config.operator) {
          case 'greater_than': scoreResult = score > threshold; break
          case 'less_than': scoreResult = score < threshold; break
          case 'greater_equal': scoreResult = score >= threshold; break
          case 'less_equal': scoreResult = score <= threshold; break
          case 'equals': scoreResult = score === threshold; break
        }
        this.advanceToNext(enrollment.id, scoreResult ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        break
      }

      // Decision nodes (email_opened, email_clicked, etc.) work with timing:
      // They set a wait period. If the event happens within the wait, take Yes path.
      // If not, after the wait expires, take No path.
      case 'email_opened':
      case 'email_clicked':
      case 'form_submitted':
      case 'whatsapp_delivered':
      case 'whatsapp_read': {
        // Decision nodes are event-driven with a timeout fallback:
        //  - We park on the No (false) branch with a future next_action_at, so if
        //    the awaited event NEVER arrives the timeout takes the No path.
        //  - We persist (waiting_for_event, wait_true_step_id) so that when the
        //    matching tracking event arrives, handleTrackingEvent() redirects the
        //    enrollment to the Yes (true) branch and fires it immediately.
        const waitDuration = config.wait_duration || 1
        const waitUnit = config.wait_unit || 'days'
        const delayMs = this.unitToMs(waitDuration, waitUnit)
        const nextAt = new Date(Date.now() + delayMs).toISOString()

        const trueStepId = enrollment.true_step_id || enrollment.next_step_id

        this.db.prepare(`
          UPDATE automation_enrollments
          SET current_step_id = ?, next_action_at = ?, waiting_for_event = ?, wait_true_step_id = ?
          WHERE id = ?
        `).run(
          enrollment.false_step_id || enrollment.next_step_id,
          nextAt,
          enrollment.step_type,
          trueStepId,
          enrollment.id
        )
        break
      }

      case 'send_window': {
        // Only proceed during specific hours/days
        const now = new Date()
        const hour = now.getHours()
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const today = dayNames[now.getDay()]
        const startHour = config.start_hour ?? 0
        const endHour = config.end_hour ?? 23
        const allowedDays = config.days ? config.days.split(',').map((d: string) => d.trim().toLowerCase()) : dayNames

        if (hour >= startHour && hour <= endHour && allowedDays.includes(today)) {
          this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          // Wait 1 hour and check again
          const nextCheck = new Date(Date.now() + 3600000).toISOString()
          this.db.prepare(`UPDATE automation_enrollments SET next_action_at = ? WHERE id = ?`).run(nextCheck, enrollment.id)
        }
        break
      }

      case 'webhook':
        // Fire webhook
        if (config.url) {
          fetch(config.url, {
            method: config.method || 'POST',
            headers: { 'Content-Type': 'application/json', ...(config.headers ? JSON.parse(config.headers) : {}) },
            body: JSON.stringify({ contactId: enrollment.contact_id, automationId: enrollment.automation_id }),
          }).catch(() => {})
        }
        this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break

      case 'end':
        this.db.prepare(`
          UPDATE automation_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?
        `).run(enrollment.id)
        this.db.prepare(`
          UPDATE automations SET completed_count = completed_count + 1 WHERE id = ?
        `).run(enrollment.automation_id)
        break
    }
  }

  /**
   * Check if a contact has achieved the automation's goal.
   * If goal is met, the enrollment should exit early.
   */
  private async checkGoal(enrollment: { id: string; automation_id: string; contact_id: string; org_id: string }): Promise<boolean> {
    const automation = this.db.prepare('SELECT goal_condition FROM automations WHERE id = ?').get(enrollment.automation_id) as any
    if (!automation?.goal_condition) return false

    try {
      const goal = JSON.parse(automation.goal_condition) as { field: string; operator: string; value: string }
      if (!goal.field) return false

      const contact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
      if (!contact) return false

      return evaluateCondition(contact, goal)
    } catch {
      return false
    }
  }

  /**
   * Exit an enrollment because the goal was achieved.
   */
  private exitWithGoal(enrollmentId: string, automationId: string): void {
    this.db.prepare(`
      UPDATE automation_enrollments
      SET status = 'exited', exit_reason = 'goal_achieved', completed_at = datetime('now')
      WHERE id = ?
    `).run(enrollmentId)

    this.db.prepare(`
      UPDATE automations SET completed_count = completed_count + 1 WHERE id = ?
    `).run(automationId)

    logger.info(`[Automation] Enrollment ${enrollmentId} exited — goal achieved`)
  }

  private advanceToNext(enrollmentId: string, nextStepId: string | null): void {
    if (!nextStepId) {
      // No next step - complete the enrollment
      this.db.prepare(`
        UPDATE automation_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?
      `).run(enrollmentId)
      return
    }

    this.db.prepare(`
      UPDATE automation_enrollments SET current_step_id = ?, next_action_at = datetime('now') WHERE id = ?
    `).run(nextStepId, enrollmentId)
  }

  private unitToMs(duration: number, unit: string): number {
    switch (unit) {
      case 'hours': return duration * 60 * 60 * 1000
      case 'days': return duration * 24 * 60 * 60 * 1000
      case 'weeks': return duration * 7 * 24 * 60 * 60 * 1000
      default: return duration * 24 * 60 * 60 * 1000
    }
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getStats(automationId: string): { enrolled: number; active: number; completed: number; exited: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as enrolled,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'exited' THEN 1 ELSE 0 END) as exited
      FROM automation_enrollments WHERE automation_id = ?
    `).get(automationId) as any

    return {
      enrolled: row.enrolled || 0,
      active: row.active || 0,
      completed: row.completed || 0,
      exited: row.exited || 0,
    }
  }

  // --------------------------------------------------------------------------
  // Event-driven decision advancement
  // --------------------------------------------------------------------------

  /**
   * Advance any enrollments that are parked on a decision node waiting for the
   * given tracking event for the given contact, onto their Yes (true) branch.
   *
   * Sets next_action_at = now so the next processDueActions() tick executes the
   * Yes-branch step immediately, and clears the wait state so the No-path
   * timeout no longer applies. Returns the number of enrollments advanced.
   */
  handleTrackingEvent(eventType: string, contactId: string): number {
    const result = this.db.prepare(`
      UPDATE automation_enrollments
      SET current_step_id = wait_true_step_id,
          next_action_at = datetime('now'),
          waiting_for_event = NULL
      WHERE contact_id = ?
        AND waiting_for_event = ?
        AND status = 'active'
        AND wait_true_step_id IS NOT NULL
    `).run(contactId, eventType)
    return result.changes
  }

  /**
   * Subscribe to tracking events so decision nodes can branch to Yes in real
   * time. Registered once from the constructor (not startWorker, which may be
   * called multiple times) to avoid duplicate handlers.
   */
  private registerEventHandlers(): void {
    const advance = (eventType: string) => (e: { contactId?: string }) => {
      if (e.contactId) this.handleTrackingEvent(eventType, e.contactId)
    }
    eventBus.on('email_opened', advance('email_opened'))
    eventBus.on('email_clicked', advance('email_clicked'))
  }

  /**
   * Start the automation worker (polls every 60 seconds)
   */
  startWorker(intervalMs = 60000): void {
    if (this.workerInterval) return

    this.workerInterval = setInterval(async () => {
      const processed = await this.processDueActions()
      if (processed > 0) {
        logger.debug(`Automation worker processed ${processed} actions`)
      }
    }, intervalMs)

    logger.startup('   Automation worker started (60s interval)')
  }

  stopWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval)
      this.workerInterval = null
    }
  }
}

export const automationService = new AutomationService()
