# P7b — Audit-Event Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every audit-worthy mutating API route a semantic, server-derived `audit_logs` entry (and, for content CRUD, an `activity_logs` entry), with a CI coverage test that fails when a new mutation ships un-audited and an immutability guard on the audit tables.

**Architecture:** A single route-layer helper (`auditFromContext` / `activityFromContext`) derives actor/org/ip/ua from the Hono `Context` and calls the existing fire-and-forget `auditService`. A typed taxonomy (`AuditAction` / `ActivityAction`) is extracted out of the over-cap `auditService.ts` into `audit/types.ts` and expanded. A static manifest (routes → action-or-exempt) checked against the live router array proves completeness; behavioral spot-tests prove wiring. No new admin views — the audit dual-view already exists.

**Tech Stack:** TypeScript, Hono + `hono/client` RPC, Drizzle ORM on Postgres (bun-sql prod / PGlite in tests), Vitest.

## Global Constraints

- **R1** — TypeScript only; no `any` without a stated reason; **no source file over 200 LOC** (this is why the taxonomy is extracted and the manifest is split by domain).
- **R2** — data-driven for *user content*; the audit taxonomy is developer-defined program structure (a typed union), explicitly R2-exempt.
- **R5** — before any "done": `bun typecheck` clean, `bun lint` clean (200-LOC cap enforced), backend suite green.
- **R8** — surgical: touch only what the task needs. Do **not** re-plumb the existing service-layer self-audits (auth/org/member/team/gdpr). Add only the imports each change orphans.
- **R9** — actor and org are **server-derived**, never client-supplied. Audit writes are org-scoped. **Never record a secret value** in `changes`/`metadata` — record only that a secret changed (`{ secretChanged: true }`).
- **Gate (must hold at the end):** api `tsc` = **49** baseline (+0 net-new), web own-src ≤ **33**, backend suite green incl. the new tests, `bun lint` clean.
- **Fire-and-forget invariant:** `auditFromContext` / `activityFromContext` **must never throw** — a logging failure must not change request semantics. They read `c.user`/`orgId` defensively (NOT via `requireAuth`/`getOrgId`, which throw).
- All commands below run from `apps/api/` unless noted. Commit after each task with `--no-gpg-sign` and the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

**Created:**
- `apps/api/src/services/audit/types.ts` — `AuditAction`, `ActivityAction`, `AuditEntry`, `ActivityEntry`, `LogQuery` (extracted from `auditService.ts`, then expanded). < 200 LOC.
- `apps/api/src/services/audit/context.ts` — `auditFromContext(c, {...})`, `activityFromContext(c, {...})`. < 60 LOC.
- `apps/api/tests/audit/context.test.ts` — helper unit test (PGlite landing + derivation).
- `apps/api/tests/audit/coverage.test.ts` — manifest ↔ live-routes two-way completeness test.
- `apps/api/tests/audit/immutability.test.ts` — src scan: no `.update/.delete` on audit tables outside `auditService.cleanup`.
- `apps/api/tests/audit/manifest/` — 7 per-slice manifest files + `index.ts` aggregator (each < 200 LOC):
  `campaigns.ts`, `contacts.ts`, `config-keys-oauth.ts`, `content.ts` (templates+automations+segments), `channels.ts` (forms+pages+webhooks), `infra.ts` (whatsapp+warmup+routing+plugins+queue+send+report+analytics+tracking), `admin-auth.ts`, `index.ts`.
- Per-slice behavioral tests: `apps/api/tests/audit/wiring/<slice>.test.ts` (spot-checks, 2–3 per slice).

**Modified:**
- `apps/api/src/services/auditService.ts` — remove the type/interface block (now imported from `./audit/types`); drops under 200 LOC.
- `apps/api/src/app.ts` — `const routes` → `export const routes` (one word; lets the coverage test read the pre-mount router array).
- All 21 domain route files under `apps/api/src/routes/` — add `auditFromContext` / `activityFromContext` calls per the manifest tables.

---

## Reference: the audit call (used by every wiring task)

The helper signatures produced by Task 1 (consume these verbatim):

```ts
// src/services/audit/context.ts
export function auditFromContext(
  c: Context,
  entry: { action: AuditAction; entityType: string; entityId?: string;
           changes?: Record<string, { from: unknown; to: unknown }>;
           metadata?: Record<string, unknown> },
): void

export function activityFromContext(
  c: Context,
  entry: { action: ActivityAction; entityType: string; entityId?: string;
           description: string; metadata?: Record<string, unknown> },
): void
```

**Wiring rules (apply to every route in every slice):**
1. Place the call **on the success path**, after the service/DB call that performed the mutation and **before** `return c.json(...)` / `return success(...)`.
2. `entityId` = the id expression given in the slice table. For **bulk/batch** ops where no single id applies, omit `entityId` and pass `metadata: { count }` (or the relevant ids).
3. Do **not** add `changes` unless the table's note calls for it. For a secret change, use `metadata: { secretChanged: true }` — **never the value** (R9).
4. Content-CRUD rows (table column "activity" non-empty) get a second `activityFromContext` call with a short human `description`.
5. Neither call is `await`ed (fire-and-forget). Add `import { auditFromContext, activityFromContext } from '../services/audit/context'` (import only the ones used).

---

## Task 1: Foundation — taxonomy extract, helper, `routes` export

**Files:**
- Create: `apps/api/src/services/audit/types.ts`
- Modify: `apps/api/src/services/auditService.ts` (remove lines 9–76 type block; import from `./audit/types`)
- Create: `apps/api/src/services/audit/context.ts`
- Modify: `apps/api/src/app.ts:147` (`const routes` → `export const routes`)
- Test: `apps/api/tests/audit/context.test.ts`

**Interfaces:**
- Produces: `AuditAction`, `ActivityAction` (string unions), `AuditEntry`, `ActivityEntry`, `LogQuery` (from `audit/types`); `auditFromContext`, `activityFromContext` (from `audit/context`); `export const routes` from `app.ts`.
- Consumes: `auditService.log` / `auditService.logActivity` (unchanged signatures).

- [ ] **Step 1: Write the failing helper test**

`apps/api/tests/audit/context.test.ts`:
```ts
// Net — route-layer audit helpers derive actor/org/ip/ua from Context and land a row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { Hono } from 'hono'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations, audit_logs, activity_logs } from '../../src/db/pg/schema'
import { auditFromContext, activityFromContext } from '../../src/services/audit/context'
import { auditService } from '../../src/services/auditService'

const ORG = 'org_ctx'
const USER = { id: 'usr_ctx', email: 'ctx@test.com', name: 'Ctx' }

function appThatAudits(fn: (c: any) => void) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.user = USER as any; c.set('orgId', ORG); await next() })
  app.post('/go', (c) => { fn(c); return c.json({ ok: true }) })
  return app
}

describe('audit context helpers', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated(); __setTestDb(db)
    await db.insert(organizations).values({ id: ORG, name: 'O', slug: 'o' })
  }, 30_000)
  afterEach(() => { __setTestDb(null); vi.clearAllMocks() })

  it('auditFromContext derives actor/org/ip/ua and lands an audit row', async () => {
    const app = appThatAudits((c) => auditFromContext(c, { action: 'campaign.launched', entityType: 'campaign', entityId: 'cmp_1' }))
    await app.fetch(new Request('http://localhost/go', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9', 'user-agent': 'net' } }))
    await new Promise((r) => setTimeout(r, 20)) // let the un-awaited insert settle
    const { logs, total } = await auditService.queryAuditLogs({ orgId: ORG })
    expect(total).toBe(1)
    expect(logs[0].actor_id).toBe('usr_ctx')
    expect(logs[0].actor_email).toBe('ctx@test.com')
    expect(logs[0].action).toBe('campaign.launched')
    expect(logs[0].entity_id).toBe('cmp_1')
    expect(logs[0].ip_address).toBe('9.9.9.9')
    expect(logs[0].user_agent).toBe('net')
  })

  it('activityFromContext lands an activity row with a description', async () => {
    const app = appThatAudits((c) => activityFromContext(c, { action: 'campaign.created', entityType: 'campaign', entityId: 'cmp_2', description: 'Created' }))
    await app.fetch(new Request('http://localhost/go', { method: 'POST' }))
    await new Promise((r) => setTimeout(r, 20))
    const { logs, total } = await auditService.queryActivityLogs({ orgId: ORG })
    expect(total).toBe(1)
    expect(logs[0].description).toBe('Created')
  })

  it('never throws when there is no user or org on the context', async () => {
    const app = new Hono()
    app.post('/go', (c) => { auditFromContext(c, { action: 'user.logout', entityType: 'session' }); return c.json({ ok: true }) })
    const res = await app.fetch(new Request('http://localhost/go', { method: 'POST' }))
    expect(res.status).toBe(200) // handler completed; no throw from the helper
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bunx vitest run tests/audit/context.test.ts`
Expected: FAIL — `Cannot find module '.../src/services/audit/context'`.

