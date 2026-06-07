// src/services/automationService.ts - Email Marketing Automation (Drip Sequences) (Postgres/Drizzle, async)

import { and, eq, asc, desc, lte, inArray, isNotNull, count, sql } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { automations, automation_steps, automation_enrollments } from '../db/pg/schema'
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

const now = () => new Date().toISOString()

// ============================================================================
// Service
// ============================================================================

class AutomationService {
  private workerInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.registerEventHandlers()
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(orgId: string, userId: string, input: AutomationInput): Promise<Automation> {
    const db = getDb()
    const id = generateId('auto')

    await db.insert(automations).values({
      id,
      org_id: orgId,
      user_id: userId,
      name: input.name,
      description: input.description || null,
      trigger_type: input.trigger_type,
      trigger_config: JSON.stringify(input.trigger_config || {}),
      entry_list_id: input.entry_list_id || null,
      flow_json: JSON.stringify(input.flow || { nodes: [], edges: [] }),
    })

    const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1)
    return row as Automation
  }

  async get(orgId: string, automationId: string): Promise<Automation | null> {
    const [row] = await getDb()
      .select()
      .from(automations)
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId)))
      .limit(1)
    return (row as Automation) ?? null
  }

  async update(orgId: string, automationId: string, updates: Partial<AutomationInput> & { goal_condition?: string | null; flow_json?: string }): Promise<boolean> {
    const u = updates
    const values: Partial<typeof automations.$inferInsert> = {}

    if (u.name !== undefined) values.name = u.name
    if (u.description !== undefined) values.description = u.description
    if (u.trigger_type !== undefined) values.trigger_type = u.trigger_type
    if (u.trigger_config !== undefined) values.trigger_config = JSON.stringify(u.trigger_config)
    if (u.entry_list_id !== undefined) values.entry_list_id = u.entry_list_id
    if (u.flow !== undefined) values.flow_json = JSON.stringify(u.flow)
    if (u.flow_json !== undefined) values.flow_json = u.flow_json
    if (u.goal_condition !== undefined) values.goal_condition = u.goal_condition

    if (Object.keys(values).length === 0) return false

    values.updated_at = now()

    const res = await getDb()
      .update(automations)
      .set(values)
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId), inArray(automations.status, ['draft', 'paused'])))
      .returning({ id: automations.id })
    return res.length > 0
  }

  async delete(orgId: string, automationId: string): Promise<boolean> {
    const res = await getDb()
      .delete(automations)
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId), inArray(automations.status, ['draft', 'completed'])))
      .returning({ id: automations.id })
    return res.length > 0
  }

  async list(orgId: string): Promise<Automation[]> {
    const rows = await getDb()
      .select()
      .from(automations)
      .where(eq(automations.org_id, orgId))
      .orderBy(desc(automations.updated_at))
    return rows as Automation[]
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async activate(orgId: string, automationId: string): Promise<boolean> {
    // First, compile flow into steps
    const automation = await this.get(orgId, automationId)
    if (!automation) return false

    const flow: AutomationFlow = JSON.parse(automation.flow_json)
    await this.compileFlowToSteps(automationId, flow)

    const res = await getDb()
      .update(automations)
      .set({ status: 'active', updated_at: now() })
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId), inArray(automations.status, ['draft', 'paused'])))
      .returning({ id: automations.id })

    return res.length > 0
  }

  async pause(orgId: string, automationId: string): Promise<boolean> {
    const res = await getDb()
      .update(automations)
      .set({ status: 'paused', updated_at: now() })
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId), eq(automations.status, 'active')))
      .returning({ id: automations.id })
    return res.length > 0
  }

  async deactivate(orgId: string, automationId: string): Promise<boolean> {
    const res = await getDb()
      .update(automations)
      .set({ status: 'completed', updated_at: now() })
      .where(and(eq(automations.id, automationId), eq(automations.org_id, orgId)))
      .returning({ id: automations.id })
    return res.length > 0
  }

  // --------------------------------------------------------------------------
  // Enrollment
  // --------------------------------------------------------------------------

  async enrollContact(automationId: string, contactId: string): Promise<boolean> {
    const db = getDb()

    const [firstStep] = await db
      .select({ id: automation_steps.id })
      .from(automation_steps)
      .where(eq(automation_steps.automation_id, automationId))
      .orderBy(asc(automation_steps.step_order))
      .limit(1)

    if (!firstStep) return false

    const id = generateId('enr')

    // UNIQUE(automation_id, contact_id) — ignore duplicate enrollments.
    const inserted = await db
      .insert(automation_enrollments)
      .values({
        id,
        automation_id: automationId,
        contact_id: contactId,
        current_step_id: firstStep.id,
        next_action_at: now(),
      })
      .onConflictDoNothing({ target: [automation_enrollments.automation_id, automation_enrollments.contact_id] })
      .returning({ id: automation_enrollments.id })

    if (inserted.length === 0) {
      // Duplicate enrollment
      return false
    }

    await db
      .update(automations)
      .set({ enrolled_count: sql`${automations.enrolled_count} + 1` })
      .where(eq(automations.id, automationId))

    return true
  }

  async exitContact(automationId: string, contactId: string, reason: string): Promise<boolean> {
    const res = await getDb()
      .update(automation_enrollments)
      .set({ status: 'exited', exit_reason: reason, completed_at: now() })
      .where(and(
        eq(automation_enrollments.automation_id, automationId),
        eq(automation_enrollments.contact_id, contactId),
        eq(automation_enrollments.status, 'active'),
      ))
      .returning({ id: automation_enrollments.id })
    return res.length > 0
  }

  async getEnrollments(automationId: string, limit = 50, offset = 0): Promise<AutomationEnrollment[]> {
    const rows = await getDb()
      .select()
      .from(automation_enrollments)
      .where(eq(automation_enrollments.automation_id, automationId))
      .orderBy(desc(automation_enrollments.enrolled_at))
      .limit(limit)
      .offset(offset)
    return rows as AutomationEnrollment[]
  }

  // --------------------------------------------------------------------------
  // Steps
  // --------------------------------------------------------------------------

  async getSteps(automationId: string): Promise<AutomationStep[]> {
    const rows = await getDb()
      .select()
      .from(automation_steps)
      .where(eq(automation_steps.automation_id, automationId))
      .orderBy(asc(automation_steps.step_order))
    return rows as AutomationStep[]
  }

  private async compileFlowToSteps(automationId: string, flow: AutomationFlow): Promise<void> {
    const db = getDb()

    // Clear existing steps
    await db.delete(automation_steps).where(eq(automation_steps.automation_id, automationId))

    if (!flow.nodes || flow.nodes.length === 0) return

    const rows: (typeof automation_steps.$inferInsert)[] = []

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

      rows.push({
        id: stepId,
        automation_id: automationId,
        step_order: i,
        step_type: type,
        config_json: JSON.stringify(config),
        next_step_id: defaultEdge ? findStepId(defaultEdge.to) : null,
        true_step_id: trueEdge ? findStepId(trueEdge.to) : null,
        false_step_id: falseEdge ? findStepId(falseEdge.to) : null,
      })
    }

    await db.insert(automation_steps).values(rows)
  }

  // --------------------------------------------------------------------------
  // Worker (process due enrollments)
  // --------------------------------------------------------------------------

  /**
   * Process all due enrollment actions. Called by worker interval.
   * Returns number of enrollments processed.
   */
  async processDueActions(): Promise<number> {
    const due = await getDb()
      .select({
        id: automation_enrollments.id,
        automation_id: automation_enrollments.automation_id,
        contact_id: automation_enrollments.contact_id,
        current_step_id: automation_enrollments.current_step_id,
        status: automation_enrollments.status,
        enrolled_at: automation_enrollments.enrolled_at,
        next_action_at: automation_enrollments.next_action_at,
        completed_at: automation_enrollments.completed_at,
        exit_reason: automation_enrollments.exit_reason,
        step_type: automation_steps.step_type,
        config_json: automation_steps.config_json,
        next_step_id: automation_steps.next_step_id,
        true_step_id: automation_steps.true_step_id,
        false_step_id: automation_steps.false_step_id,
        org_id: automations.org_id,
      })
      .from(automation_enrollments)
      .innerJoin(automation_steps, eq(automation_enrollments.current_step_id, automation_steps.id))
      .innerJoin(automations, eq(automation_enrollments.automation_id, automations.id))
      .where(and(eq(automation_enrollments.status, 'active'), lte(automation_enrollments.next_action_at, now())))
      .orderBy(asc(automation_enrollments.next_action_at))
      .limit(100) as (AutomationEnrollment & { step_type: StepType; config_json: string; next_step_id: string | null; true_step_id: string | null; false_step_id: string | null; org_id: string })[]

    let processed = 0

    for (const enrollment of due) {
      try {
        // Check goal condition before executing step
        if (await this.checkGoal(enrollment)) {
          await this.exitWithGoal(enrollment.id, enrollment.automation_id)
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'wait': {
        const duration = config.duration || 1
        const unit = config.unit || 'days'
        const delayMs = this.unitToMs(duration, unit)
        const nextAt = new Date(Date.now() + delayMs).toISOString()

        // Move to next step but schedule the action time
        await getDb()
          .update(automation_enrollments)
          .set({ current_step_id: enrollment.next_step_id, next_action_at: nextAt })
          .where(eq(automation_enrollments.id, enrollment.id))
        break
      }

      case 'condition': {
        // Evaluate condition against contact data
        const contact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        if (contact) {
          const result = evaluateCondition(contact, { field: config.field, operator: config.operator, value: config.value })
          await this.advanceToNext(enrollment.id, result ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        } else {
          // Contact not found — take false branch
          await this.advanceToNext(enrollment.id, enrollment.false_step_id || enrollment.next_step_id)
        }
        break
      }

      case 'filter': {
        // Filter is like condition but only has one output (pass or exit)
        const filterContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        if (filterContact && evaluateCondition(filterContact, { field: config.field, operator: config.operator, value: config.value })) {
          await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          // Filtered out — exit automation
          await getDb()
            .update(automation_enrollments)
            .set({ status: 'exited', exit_reason: 'filtered', completed_at: now() })
            .where(eq(automation_enrollments.id, enrollment.id))
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
        await this.advanceToNext(enrollment.id, nextSteps[chosenIndex] || enrollment.next_step_id)
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
          await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          await getDb()
            .update(automation_enrollments)
            .set({ next_action_at: targetDate })
            .where(eq(automation_enrollments.id, enrollment.id))
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break
      }

      case 'has_tag': {
        // Condition: check if contact has a specific tag
        const tagContact = await contactService.getContact(enrollment.org_id || '', enrollment.contact_id)
        const tags = tagContact?.tags ? tagContact.tags.split(',').map((t: string) => t.trim().toLowerCase()) : []
        const hasTag = tags.includes((config.tag || '').toLowerCase())
        await this.advanceToNext(enrollment.id, hasTag ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
        break
      }

      case 'in_list': {
        // Condition: check if contact is in a specific list
        const inListResult = config.list_id ? true : false // Simplified — would need contactService.isInList()
        await this.advanceToNext(enrollment.id, inListResult ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
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
        await this.advanceToNext(enrollment.id, scoreResult ? (enrollment.true_step_id || enrollment.next_step_id) : (enrollment.false_step_id || enrollment.next_step_id))
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

        await getDb()
          .update(automation_enrollments)
          .set({
            current_step_id: enrollment.false_step_id || enrollment.next_step_id,
            next_action_at: nextAt,
            waiting_for_event: enrollment.step_type,
            wait_true_step_id: trueStepId,
          })
          .where(eq(automation_enrollments.id, enrollment.id))
        break
      }

      case 'send_window': {
        // Only proceed during specific hours/days
        const nowDate = new Date()
        const hour = nowDate.getHours()
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const today = dayNames[nowDate.getDay()]
        const startHour = config.start_hour ?? 0
        const endHour = config.end_hour ?? 23
        const allowedDays = config.days ? config.days.split(',').map((d: string) => d.trim().toLowerCase()) : dayNames

        if (hour >= startHour && hour <= endHour && allowedDays.includes(today)) {
          await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        } else {
          // Wait 1 hour and check again
          const nextCheck = new Date(Date.now() + 3600000).toISOString()
          await getDb()
            .update(automation_enrollments)
            .set({ next_action_at: nextCheck })
            .where(eq(automation_enrollments.id, enrollment.id))
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
        await this.advanceToNext(enrollment.id, enrollment.next_step_id)
        break

      case 'end':
        await getDb()
          .update(automation_enrollments)
          .set({ status: 'completed', completed_at: now() })
          .where(eq(automation_enrollments.id, enrollment.id))
        await getDb()
          .update(automations)
          .set({ completed_count: sql`${automations.completed_count} + 1` })
          .where(eq(automations.id, enrollment.automation_id))
        break
    }
  }

  /**
   * Check if a contact has achieved the automation's goal.
   * If goal is met, the enrollment should exit early.
   */
  private async checkGoal(enrollment: { id: string; automation_id: string; contact_id: string; org_id: string }): Promise<boolean> {
    const [automation] = await getDb()
      .select({ goal_condition: automations.goal_condition })
      .from(automations)
      .where(eq(automations.id, enrollment.automation_id))
      .limit(1)
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
  private async exitWithGoal(enrollmentId: string, automationId: string): Promise<void> {
    await getDb()
      .update(automation_enrollments)
      .set({ status: 'exited', exit_reason: 'goal_achieved', completed_at: now() })
      .where(eq(automation_enrollments.id, enrollmentId))

    await getDb()
      .update(automations)
      .set({ completed_count: sql`${automations.completed_count} + 1` })
      .where(eq(automations.id, automationId))

    logger.info(`[Automation] Enrollment ${enrollmentId} exited — goal achieved`)
  }

  private async advanceToNext(enrollmentId: string, nextStepId: string | null): Promise<void> {
    if (!nextStepId) {
      // No next step - complete the enrollment
      await getDb()
        .update(automation_enrollments)
        .set({ status: 'completed', completed_at: now() })
        .where(eq(automation_enrollments.id, enrollmentId))
      return
    }

    await getDb()
      .update(automation_enrollments)
      .set({ current_step_id: nextStepId, next_action_at: now() })
      .where(eq(automation_enrollments.id, enrollmentId))
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

  async getStats(automationId: string): Promise<{ enrolled: number; active: number; completed: number; exited: number }> {
    const [row] = await getDb()
      .select({
        enrolled: count(),
        active: sql<number>`sum(case when ${automation_enrollments.status} = 'active' then 1 else 0 end)::int`,
        completed: sql<number>`sum(case when ${automation_enrollments.status} = 'completed' then 1 else 0 end)::int`,
        exited: sql<number>`sum(case when ${automation_enrollments.status} = 'exited' then 1 else 0 end)::int`,
      })
      .from(automation_enrollments)
      .where(eq(automation_enrollments.automation_id, automationId))

    return {
      enrolled: row?.enrolled || 0,
      active: row?.active || 0,
      completed: row?.completed || 0,
      exited: row?.exited || 0,
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
  async handleTrackingEvent(eventType: string, contactId: string): Promise<number> {
    const res = await getDb()
      .update(automation_enrollments)
      .set({
        current_step_id: sql`${automation_enrollments.wait_true_step_id}`,
        next_action_at: now(),
        waiting_for_event: null,
      })
      .where(and(
        eq(automation_enrollments.contact_id, contactId),
        eq(automation_enrollments.waiting_for_event, eventType),
        eq(automation_enrollments.status, 'active'),
        isNotNull(automation_enrollments.wait_true_step_id),
      ))
      .returning({ id: automation_enrollments.id })
    return res.length
  }

  /**
   * Subscribe to tracking events so decision nodes can branch to Yes in real
   * time. Registered once from the constructor (not startWorker, which may be
   * called multiple times) to avoid duplicate handlers.
   */
  private registerEventHandlers(): void {
    const advance = (eventType: string) => (e: { contactId?: string }) => {
      if (e.contactId) void this.handleTrackingEvent(eventType, e.contactId)
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
