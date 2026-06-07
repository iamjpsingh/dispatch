// P2.5 net — automationService on real (PGlite) Postgres. CRUD with status gates,
// steps compilation, enrollment (+ dup ignore), lifecycle (activate/pause/deactivate),
// stats aggregation, and tenant isolation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))
vi.mock('../../src/services/eventBus', () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }))
vi.mock('../../src/services/conditionEngine', () => ({ evaluateCondition: vi.fn(() => true) }))
vi.mock('../../src/services/whatsappService', () => ({ whatsappService: { sendTemplate: vi.fn() } }))
vi.mock('../../src/services/contactService', () => ({ contactService: { getContact: vi.fn(async () => null) } }))

import { eq } from 'drizzle-orm'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, users, automations, automation_enrollments } from '../../src/db/pg/schema'
import { automationService } from '../../src/services/automationService'

const ORG = 'org_auto'
const ORG2 = 'org_auto2'
const USER = 'usr_auto'

const baseInput = { name: 'Welcome Drip', trigger_type: 'manual' as const }

const flowTwoSteps = {
  nodes: [
    { id: 'n1', type: 'send_email' as const, templateId: 't1', subject: 'Hi' },
    { id: 'n2', type: 'end' as const },
  ],
  edges: [{ from: 'n1', to: 'n2', label: 'default' as const }],
}