- [ ] **Step 3: Create `audit/types.ts` (extracted + expanded)**

Move the five type/interface declarations out of `auditService.ts` and expand the two unions. Keep multiple members per line so the file stays < 200 LOC.
```ts
// src/services/audit/types.ts - Audit & Activity taxonomy + entry shapes (R1 extraction).
// Program structure (a developer-defined event taxonomy), R2-exempt.

export type AuditAction =
  // Auth / session / user
  | 'user.login' | 'user.logout' | 'user.register' | 'session.org_switched'
  | 'auth.password_changed' | 'user.profile_updated' | 'user.username_updated'
  | 'user.status_changed' | 'user.deleted'
  // Org
  | 'org.created' | 'org.updated' | 'org.deleted' | 'org.suspended'
  | 'org.status_changed' | 'org.slug_changed' | 'org.sender_identity_updated'
  // Sending domains / identities
  | 'domain.created' | 'domain.verified' | 'domain.deleted'
  | 'sending_email.created' | 'sending_email.updated' | 'sending_email.deleted'
  // Members / teams / permissions / invitations
  | 'member.invited' | 'member.joined' | 'member.role_changed' | 'member.removed'
  | 'member.suspended' | 'member.added'
  | 'team.created' | 'team.updated' | 'team.deleted' | 'team.member_added' | 'team.member_removed'
  | 'permission.granted' | 'permission.revoked' | 'permission.override_removed'
  | 'invitation.cancelled' | 'invitation.resent'
  // Settings / SMTP / OAuth / provider / infra
  | 'settings.updated' | 'smtp.created' | 'smtp.updated' | 'smtp.deleted'
  | 'oauth.updated' | 'cloudflare.updated' | 'cloudflare.worker_deployed' | 'cloudflare.worker_undeployed'
  | 'provider.connected' | 'provider.disconnected'
  // Campaigns
  | 'campaign.created' | 'campaign.updated' | 'campaign.deleted' | 'campaign.launched'
  | 'campaign.paused' | 'campaign.cancelled' | 'campaign.scheduled' | 'campaign.rescheduled'
  | 'campaign.cloned' | 'campaign.archived' | 'campaign.ab_variant_created'
  | 'campaign.ab_winner_declared' | 'campaign.ab_auto_winner_configured' | 'campaign.graymail_reset'
  // Contacts / lists
  | 'contacts.imported' | 'contacts.exported' | 'contacts.deleted' | 'contacts.erased'
  | 'contacts.created' | 'contacts.updated' | 'contacts.merged' | 'contacts.tagged' | 'contacts.moved'
  | 'contact.preference_updated'
  | 'list.created' | 'list.updated' | 'list.deleted'
  // Templates / sections
  | 'template.created' | 'template.updated' | 'template.deleted' | 'template.duplicated'
  | 'section.created' | 'section.updated' | 'section.deleted'
  // Automations
  | 'automation.created' | 'automation.updated' | 'automation.deleted' | 'automation.activated'
  | 'automation.paused' | 'automation.deactivated' | 'automation.contact_enrolled'
  | 'automation.contact_unenrolled' | 'automation.goal_updated' | 'automation.goal_removed'
  // Segments
  | 'segment.created' | 'segment.updated' | 'segment.deleted'
  | 'segment.members_added' | 'segment.members_removed'
  // Forms / pages
  | 'form.created' | 'form.updated' | 'form.deleted' | 'form.status_changed'
  | 'page.created' | 'page.updated' | 'page.deleted' | 'page.published' | 'page.unpublished'
  // Webhooks
  | 'webhook.created' | 'webhook.updated' | 'webhook.deleted' | 'webhook.toggled' | 'webhook.logs_cleared'
  // WhatsApp
  | 'whatsapp.config_created' | 'whatsapp.config_updated' | 'whatsapp.config_deleted'
  | 'whatsapp.template_created' | 'whatsapp.template_deleted'
  | 'whatsapp.message_sent' | 'whatsapp.bulk_sent'
  // Warmup
  | 'warmup.created' | 'warmup.paused' | 'warmup.resumed' | 'warmup.cancelled' | 'warmup.deleted'
  // Routing
  | 'routing.updated' | 'routing.provider_initialized' | 'routing.provider_health_changed' | 'routing.failover_triggered'
  // Plugins
  | 'plugin.installed' | 'plugin.enabled' | 'plugin.disabled' | 'plugin.settings_updated' | 'plugin.uninstalled'
  // Queue / jobs / suppression / send
  | 'job.paused' | 'job.resumed' | 'job.cancelled'
  | 'suppression.added' | 'suppression.removed'
  | 'send.enqueued' | 'send.log_deleted' | 'send.logs_bulk_deleted'
  // Data retention / API keys
  | 'data.retention_purge'
  | 'apikey.created' | 'apikey.revoked' | 'apikey.toggled' | 'apikey.scopes_updated'

export type ActivityAction =
  | 'campaign.created' | 'campaign.updated' | 'campaign.sent' | 'campaign.deleted'
  | 'template.created' | 'template.updated' | 'template.deleted'
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'list.created' | 'list.updated' | 'list.deleted'
  | 'automation.created' | 'automation.activated' | 'automation.paused'
  | 'automation.updated' | 'automation.deleted' | 'automation.deactivated'
  | 'segment.created' | 'segment.updated' | 'segment.deleted'
  | 'form.created' | 'form.updated' | 'form.deleted'
  | 'page.created' | 'page.updated' | 'page.deleted'
  | 'team.created' | 'team.updated'
  | 'member.invited' | 'member.joined'
  | 'settings.updated'

export interface AuditEntry {
  orgId?: string; actorId: string; actorEmail?: string
  action: AuditAction; entityType: string; entityId?: string
  changes?: Record<string, { from: unknown; to: unknown }>
  ipAddress?: string; userAgent?: string; metadata?: Record<string, unknown>
}

export interface ActivityEntry {
  orgId?: string; actorId: string; actorEmail?: string
  action: ActivityAction; entityType: string; entityId?: string
  description: string; metadata?: Record<string, unknown>
}

export interface LogQuery {
  orgId?: string; actorId?: string; action?: string; entityType?: string
  entityId?: string; from?: string; to?: string; page?: number; limit?: number
}
```

- [ ] **Step 4: Slim `auditService.ts` to import the types**

In `apps/api/src/services/auditService.ts`, delete the `export type AuditAction … interface LogQuery {…}` block (current lines 9–76) and add after the existing imports:
```ts
import type { AuditAction, ActivityAction, AuditEntry, ActivityEntry, LogQuery } from './audit/types'
```
Re-export for back-compat so existing importers of `auditService` types keep working:
```ts
export type { AuditAction, ActivityAction } from './audit/types'
```
Verify the file is now < 200 LOC: `awk 'END{print NR}' src/services/auditService.ts` → expect ~165.

- [ ] **Step 5: Create `audit/context.ts` (defensive, never-throws)**
```ts
// src/services/audit/context.ts - Route-layer audit primitives.
// Derive actor/org/ip/ua from the Hono Context server-side; fire-and-forget (never throws).
import type { Context } from 'hono'
import { auditService } from '../auditService'
import type { AuditAction, ActivityAction } from './types'

function actor(c: Context) {
  // Read defensively — do NOT use requireAuth/getOrgId (they throw). This runs in a
  // fire-and-forget path and must never break the request.
  const user = c.user
  return {
    actorId: user?.id ?? 'unknown',
    actorEmail: user?.email,
    orgId: (c.get('orgId') as string | null) ?? undefined,
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  }
}

export function auditFromContext(
  c: Context,
  entry: { action: AuditAction; entityType: string; entityId?: string;
           changes?: Record<string, { from: unknown; to: unknown }>;
           metadata?: Record<string, unknown> },
): void {
  const a = actor(c)
  void auditService.log({ ...a, ...entry })
}

export function activityFromContext(
  c: Context,
  entry: { action: ActivityAction; entityType: string; entityId?: string;
           description: string; metadata?: Record<string, unknown> },
): void {
  const a = actor(c)
  void auditService.logActivity({ ...a, ...entry })
}
```

- [ ] **Step 6: Export the router array from `app.ts`**

Change `apps/api/src/app.ts:147` from `const routes = [` to `export const routes = [`. No other change.

- [ ] **Step 7: Run the helper test — expect PASS**

Run: `bunx vitest run tests/audit/context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck + lint**

Run: `bun typecheck` (expect api `tsc` unchanged at 49) and `bun lint` (clean; confirm `auditService.ts` and the two new files are ≤ 200 LOC).

- [ ] **Step 9: Commit**
```bash
git add src/services/audit/ src/services/auditService.ts src/app.ts tests/audit/context.test.ts
git commit -m "feat(p7b): extract+expand audit taxonomy, add route-layer audit context helper" --no-gpg-sign
```

---

## Task 2: Completeness teeth — manifest, coverage test, immutability guard

**Files:**
- Create: `apps/api/tests/audit/manifest/{campaigns,contacts,config-keys-oauth,content,channels,infra,admin-auth,index}.ts`
- Create: `apps/api/tests/audit/coverage.test.ts`
- Create: `apps/api/tests/audit/immutability.test.ts`

**Interfaces:**
- Consumes: `export const routes` (Task 1), `AuditAction` (Task 1).
- Produces: `AUDIT_MANIFEST: Record<string, AuditAction | { exempt: string }>` from `tests/audit/manifest/index.ts`.

The manifest keys are `"METHOD /path"` **as declared in the sub-routers** (no `/api` prefix). Values are either an `AuditAction` (audited — whether the row is written at the route or already at the service layer) or `{ exempt: '<category>: <reason>' }`. The four exempt categories: `derived-recompute`, `preview-test-validate`, `machine-public-ingestion`, `draft-autosave` (plus `actor-less` for unauthenticated security routes).

- [ ] **Step 1: Author the per-slice manifest files**

Each file exports a typed map. Full content below (these ARE the classification — authored complete so the coverage test goes green immediately; wiring is proven later by behavioral tests). Type each with `satisfies Record<string, AuditAction | { exempt: string }>` so a typo fails `tsc`.

`tests/audit/manifest/campaigns.ts`:
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const campaignsManifest = {
  'POST /campaigns': 'campaign.created',
  'PUT /campaigns/:id': 'campaign.updated',
  'DELETE /campaigns/:id': 'campaign.deleted',
  'POST /campaigns/:id/draft': { exempt: 'draft-autosave: publish/launch is the audited event' },
  'POST /campaigns/:id/schedule': 'campaign.scheduled',
  'POST /campaigns/:id/reschedule': 'campaign.rescheduled',
  'POST /campaigns/:id/launch': 'campaign.launched',
  'POST /campaigns/:id/pause': 'campaign.paused',
  'POST /campaigns/:id/cancel': 'campaign.cancelled',
  'POST /campaigns/:id/clone': 'campaign.cloned',
  'POST /campaigns/:id/archive': 'campaign.archived',
  'POST /campaigns/:id/ab/variant': 'campaign.ab_variant_created',
  'POST /campaigns/:id/ab/winner': 'campaign.ab_winner_declared',
  'PUT /campaigns/:id/ab/auto-winner': 'campaign.ab_auto_winner_configured',
  'POST /campaigns/:id/ab/check-winner': { exempt: 'derived-recompute: reads variant stats, no state change' },
  'PUT /campaigns/frequency-cap': 'settings.updated',
  'PUT /campaigns/graymail': 'settings.updated',
  'POST /campaigns/graymail/reset/:email': 'campaign.graymail_reset',
  'PUT /campaigns/:id/rotation': 'routing.updated',
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/contacts.ts`:
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const contactsManifest = {
  'POST /contacts/lists': 'list.created',
  'PUT /contacts/lists/:id': 'list.updated',
  'DELETE /contacts/lists/:id': 'list.deleted',
  'POST /contacts/merge': 'contacts.merged',
  'POST /contacts/validate': { exempt: 'preview-test-validate: validates addresses, no persistence' },
  'POST /contacts/validate-single': { exempt: 'preview-test-validate: single-address check' },
  'POST /contacts/bulk/delete': 'contacts.deleted',
  'POST /contacts/bulk/tag': 'contacts.tagged',
  'POST /contacts/bulk/move': 'contacts.moved',
  'POST /contacts/preferences/public/:email': { exempt: 'machine-public-ingestion: public unauth preference update' },
  'PUT /contacts/preferences/:contactId': 'contact.preference_updated',
  'POST /contacts/:listId': 'contacts.created',
  'PUT /contacts/item/:id': 'contacts.updated',
  'POST /contacts/:listId/import': 'contacts.imported',
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/config-keys-oauth.ts`:
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const configKeysOauthManifest = {
  // config.ts (SMTP / provider secrets)
  'POST /config/smtp': 'smtp.created',
  'POST /config/create': 'smtp.created',
  'PUT /config/smtp/:configId': 'smtp.updated',
  'POST /config/update/:configId': 'smtp.updated',
  'DELETE /config/smtp/:configId': 'smtp.deleted',
  'DELETE /config/delete/:configId': 'smtp.deleted',
  'POST /config/smtp/:configId/default': 'smtp.updated',
  'POST /config/smtp/test': { exempt: 'preview-test-validate: SMTP connection test' },
  'POST /config/test/:configId': { exempt: 'preview-test-validate: SMTP connection test' },
  'POST /config/provider': 'smtp.created',
  'POST /config/provider/test/:configId': { exempt: 'preview-test-validate: provider connection test' },
  'POST /config/fetch-domains': { exempt: 'preview-test-validate: reads provider domains, no state change' },
  // apikeys.ts
  'POST /api-keys': 'apikey.created',
  'DELETE /api-keys/:id': 'apikey.revoked',
  'POST /api-keys/:id/toggle': 'apikey.toggled',
  'PUT /api-keys/:id/scopes': 'apikey.scopes_updated',
  // oauth.ts
  'DELETE /oauth/:configId/disconnect': 'provider.disconnected',
  'POST /oauth/:configId/test': { exempt: 'preview-test-validate: OAuth connection test' },
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/content.ts` (templates + automations + segments):
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const contentManifest = {
  // templates.ts
  'POST /templates': 'template.created',
  'PUT /templates/:id': 'template.updated',
  'DELETE /templates/:id': 'template.deleted',
  'POST /templates/:id/duplicate': 'template.duplicated',
  'POST /templates/:id/preview': { exempt: 'preview-test-validate: renders a preview' },
  'POST /templates/preview': { exempt: 'preview-test-validate: renders a preview' },
  'POST /templates/:id/test-send': { exempt: 'preview-test-validate: sends a test to self' },
  'POST /templates/sections': 'section.created',
  'PUT /templates/sections/:id': 'section.updated',
  'DELETE /templates/sections/:id': 'section.deleted',
  'POST /templates/sections/:id/use': { exempt: 'derived-recompute: increments a use counter' },
  'POST /templates/compile': { exempt: 'preview-test-validate: compiles MJML, no persistence' },
  'POST /templates/from-mjml': 'template.created',
  // automations.ts
  'POST /automations': 'automation.created',
  'PUT /automations/:id': 'automation.updated',
  'DELETE /automations/:id': 'automation.deleted',
  'POST /automations/:id/activate': 'automation.activated',
  'POST /automations/:id/pause': 'automation.paused',
  'POST /automations/:id/deactivate': 'automation.deactivated',
  'POST /automations/:id/enroll': 'automation.contact_enrolled',
  'DELETE /automations/:id/enrollments/:contactId': 'automation.contact_unenrolled',
  'PUT /automations/:id/goal': 'automation.goal_updated',
  'DELETE /automations/:id/goal': 'automation.goal_removed',
  // segments.ts
  'POST /segments': 'segment.created',
  'PUT /segments/:id': 'segment.updated',
  'DELETE /segments/:id': 'segment.deleted',
  'POST /segments/:id/contacts': 'segment.members_added',
  'DELETE /segments/:id/contacts': 'segment.members_removed',
  'POST /segments/:id/preview': { exempt: 'preview-test-validate: previews matching contacts' },
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/channels.ts` (forms + pages + webhooks):
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const channelsManifest = {
  // forms.ts
  'POST /forms': 'form.created',
  'PUT /forms/:id': 'form.updated',
  'DELETE /forms/:id': 'form.deleted',
  'POST /forms/:id/submit': { exempt: 'machine-public-ingestion: public form submission' },
  'POST /forms/:id/toggle': 'form.status_changed',
  'POST /forms/:id/webhook': { exempt: 'machine-public-ingestion: inbound form webhook' },
  // pages.ts
  'POST /pages': 'page.created',
  'PUT /pages/:id': 'page.updated',
  'DELETE /pages/:id': 'page.deleted',
  'POST /pages/:id/publish': 'page.published',
  'POST /pages/:id/unpublish': 'page.unpublished',
  // webhooks.ts
  'POST /webhooks': 'webhook.created',
  'PUT /webhooks/:id': 'webhook.updated',
  'DELETE /webhooks/:id': 'webhook.deleted',
  'POST /webhooks/:id/toggle': 'webhook.toggled',
  'POST /webhooks/:id/test': { exempt: 'preview-test-validate: sends a test webhook ping' },
  'DELETE /webhooks/:id/logs': 'webhook.logs_cleared',
  'POST /webhooks/bounce/ses': { exempt: 'machine-public-ingestion: inbound SES bounce' },
  'POST /webhooks/bounce/mailgun': { exempt: 'machine-public-ingestion: inbound Mailgun bounce' },
  'POST /webhooks/bounce/sendgrid': { exempt: 'machine-public-ingestion: inbound SendGrid bounce' },
  'POST /webhooks/bounce/postmark': { exempt: 'machine-public-ingestion: inbound Postmark bounce' },
  'POST /webhooks/bounce/sparkpost': { exempt: 'machine-public-ingestion: inbound SparkPost bounce' },
  'POST /webhooks/inbound/sendgrid': { exempt: 'machine-public-ingestion: inbound SendGrid parse' },
  'POST /webhooks/inbound/mailgun': { exempt: 'machine-public-ingestion: inbound Mailgun parse' },
  'POST /webhooks/inbound/postmark': { exempt: 'machine-public-ingestion: inbound Postmark parse' },
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/infra.ts` (whatsapp + warmup + routing + plugins + queue + send + report + analytics + tracking):
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const infraManifest = {
  // whatsapp.ts
  'POST /whatsapp/configs': 'whatsapp.config_created',
  'PUT /whatsapp/configs/:id': 'whatsapp.config_updated',
  'DELETE /whatsapp/configs/:id': 'whatsapp.config_deleted',
  'POST /whatsapp/templates/sync': { exempt: 'derived-recompute: syncs templates from provider' },
  'POST /whatsapp/templates': 'whatsapp.template_created',
  'DELETE /whatsapp/templates/:id': 'whatsapp.template_deleted',
  'POST /whatsapp/send': 'whatsapp.message_sent',
  'POST /whatsapp/send-text': 'whatsapp.message_sent',
  'POST /whatsapp/send-bulk': 'whatsapp.bulk_sent',
  'POST /whatsapp/webhook': { exempt: 'machine-public-ingestion: inbound WhatsApp webhook' },
  // warmup.ts
  'POST /warmup': 'warmup.created',
  'POST /warmup/:id/pause': 'warmup.paused',
  'POST /warmup/:id/resume': 'warmup.resumed',
  'POST /warmup/:id/cancel': 'warmup.cancelled',
  'DELETE /warmup/:id': 'warmup.deleted',
  // routing.ts
  'PUT /routing/config': 'routing.updated',
  'POST /routing/providers/init': 'routing.provider_initialized',
  'POST /routing/providers/:configId/health': 'routing.provider_health_changed',
  'POST /routing/failover': 'routing.failover_triggered',
  // plugins.ts
  'POST /plugins': 'plugin.installed',
  'POST /plugins/providers/install': 'provider.connected',
  'POST /plugins/:id/activate': 'plugin.enabled',
  'POST /plugins/:id/disable': 'plugin.disabled',
  'PUT /plugins/:id/settings': 'plugin.settings_updated',
  'DELETE /plugins/:id': 'plugin.uninstalled',
  // queue.ts
  'POST /queue/jobs/:id/pause': 'job.paused',
  'POST /queue/jobs/:id/resume': 'job.resumed',
  'DELETE /queue/jobs/:id': 'job.cancelled',
  'POST /queue/suppression': 'suppression.added',
  'DELETE /queue/suppression/:email': 'suppression.removed',
  // send.ts
  'POST /send': 'send.enqueued',
  'POST /send/spam-check': { exempt: 'preview-test-validate: scores content, no send' },
  'POST /test-notification': { exempt: 'preview-test-validate: sends a test notification' },
  'POST /provider-info': { exempt: 'preview-test-validate: reads provider metadata' },
  'POST /parse-excel': { exempt: 'preview-test-validate: parses an upload, no persistence' },
  'DELETE /scheduled-jobs/:id': 'job.cancelled',
  'POST /batch-pause': 'job.paused',
  'POST /batch-resume': 'job.resumed',
  'DELETE /batch-cancel': 'job.cancelled',
  // report.ts
  'DELETE /report/logs/:id': 'send.log_deleted',
  'POST /report/logs/delete-bulk': 'send.logs_bulk_deleted',
  // analytics.ts
  'POST /analytics/events': { exempt: 'machine-public-ingestion: analytics event ingestion' },
  'POST /analytics/seed': { exempt: 'derived-recompute: seeds/recomputes analytics' },
  'POST /analytics/custom-report': { exempt: 'preview-test-validate: builds an ad-hoc report' },
  // tracking.ts
  'POST /tracking/event': { exempt: 'machine-public-ingestion: open/click tracking event' },
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/admin-auth.ts` (admin.ts + auth.ts). Rows marked `// service` are audited today at the service layer — they map to their action but get **no** route-layer call (verify only in Task 9):
```ts
import type { AuditAction } from '../../../src/services/audit/types'
export const adminAuthManifest = {
  // admin.ts — platform
  'POST /admin/platform/cleanup': { exempt: 'derived-recompute: purges already-expired sessions' },
  'PUT /admin/platform/users/:userId/status': 'user.status_changed',
  'DELETE /admin/platform/users/:userId': 'user.deleted',
  'PUT /admin/platform/orgs/:orgId/status': 'org.status_changed',
  'DELETE /admin/platform/orgs/:orgId': 'org.deleted',
  'PUT /admin/platform/settings/mailer': 'smtp.updated',
  'POST /admin/platform/settings/mailer/test': { exempt: 'preview-test-validate: mailer connection test' },
  'POST /admin/platform/settings/mailer/send-test': { exempt: 'preview-test-validate: sends a test email' },
  'DELETE /admin/platform/settings/mailer': 'smtp.deleted',
  'PUT /admin/platform/settings/oauth': 'oauth.updated',
  'PUT /admin/platform/settings/cloudflare': 'cloudflare.updated',
  'POST /admin/cloudflare/deploy': 'cloudflare.worker_deployed',
  'DELETE /admin/cloudflare/undeploy/:domain': 'cloudflare.worker_undeployed',
  // admin.ts — org
  'PUT /admin/org/slug': 'org.slug_changed',
  'PUT /admin/org/sender-identity': 'org.sender_identity_updated',
  'POST /admin/org/domains': 'domain.created',
  'POST /admin/org/domains/:id/verify': 'domain.verified',
  'DELETE /admin/org/domains/:id': 'domain.deleted',
  'POST /admin/org/sending-emails': 'sending_email.created',
  'PUT /admin/org/sending-emails/:id': 'sending_email.updated',
  'DELETE /admin/org/sending-emails/:id': 'sending_email.deleted',
  'PUT /admin/org': 'org.updated', // service (orgService self-audits)
  'POST /admin/org/members': 'member.added',
  'PUT /admin/org/members/:userId/role': 'member.role_changed',
  'DELETE /admin/org/members/:userId': 'member.removed',
  // admin.ts — teams (service: teamService self-audits)
  'POST /admin/teams': 'team.created',
  'PUT /admin/teams/:teamId': 'team.updated',
  'DELETE /admin/teams/:teamId': 'team.deleted',
  'POST /admin/teams/:teamId/members': 'team.member_added',
  'DELETE /admin/teams/:teamId/members/:userId': 'team.member_removed',
  // admin.ts — permissions / invitations / gdpr
  'POST /admin/permissions/:userId/grant': 'permission.granted',
  'POST /admin/permissions/:userId/revoke': 'permission.revoked',
  'DELETE /admin/permissions/:userId/:permission': 'permission.override_removed',
  'POST /admin/invitations': 'member.invited', // service (invitationService self-audits)
  'DELETE /admin/invitations/:id': 'invitation.cancelled',
  'POST /admin/invitations/:id/resend': 'invitation.resent',
  'POST /admin/invitations/accept/:token': 'member.joined', // service
  'POST /admin/contacts/:id/gdpr-erase': 'contacts.erased', // service (gdprService self-audits)
  // auth.ts
  'POST /auth/register': 'user.register', // service (authLocalService self-audits)
  'POST /auth/login': 'user.login', // service
  'POST /auth/logout': 'user.logout', // service
  'POST /auth/switch-org': 'session.org_switched',
  'POST /auth/forgot-password': { exempt: 'actor-less: unauthenticated; no server-derived actor at route layer' },
  'POST /auth/reset-password': { exempt: 'actor-less: unauthenticated; token-based, no session actor' },
  'POST /auth/change-password': 'auth.password_changed',
  'PUT /auth/profile': 'user.profile_updated',
  'PUT /auth/profile/username': 'user.username_updated',
} satisfies Record<string, AuditAction | { exempt: string }>
```

`tests/audit/manifest/index.ts`:
```ts
import type { AuditAction } from '../../../src/services/audit/types'
import { campaignsManifest } from './campaigns'
import { contactsManifest } from './contacts'
import { configKeysOauthManifest } from './config-keys-oauth'
import { contentManifest } from './content'
import { channelsManifest } from './channels'
import { infraManifest } from './infra'
import { adminAuthManifest } from './admin-auth'

export type ManifestValue = AuditAction | { exempt: string }
export const AUDIT_MANIFEST: Record<string, ManifestValue> = {
  ...campaignsManifest, ...contactsManifest, ...configKeysOauthManifest,
  ...contentManifest, ...channelsManifest, ...infraManifest, ...adminAuthManifest,
}
```

- [ ] **Step 2: Write the coverage test**

`tests/audit/coverage.test.ts`:
```ts
// Net — every mutating route is classified in the audit manifest (two-way), so a new
// un-audited mutation fails CI. Reads the pre-mount router array (no /api prefix).
import { describe, it, expect } from 'vitest'
import { routes } from '../../src/app'
import { AUDIT_MANIFEST } from './manifest'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function liveMutatingRoutes(): string[] {
  const keys = new Set<string>()
  for (const r of routes) {
    for (const e of (r as any).routes as Array<{ method: string; path: string }>) {
      if (MUTATING.has(e.method)) keys.add(`${e.method} ${e.path}`)
    }
  }
  return [...keys].sort()
}

describe('audit coverage', () => {
  it('every mutating route is present in the manifest', () => {
    const missing = liveMutatingRoutes().filter((k) => !(k in AUDIT_MANIFEST))
    expect(missing, `Unclassified mutating routes — add an AuditAction or { exempt } entry:\n${missing.join('\n')}`).toEqual([])
  })

  it('every manifest entry maps to a real route (no stale entries)', () => {
    const live = new Set(liveMutatingRoutes())
    const stale = Object.keys(AUDIT_MANIFEST).filter((k) => !live.has(k))
    expect(stale, `Stale manifest entries — remove or fix:\n${stale.join('\n')}`).toEqual([])
  })
})
```

- [ ] **Step 3: Run coverage — reconcile against the live router**

Run: `bunx vitest run tests/audit/coverage.test.ts`
The test is the **authoritative enumerator**. If it reports `missing` routes (the inventory under-counted, e.g. an admin route not in the table above) or `stale` entries (a path typo, or a route since removed), **add/fix those manifest entries** using the same audited-or-exempt judgment, then re-run until PASS. Expected end state: PASS (both directions empty).

- [ ] **Step 4: Write the immutability guard test**

`tests/audit/immutability.test.ts`:
```ts
// Net — audit_logs / activity_logs are append-only via the API: no code mutates them
// except auditService.cleanup() (the retention purge). A new mutating path fails here.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

const FORBIDDEN = /\.(update|delete)\(\s*(audit_logs|activity_logs)\b/
const ALLOWED_FILE = 'services/auditService.ts' // cleanup() lives here

describe('audit tables are append-only via the API', () => {
  it('no update/delete on audit tables outside auditService.cleanup', () => {
    const offenders: string[] = []
    for (const file of walk(join(process.cwd(), 'src'))) {
      if (file.replace(/\\/g, '/').endsWith(ALLOWED_FILE)) continue
      if (FORBIDDEN.test(readFileSync(file, 'utf8'))) offenders.push(file)
    }
    expect(offenders, `Mutating writes to audit tables found outside cleanup:\n${offenders.join('\n')}`).toEqual([])
  })
})
```

- [ ] **Step 5: Run immutability guard — expect PASS**

Run: `bunx vitest run tests/audit/immutability.test.ts`
Expected: PASS (only `auditService.cleanup` touches those tables today).

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `bun typecheck` and `bun lint` (confirm each manifest file ≤ 200 LOC).
```bash
git add tests/audit/manifest tests/audit/coverage.test.ts tests/audit/immutability.test.ts
git commit -m "test(p7b): complete audit coverage manifest + coverage & immutability guards" --no-gpg-sign
```

---

## Wiring tasks (3–9): shared shape

Each wiring task below:
1. Adds `auditFromContext` (and `activityFromContext` where the "activity" column is filled) to each **route-layer** row in the slice table, per the "Wiring rules" reference. Rows marked `[service]` are **skipped** — the service already audits (verified in Task 9).
2. Adds `import { auditFromContext[, activityFromContext] } from '../services/audit/context'` to each touched route file.
3. Adds a behavioral spot-test file asserting the highest-value routes fire the right action (pattern below).
4. Runs the slice's route test(s) + `bun typecheck` + `bun lint`, then commits.

**Behavioral spot-test pattern** (spy on `auditService.log`; mock rbac + the domain service so the handler reaches its success path):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))
// vi.mock the domain service(s) used by the routes under test so success paths run without a DB.
import { auditService } from '../../../src/services/auditService'
// import <domain>Routes from '../../../src/routes/<domain>'

function appFor(routes: Hono) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.user = { id: 'u1', email: 'u@t.co' } as any; c.set('orgId', 'org1'); await next() })
  app.route('/', routes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}