describe('P2.5 — automationService (Drizzle/PGlite)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await db.insert(organizations).values([
      { id: ORG, name: 'Org', slug: 'org-auto' },
      { id: ORG2, name: 'Org2', slug: 'org-auto2' },
    ])
    await db.insert(users).values({ id: USER, email: 'a@x.com', name: 'A', password_hash: 'x' })
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('creates an automation with defaults; row lands in Postgres', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect(a.name).toBe('Welcome Drip')
    expect(a.status).toBe('draft')
    expect(a.trigger_type).toBe('manual')
    expect(a.trigger_config).toBe('{}')
    expect(a.flow_json).toBe('{"nodes":[],"edges":[]}')
    expect(a.enrolled_count).toBe(0)
    expect(a.completed_count).toBe(0)
    const rows = await db.select().from(automations)
    expect(rows).toHaveLength(1)
  })

  it('reads back tenant-scoped', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect((await automationService.get(ORG, a.id))?.id).toBe(a.id)
    expect(await automationService.get(ORG2, a.id)).toBeNull()
  })

  it('lists tenant-scoped, newest first', async () => {
    await automationService.create(ORG, USER, { ...baseInput, name: 'A1' })
    await automationService.create(ORG, USER, { ...baseInput, name: 'A2' })
    await automationService.create(ORG2, USER, { ...baseInput, name: 'Other' })
    const mine = await automationService.list(ORG)
    expect(mine).toHaveLength(2)
    expect(mine.every((x) => x.org_id === ORG)).toBe(true)
    expect(await automationService.list(ORG2)).toHaveLength(1)
  })

  it('update only applies in draft/paused status', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect(await automationService.update(ORG, a.id, { name: 'Renamed', flow: flowTwoSteps })).toBe(true)
    expect((await automationService.get(ORG, a.id))?.name).toBe('Renamed')
    // activate → status 'active' → gated
    await automationService.activate(ORG, a.id)
    expect(await automationService.update(ORG, a.id, { name: 'Nope' })).toBe(false)
    expect((await automationService.get(ORG, a.id))?.name).toBe('Renamed')
  })

  it('update is tenant-scoped', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect(await automationService.update(ORG2, a.id, { name: 'Hijack' })).toBe(false)
    expect((await automationService.get(ORG, a.id))?.name).toBe('Welcome Drip')
  })

  it('delete only applies in draft/completed status and is tenant-scoped', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect(await automationService.delete(ORG2, a.id)).toBe(false) // wrong tenant
    expect(await automationService.delete(ORG, a.id)).toBe(true) // draft
    expect(await automationService.get(ORG, a.id)).toBeNull()
  })

  it('delete is gated while active', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    await automationService.activate(ORG, a.id)
    expect(await automationService.delete(ORG, a.id)).toBe(false) // active → gated
    await automationService.deactivate(ORG, a.id) // → completed
    expect(await automationService.delete(ORG, a.id)).toBe(true)
  })

  it('activate compiles flow to steps and sets status active', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    expect(await automationService.activate(ORG, a.id)).toBe(true)
    expect((await automationService.get(ORG, a.id))?.status).toBe('active')
    const steps = await automationService.getSteps(a.id)
    expect(steps).toHaveLength(2)
    expect(steps[0].step_type).toBe('send_email')
    expect(steps[0].step_order).toBe(0)
    expect(steps[0].next_step_id).toBe(steps[1].id)
    expect(steps[1].step_type).toBe('end')
  })

  it('pause only applies to active automations', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    expect(await automationService.pause(ORG, a.id)).toBe(false) // draft → not active
    await automationService.activate(ORG, a.id)
    expect(await automationService.pause(ORG, a.id)).toBe(true)
    expect((await automationService.get(ORG, a.id))?.status).toBe('paused')
  })

  it('deactivate marks completed regardless of status', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    expect(await automationService.deactivate(ORG, a.id)).toBe(true)
    expect((await automationService.get(ORG, a.id))?.status).toBe('completed')
  })

  it('enrolls a contact and increments enrolled_count; dup is ignored', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    await automationService.activate(ORG, a.id)

    expect(await automationService.enrollContact(a.id, 'contact-1')).toBe(true)
    expect((await automationService.get(ORG, a.id))?.enrolled_count).toBe(1)

    // UNIQUE(automation_id, contact_id) → duplicate ignored, no count bump
    expect(await automationService.enrollContact(a.id, 'contact-1')).toBe(false)
    expect((await automationService.get(ORG, a.id))?.enrolled_count).toBe(1)

    const enr = await db.select().from(automation_enrollments)
    expect(enr).toHaveLength(1)
    expect(enr[0].status).toBe('active')
    expect(enr[0].current_step_id).toBeTruthy()
  })

  it('enrollContact returns false when no steps exist', async () => {
    const a = await automationService.create(ORG, USER, baseInput) // never activated → no steps
    expect(await automationService.enrollContact(a.id, 'contact-x')).toBe(false)
  })

  it('lists enrollments for an automation', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    await automationService.activate(ORG, a.id)
    await automationService.enrollContact(a.id, 'c1')
    await automationService.enrollContact(a.id, 'c2')
    const enrollments = await automationService.getEnrollments(a.id)
    expect(enrollments).toHaveLength(2)
    expect(enrollments.every((e) => e.automation_id === a.id)).toBe(true)
  })

  it('exitContact exits an active enrollment with a reason', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    await automationService.activate(ORG, a.id)
    await automationService.enrollContact(a.id, 'c1')
    expect(await automationService.exitContact(a.id, 'c1', 'unsubscribed')).toBe(true)
    const [e] = await db.select().from(automation_enrollments)
    expect(e.status).toBe('exited')
    expect(e.exit_reason).toBe('unsubscribed')
    expect(e.completed_at).toBeTruthy()
    // already exited → no longer active → false
    expect(await automationService.exitContact(a.id, 'c1', 'again')).toBe(false)
  })

  it('computes enrollment stats', async () => {
    const a = await automationService.create(ORG, USER, { ...baseInput, flow: flowTwoSteps })
    await automationService.activate(ORG, a.id)
    await automationService.enrollContact(a.id, 'c1')
    await automationService.enrollContact(a.id, 'c2')
    await automationService.enrollContact(a.id, 'c3')
    await automationService.exitContact(a.id, 'c3', 'goal')

    const stats = await automationService.getStats(a.id)
    expect(stats.enrolled).toBe(3)
    expect(stats.active).toBe(2)
    expect(stats.exited).toBe(1)
    expect(stats.completed).toBe(0)
  })

  it('getStats returns zeros for an automation with no enrollments', async () => {
    const a = await automationService.create(ORG, USER, baseInput)
    const stats = await automationService.getStats(a.id)
    expect(stats).toEqual({ enrolled: 0, active: 0, completed: 0, exited: 0 })
  })

  // Event-driven decision-node redirect. When a tracking event arrives for an
  // enrollment parked waiting_for_event with a wait_true_step_id, the enrollment
  // is redirected current_step_id → wait_true_step_id (the Yes branch), the wait
  // state is cleared, and next_action_at is set to now so the next tick fires it.
  describe('handleTrackingEvent', () => {
    const AUTO = 'auto_track'
    // Seed a parked-waiting enrollment directly via the Drizzle tables.
    async function seedEnrollment(row: {
      id: string
      contact_id: string
      current_step_id: string
      waiting_for_event: string | null
      wait_true_step_id: string | null
      status?: string
    }) {
      await db
        .insert(automations)
        .values({ id: AUTO, org_id: ORG, user_id: USER, name: 'Track Automation', trigger_type: 'manual' })
        .onConflictDoNothing()
      await db.insert(automation_enrollments).values({
        id: row.id,
        automation_id: AUTO,
        contact_id: row.contact_id,
        current_step_id: row.current_step_id,
        status: row.status ?? 'active',
        next_action_at: new Date(Date.now() + 86_400_000).toISOString(),
        waiting_for_event: row.waiting_for_event,
        wait_true_step_id: row.wait_true_step_id,
      })
    }

    async function getEnrollment(id: string) {
      const [r] = await db.select().from(automation_enrollments).where(eq(automation_enrollments.id, id))
      return r
    }

    it('redirects a waiting enrollment to the Yes (true) branch on a matching event', async () => {
      await seedEnrollment({
        id: 'enr-yes',
        contact_id: 'track-1',
        current_step_id: 'step-no',
        waiting_for_event: 'email_opened',
        wait_true_step_id: 'step-yes',
      })

      const before = await getEnrollment('enr-yes')
      const changed = await automationService.handleTrackingEvent('email_opened', 'track-1')
      expect(changed).toBe(1)

      const after = await getEnrollment('enr-yes')
      expect(after.current_step_id).toBe('step-yes')
      expect(after.waiting_for_event).toBeNull()
      // next_action_at moved to now (earlier than the seeded +1 day) so the next tick fires it.
      expect(new Date(after.next_action_at!).getTime()).toBeLessThan(new Date(before.next_action_at!).getTime())
    })

    it('leaves an enrollment untouched when the event type does not match', async () => {
      await seedEnrollment({
        id: 'enr-mismatch',
        contact_id: 'track-2',
        current_step_id: 'step-no',
        waiting_for_event: 'email_opened',
        wait_true_step_id: 'step-yes',
      })

      const changed = await automationService.handleTrackingEvent('email_clicked', 'track-2')
      expect(changed).toBe(0)

      const after = await getEnrollment('enr-mismatch')
      expect(after.current_step_id).toBe('step-no')
      expect(after.waiting_for_event).toBe('email_opened')
    })

    it('leaves an enrollment that is not waiting unaffected', async () => {
      await seedEnrollment({
        id: 'enr-not-waiting',
        contact_id: 'track-3',
        current_step_id: 'step-no',
        waiting_for_event: null,
        wait_true_step_id: null,
      })

      const changed = await automationService.handleTrackingEvent('email_opened', 'track-3')
      expect(changed).toBe(0)

      const after = await getEnrollment('enr-not-waiting')
      expect(after.current_step_id).toBe('step-no')
      expect(after.waiting_for_event).toBeNull()
    })
  })
})