const json = (m: string, p: string, b?: object) =>
  new Request(`http://localhost${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })

describe('<slice> audit wiring', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(auditService, 'log').mockResolvedValue(); vi.spyOn(auditService, 'logActivity').mockResolvedValue() })
  it('<route> fires <action>', async () => {
    // arrange the domain-service mock to succeed…
    const res = await appFor(/* <domain>Routes */ null as any).fetch(json('POST', '/…', {/*valid body*/}))
    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: '<action>', entityType: '<entity>', actorId: 'u1', orgId: 'org1' }))
  })
})
```

---

## Task 3: Wire campaigns

**Files:** Modify `apps/api/src/routes/campaigns.ts`; Test `apps/api/tests/audit/wiring/campaigns.test.ts`.

**Interfaces:** Consumes `auditFromContext`, `activityFromContext` (Task 1).

| Route | audit action | activity action | entity : id | note |
|---|---|---|---|---|
| POST /campaigns | campaign.created | campaign.created | campaign : `campaign.id` | after `campaignService.create(...)` |
| PUT /campaigns/:id | campaign.updated | campaign.updated | campaign : `campaignId` | after update |
| DELETE /campaigns/:id | campaign.deleted | campaign.deleted | campaign : `campaignId` | after `.delete(...)` |
| POST /campaigns/:id/schedule | campaign.scheduled | — | campaign : `campaignId` | metadata: `{ scheduledAt }` |
| POST /campaigns/:id/reschedule | campaign.rescheduled | — | campaign : `campaignId` | |
| POST /campaigns/:id/launch | campaign.launched | campaign.sent | campaign : `campaignId` | after enqueue succeeds |
| POST /campaigns/:id/pause | campaign.paused | — | campaign : `campaignId` | |
| POST /campaigns/:id/cancel | campaign.cancelled | — | campaign : `campaignId` | |
| POST /campaigns/:id/clone | campaign.cloned | campaign.created | campaign : `cloned.id` | activity id = new clone |
| POST /campaigns/:id/archive | campaign.archived | — | campaign : `campaignId` | |
| POST /campaigns/:id/ab/variant | campaign.ab_variant_created | — | campaign : `campaignId` | |
| POST /campaigns/:id/ab/winner | campaign.ab_winner_declared | — | campaign : `campaignId` | |
| PUT /campaigns/:id/ab/auto-winner | campaign.ab_auto_winner_configured | — | campaign : `campaignId` | |
| PUT /campaigns/frequency-cap | settings.updated | — | setting : `orgId` | entityType `'setting'` |
| PUT /campaigns/graymail | settings.updated | — | setting : `orgId` | entityType `'setting'` |
| POST /campaigns/graymail/reset/:email | campaign.graymail_reset | — | contact : `c.req.param('email')` | |
| PUT /campaigns/:id/rotation | routing.updated | — | routing : `campaignId` | |

Exempt (no call): `POST /campaigns/:id/draft`, `POST /campaigns/:id/ab/check-winner`.

**Worked example (launch handler):** after the block that enqueues the send and before `return`:
```ts
auditFromContext(c, { action: 'campaign.launched', entityType: 'campaign', entityId: campaignId })
activityFromContext(c, { action: 'campaign.sent', entityType: 'campaign', entityId: campaignId, description: `Launched campaign ${campaignId}` })
```

- [ ] **Step 1:** Add the import + all 17 calls per the table.
- [ ] **Step 2:** Write `tests/audit/wiring/campaigns.test.ts` spot-tests for launch (`campaign.launched` + `campaign.sent`), delete (`campaign.deleted`), and clone (`campaign.cloned`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/campaigns.test.ts tests/routes/campaigns.test.ts` → PASS.
- [ ] **Step 4:** Run: `bunx vitest run tests/audit/coverage.test.ts` → still PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire campaigns routes`.

---

## Task 4: Wire contacts

**Files:** Modify `apps/api/src/routes/contacts.ts`; Test `apps/api/tests/audit/wiring/contacts.test.ts`.

| Route | audit action | activity action | entity : id | note |
|---|---|---|---|---|
| POST /contacts/lists | list.created | list.created | list : `list.id` | |
| PUT /contacts/lists/:id | list.updated | list.updated | list : `listId` | |
| DELETE /contacts/lists/:id | list.deleted | list.deleted | list : `listId` | |
| POST /contacts/merge | contacts.merged | contact.deleted | contact : `primary_id` | metadata: `{ mergedIds }` |
| POST /contacts/bulk/delete | contacts.deleted | contact.deleted | contact : — | bulk: metadata `{ count }` |
| POST /contacts/bulk/tag | contacts.tagged | contact.updated | contact : — | bulk: metadata `{ count, tag }` |
| POST /contacts/bulk/move | contacts.moved | contact.updated | contact : — | bulk: metadata `{ count, listId }` |
| PUT /contacts/preferences/:contactId | contact.preference_updated | — | contact : `contactId` | |
| POST /contacts/:listId | contacts.created | contact.created | contact : `contact.id` | |
| PUT /contacts/item/:id | contacts.updated | contact.updated | contact : `contactId` | |
| POST /contacts/:listId/import | contacts.imported | — | contact : `listId` | metadata: `{ imported, listId }` |

Exempt: `POST /contacts/validate`, `POST /contacts/validate-single`, `POST /contacts/preferences/public/:email`.

- [ ] **Step 1:** Import + 11 calls per table (bulk rows omit `entityId`, pass `metadata`).
- [ ] **Step 2:** Spot-tests: import (`contacts.imported`), bulk/delete (`contacts.deleted` with `metadata.count`), lists POST (`list.created`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/contacts.test.ts tests/routes/contacts.test.ts` → PASS.
- [ ] **Step 4:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire contacts routes`.

---

## Task 5: Wire config/SMTP secrets + apikeys + oauth

**Files:** Modify `apps/api/src/routes/config.ts`, `apps/api/src/routes/apikeys.ts`, `apps/api/src/routes/oauth.ts`; Test `apps/api/tests/audit/wiring/config-keys-oauth.test.ts`.

| Route | audit action | entity : id | note |
|---|---|---|---|
| POST /config/smtp | smtp.created | smtp : `configId` | metadata `{ secretChanged: true }` — never the password |
| POST /config/create | smtp.created | smtp : `configId` | as above |
| PUT /config/smtp/:configId | smtp.updated | smtp : `configId` | if pass changed: `metadata { secretChanged: true }` |
| POST /config/update/:configId | smtp.updated | smtp : `configId` | |
| DELETE /config/smtp/:configId | smtp.deleted | smtp : `configId` | |
| DELETE /config/delete/:configId | smtp.deleted | smtp : `configId` | |
| POST /config/smtp/:configId/default | smtp.updated | smtp : `configId` | metadata `{ isDefault: true }` |
| POST /config/provider | smtp.created | smtp : `configId` | metadata `{ secretChanged: true }` |
| POST /api-keys | apikey.created | apikey : `id` | **never** log the key/secret |
| DELETE /api-keys/:id | apikey.revoked | apikey : `c.req.param('id')` | |
| POST /api-keys/:id/toggle | apikey.toggled | apikey : `c.req.param('id')` | |
| PUT /api-keys/:id/scopes | apikey.scopes_updated | apikey : `c.req.param('id')` | metadata `{ scopes }` |
| DELETE /oauth/:configId/disconnect | provider.disconnected | smtp : `c.req.param('configId')` | |

Exempt: all `.../test`, `.../test/:configId`, `POST /config/fetch-domains`, `POST /oauth/:configId/test`.

- [ ] **Step 1:** Imports + 13 calls. **R9 check:** grep the diff to confirm no password/secret value is passed into `changes`/`metadata`.
- [ ] **Step 2:** Spot-tests: `POST /config/smtp` (`smtp.created`, and assert the logged `metadata`/`changes` contains **no** `pass`/`password` value), `DELETE /api-keys/:id` (`apikey.revoked`), `DELETE /oauth/:configId/disconnect` (`provider.disconnected`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/config-keys-oauth.test.ts tests/routes/config.test.ts` → PASS.
- [ ] **Step 4:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire config/SMTP secrets, api-keys, oauth (no secret values)`.

---

## Task 6: Wire templates + automations + segments

**Files:** Modify `apps/api/src/routes/templates.ts`, `automations.ts`, `segments.ts`; Test `apps/api/tests/audit/wiring/content.test.ts`.

**templates.ts**

| Route | audit | activity | entity : id |
|---|---|---|---|
| POST /templates | template.created | template.created | template : `template.id` |
| PUT /templates/:id | template.updated | template.updated | template : `templateId` |
| DELETE /templates/:id | template.deleted | template.deleted | template : `templateId` |
| POST /templates/:id/duplicate | template.duplicated | template.created | template : `duplicate.id` |
| POST /templates/sections | section.created | — | section : `section.id` |
| PUT /templates/sections/:id | section.updated | — | section : `c.req.param('id')` |
| DELETE /templates/sections/:id | section.deleted | — | section : `c.req.param('id')` |
| POST /templates/from-mjml | template.created | template.created | template : `template.id` |

Exempt: `.../preview`, `POST /templates/preview`, `.../test-send`, `.../sections/:id/use`, `POST /templates/compile`.

**automations.ts**

| Route | audit | activity | entity : id |
|---|---|---|---|
| POST /automations | automation.created | automation.created | automation : `automation.id` |
| PUT /automations/:id | automation.updated | automation.updated | automation : `automationId` |
| DELETE /automations/:id | automation.deleted | automation.deleted | automation : `automationId` |
| POST /automations/:id/activate | automation.activated | automation.activated | automation : `automationId` |
| POST /automations/:id/pause | automation.paused | automation.paused | automation : `automationId` |
| POST /automations/:id/deactivate | automation.deactivated | automation.deactivated | automation : `automationId` |
| POST /automations/:id/enroll | automation.contact_enrolled | — | automation : `automationId` (metadata `{ contactId }`) |
| DELETE /automations/:id/enrollments/:contactId | automation.contact_unenrolled | — | automation : `automationId` (metadata `{ contactId }`) |
| PUT /automations/:id/goal | automation.goal_updated | — | automation : `automationId` |
| DELETE /automations/:id/goal | automation.goal_removed | — | automation : `automationId` |

**segments.ts**

| Route | audit | activity | entity : id |
|---|---|---|---|
| POST /segments | segment.created | segment.created | segment : `segment.id` |
| PUT /segments/:id | segment.updated | segment.updated | segment : `segmentId` |
| DELETE /segments/:id | segment.deleted | segment.deleted | segment : `segmentId` |
| POST /segments/:id/contacts | segment.members_added | segment.updated | segment : `segmentId` (metadata `{ count }`) |
| DELETE /segments/:id/contacts | segment.members_removed | segment.updated | segment : `segmentId` (metadata `{ count }`) |

Exempt: `POST /segments/:id/preview`.

- [ ] **Step 1:** Imports + calls in all three files.
- [ ] **Step 2:** Spot-tests: template delete (`template.deleted` + `template.deleted` activity), automation activate (`automation.activated`), segment create (`segment.created`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/content.test.ts tests/routes/templates.test.ts` → PASS.
- [ ] **Step 4:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire templates, automations, segments`.

---

## Task 7: Wire forms + pages + webhooks

**Files:** Modify `apps/api/src/routes/forms.ts`, `pages.ts`, `webhooks.ts`; Test `apps/api/tests/audit/wiring/channels.test.ts`.

**forms.ts**

| Route | audit | activity | entity : id |
|---|---|---|---|
| POST /forms | form.created | form.created | form : `form.id` |
| PUT /forms/:id | form.updated | form.updated | form : `formId` |
| DELETE /forms/:id | form.deleted | form.deleted | form : `formId` |
| POST /forms/:id/toggle | form.status_changed | — | form : `formId` |

Exempt: `POST /forms/:id/submit`, `POST /forms/:id/webhook`.

**pages.ts**

| Route | audit | activity | entity : id |
|---|---|---|---|
| POST /pages | page.created | page.created | page : `page.id` |
| PUT /pages/:id | page.updated | page.updated | page : `pageId` |
| DELETE /pages/:id | page.deleted | page.deleted | page : `pageId` |
| POST /pages/:id/publish | page.published | — | page : `pageId` |
| POST /pages/:id/unpublish | page.unpublished | — | page : `pageId` |

**webhooks.ts**

| Route | audit | entity : id |
|---|---|---|
| POST /webhooks | webhook.created | webhook : `webhook.id` |
| PUT /webhooks/:id | webhook.updated | webhook : `webhookId` |
| DELETE /webhooks/:id | webhook.deleted | webhook : `webhookId` |
| POST /webhooks/:id/toggle | webhook.toggled | webhook : `webhookId` |
| DELETE /webhooks/:id/logs | webhook.logs_cleared | webhook : `webhookId` |

Exempt: `POST /webhooks/:id/test`, all `/webhooks/bounce/*`, all `/webhooks/inbound/*`.

- [ ] **Step 1:** Imports + calls (forms/pages get audit+activity; webhooks audit-only).
- [ ] **Step 2:** Spot-tests: page publish (`page.published`), form delete (`form.deleted` + activity), webhook create (`webhook.created`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/channels.test.ts` → PASS.
- [ ] **Step 4:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire forms, pages, webhooks`.

---

## Task 8: Wire whatsapp + warmup + routing + plugins + queue + send + report

**Files:** Modify `apps/api/src/routes/whatsapp.ts`, `warmup.ts`, `routing.ts`, `plugins.ts`, `queue.ts`, `send.ts`, `report.ts`; Test `apps/api/tests/audit/wiring/infra.test.ts`.

**whatsapp.ts** — `whatsapp.config_created` (`config.id`), `whatsapp.config_updated`/`whatsapp.config_deleted` (`c.req.param('id')`), `whatsapp.template_created` (`tpl.id`, entity `template`), `whatsapp.template_deleted` (`c.req.param('id')`, entity `template`), `whatsapp.message_sent` for `POST /whatsapp/send` & `/send-text` (`msg.id`, entity `send`), `whatsapp.bulk_sent` for `/send-bulk` (no id, metadata `{ count }`). Exempt: `/templates/sync`, `/whatsapp/webhook`.

**warmup.ts** — `warmup.created` (`plan.id`), `warmup.paused`/`resumed`/`cancelled`/`deleted` (`planId`), entity `warmup`.

**routing.ts** — `routing.updated` (`PUT /routing/config`, entity `routing`, id omitted), `routing.provider_initialized` (`configId`), `routing.provider_health_changed` (`configId`), `routing.failover_triggered` (`failedConfigId`).

**plugins.ts** — `plugin.installed` (`plugin.id`), `provider.connected` (`POST /plugins/providers/install`, `plugin.id`), `plugin.enabled`/`plugin.disabled`/`plugin.settings_updated`/`plugin.uninstalled` (`pluginId`).

**queue.ts** — `job.paused`/`job.resumed`/`job.cancelled` (`jobId`, entity `job`), `suppression.added`/`suppression.removed` (`email`, entity `suppression`).

**send.ts** — `send.enqueued` (`POST /send`, `jobId`, entity `send`), `job.cancelled` (`DELETE /scheduled-jobs/:id`, `jobId`), `job.paused` (`POST /batch-pause`, no id, metadata `{ count }`), `job.resumed` (`POST /batch-resume`, metadata `{ count }`), `job.cancelled` (`DELETE /batch-cancel`, metadata `{ count }`). Exempt: `/send/spam-check`, `/test-notification`, `/provider-info`, `/parse-excel`.

**report.ts** — `send.log_deleted` (`DELETE /report/logs/:id`, `logId`, entity `send`), `send.logs_bulk_deleted` (`POST /report/logs/delete-bulk`, no id, metadata `{ count }`).

- [ ] **Step 1:** Imports + calls across all seven files (batch/bulk rows omit `entityId`, pass `metadata`).
- [ ] **Step 2:** Spot-tests: `POST /send` (`send.enqueued`), whatsapp config create (`whatsapp.config_created`), queue suppression add (`suppression.added`), plugin enable (`plugin.enabled`).
- [ ] **Step 3:** Run: `bunx vitest run tests/audit/wiring/infra.test.ts tests/routes/queue.test.ts` → PASS.
- [ ] **Step 4:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 5:** `bun typecheck` + `bun lint`.
- [ ] **Step 6:** Commit: `feat(p7b): audit-wire whatsapp, warmup, routing, plugins, queue, send, report`.

---

## Task 9: Wire admin (platform/org) + auth; verify service-layer coverage

**Files:** Modify `apps/api/src/routes/admin.ts`, `apps/api/src/routes/auth.ts`; Test `apps/api/tests/audit/wiring/admin-auth.test.ts`.

**admin.ts — route-layer calls** (these bypass or aren't covered by service self-audits):

| Route | audit action | entity : id | note |
|---|---|---|---|
| PUT /admin/platform/users/:userId/status | user.status_changed | user : `c.req.param('userId')` | changes: status transition |
| DELETE /admin/platform/users/:userId | user.deleted | user : `c.req.param('userId')` | |
| PUT /admin/platform/orgs/:orgId/status | org.status_changed | org : `c.req.param('orgId')` | direct DB update (bypasses orgService) |
| DELETE /admin/platform/orgs/:orgId | org.deleted | org : `c.req.param('orgId')` | direct DB delete (bypasses orgService) |
| PUT /admin/platform/settings/mailer | smtp.updated | smtp : — | metadata `{ secretChanged: true }` |
| DELETE /admin/platform/settings/mailer | smtp.deleted | smtp : — | |
| PUT /admin/platform/settings/oauth | oauth.updated | setting : `body.provider` | metadata `{ secretChanged: true }` |
| PUT /admin/platform/settings/cloudflare | cloudflare.updated | setting : — | metadata `{ secretChanged: true }` |
| POST /admin/cloudflare/deploy | cloudflare.worker_deployed | setting : `body.domain` | |
| DELETE /admin/cloudflare/undeploy/:domain | cloudflare.worker_undeployed | setting : `c.req.param('domain')` | |
| PUT /admin/org/slug | org.slug_changed | org : `orgId` | changes: `{ slug }` |
| PUT /admin/org/sender-identity | org.sender_identity_updated | org : `orgId` | |
| POST /admin/org/domains | domain.created | domain : `domain.id` | |
| POST /admin/org/domains/:id/verify | domain.verified | domain : `c.req.param('id')` | |
| DELETE /admin/org/domains/:id | domain.deleted | domain : `c.req.param('id')` | |
| POST /admin/org/sending-emails | sending_email.created | sending_email : `email.id` | |
| PUT /admin/org/sending-emails/:id | sending_email.updated | sending_email : `c.req.param('id')` | |
| DELETE /admin/org/sending-emails/:id | sending_email.deleted | sending_email : `c.req.param('id')` | |
| POST /admin/org/members | member.added | member : `member.id` | |
| PUT /admin/org/members/:userId/role | member.role_changed | member : `c.req.param('userId')` | changes: `{ role }` |
| DELETE /admin/org/members/:userId | member.removed | member : `c.req.param('userId')` | |
| POST /admin/permissions/:userId/grant | permission.granted | member : `c.req.param('userId')` | metadata `{ permission }` |
| POST /admin/permissions/:userId/revoke | permission.revoked | member : `c.req.param('userId')` | metadata `{ permission }` |
| DELETE /admin/permissions/:userId/:permission | permission.override_removed | member : `c.req.param('userId')` | |
| DELETE /admin/invitations/:id | invitation.cancelled | member : `c.req.param('id')` | |
| POST /admin/invitations/:id/resend | invitation.resent | member : `c.req.param('id')` | |

Exempt: `POST /admin/platform/cleanup`, `.../mailer/test`, `.../mailer/send-test`.

**auth.ts — route-layer calls:**

| Route | audit action | entity : id | note |
|---|---|---|---|
| POST /auth/switch-org | session.org_switched | org : `orgId` | metadata `{ toOrgId }` |
| POST /auth/change-password | auth.password_changed | user : `session.user.id` | never the password |
| PUT /auth/profile | user.profile_updated | user : `updated.id` | |
| PUT /auth/profile/username | user.username_updated | user : `session.user.id` | |

Exempt (actor-less, unauthenticated): `POST /auth/forgot-password`, `POST /auth/reset-password`.

- [ ] **Step 1: Verify the `[service]` rows are genuinely audited at the service layer.** For each of `PUT /admin/org` (orgService), `POST/PUT/DELETE /admin/teams*` (teamService), `POST /admin/invitations` + `.../accept/:token` (invitationService), `POST /admin/contacts/:id/gdpr-erase` (gdprService), `POST /auth/register|login|logout` (authLocalService): grep the service method for its `auditService.log({ action: '<x>' })` call. Confirm present. Add **no** route call for these. If any is NOT actually audited, add a route-layer `auditFromContext` call for it and note the discrepancy in the commit body.

Run:
```bash
grep -nE "auditService\.log\(" src/services/orgService.ts src/services/teamService.ts src/services/invitationService.ts src/services/gdprService.ts src/services/authLocalService.ts
```
- [ ] **Step 2:** Add imports + the 26 admin.ts + 4 auth.ts route-layer calls per the tables. **R9:** confirm no secret/password values in any `changes`/`metadata`.
- [ ] **Step 3:** Spot-tests (`tests/audit/wiring/admin-auth.test.ts`): `PUT /admin/platform/orgs/:orgId/status` (`org.status_changed`), `POST /admin/org/domains` (`domain.created`), `PUT /admin/org/members/:userId/role` (`member.role_changed`), `POST /auth/switch-org` (`session.org_switched`).
- [ ] **Step 4:** Run: `bunx vitest run tests/audit/wiring/admin-auth.test.ts tests/routes/auth.test.ts` → PASS.
- [ ] **Step 5:** `bunx vitest run tests/audit/coverage.test.ts` → PASS.
- [ ] **Step 6:** `bun typecheck` + `bun lint`.
- [ ] **Step 7:** Commit: `feat(p7b): audit-wire admin platform/org + auth routes`.

---

## Task 10: Admin-view verify, full suite, gate

**Files:** Read `apps/web/src/views/admin/AuditPage.vue`, `apps/web/src/lib/api/admin.ts`; docs.

- [ ] **Step 1: Verify the admin audit view renders new action types.** The read endpoints (`/admin/audit-logs`, `/admin/activity-logs`, `/admin/activity/recent`) and `AuditPage.vue` already exist and render whatever `action`/`entity_type` strings the API returns (data-driven, R2). Confirm `AuditPage.vue` does **not** hardcode a closed list of action labels that would hide the new actions; if it maps actions to labels via a fixed object, confirm it falls back to the raw action string for unknown keys (render-whatever-the-data-contains). No new view. If a fixed map exists without a fallback, add a fallback (surgical).
- [ ] **Step 2: Optional filter facets (cheap, only if trivial).** If `AuditPage.vue` already has an action/entity filter, confirm it reads options from returned data, not a hardcoded list. Skip if it would exceed the slice's scope.
- [ ] **Step 3: Run the full backend suite** (explicit P7a lesson — focused tests missed cross-file regressions):

Run: `bun test` (from `apps/api/`), i.e. `bunx vitest run`.
Expected: green, including the new `tests/audit/**` files. Investigate any regression before proceeding (do not quarantine).

- [ ] **Step 4: Full gate.**
  - `bun typecheck` — api `tsc` **49** (no net-new errors), web own-src ≤ **33**.
  - `bun lint` — clean; confirm **no source file** introduced/edited by P7b exceeds 200 LOC (`awk 'END{print NR}'` on `auditService.ts`, `audit/types.ts`, each manifest file).
  - Re-run `bunx vitest run tests/audit` → all PASS (context, coverage, immutability, all wiring spot-tests).
- [ ] **Step 5: Update phase docs/memory.** Mark P7b complete in `.superpowers/sdd/progress.md` (or the phase tracker) and update the `dispatch-p7a-status.md` / session-status memory line that still says "i18n remains" to reflect P7b done + i18n explicitly deferred (not in P7 buildable scope).
- [ ] **Step 6: Commit:** `feat(p7b): verify admin audit view + full-suite gate; mark P7b complete`.

---

## Self-review (against the spec `2026-07-03-p7b-audit-event-wiring-design.md`)

- **Goal 1 — complete `audit_logs` coverage:** Tasks 3–9 wire all 145 route-layer audit-worthy handlers; Task 2's manifest classifies all 197 mutating routes. ✓
- **Goal 2 — regression-proof completeness:** Task 2 coverage test (two-way, reads live `routes`). ✓
- **Goal 3 — API-immutability guard:** Task 2 immutability test. ✓
- **Goal 4 — dashboard feed enrichment:** `activityFromContext` folded into every content-CRUD row (Tasks 3,4,6,7). ✓
- **Decision A** (complete + API-immutable, not cryptographic): coverage + immutability tests, no hash-chain. ✓
- **Decision B** (route layer, not service): helper takes `Context`; existing service self-audits untouched (Task 9 verifies, doesn't re-plumb). ✓
- **Decision C** (`audit_logs` mandatory, `activity_logs` secondary): manifest enforces audit; activity only for content CRUD. ✓
- **Decision D** (typed union, extracted from over-cap `auditService.ts`): Task 1. ✓
- **Decision E** (static manifest + behavioral sampling): Task 2 manifest/coverage + per-slice spot-tests. ✓
- **Refinements caught during planning** (documented, not in the original spec): (a) unauthenticated `forgot/reset-password` are `actor-less` exempt — the route helper can't derive an actor; (b) the helper reads context **defensively** and never throws (spec said `requireAuth`/`getOrgId`, which throw — replaced with non-throwing reads to preserve the fire-and-forget invariant); (c) the manifest is **split by domain** (R1 200-LOC) and the coverage test is the authoritative route enumerator that Task 2 reconciles against; (d) bulk/batch ops omit `entityId` and carry `metadata.count`.
- **Placeholder scan:** call template, worked example, per-route tables, and test patterns are concrete; no "TBD"/"handle edge cases". Wiring calls are uniform one-liners fully specified by the tables. ✓
- **Type consistency:** `auditFromContext`/`activityFromContext` signatures identical in Task 1 and every wiring task; action strings in the tables all appear in the Task 1 `AuditAction`/`ActivityAction` unions. ✓

## Out of scope / follow-ups (carried)

- i18n / vue-i18n (deferred pre-GA).
- Cryptographic hash-chaining + DB-level append-only constraints (P8/GA).
- Password-reset security events → audit at the **service layer** (authLocalService) in P8, where the resolved user is known.
- Carried release-blocker for P8: `GET`/`DELETE /api/scheduled-jobs` cross-tenant IDOR.
