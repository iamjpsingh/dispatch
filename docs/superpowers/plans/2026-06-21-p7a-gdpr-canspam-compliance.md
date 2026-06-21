# P7a — GDPR / CAN-SPAM Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make outbound email CAN-SPAM-compliant (enforced sender-identity footer) and recipient data GDPR-compliant (export, anonymizing erasure, retention purge).

**Architecture:** Six isolated units on the existing Postgres+Drizzle / BullMQ stack: (1) schema + a one-way email-hash util; (2) org sender-identity service/route/UI; (3) a pure footer builder injected at the single worker send choke point + a server-side launch/worker hard-gate; (4) a permission-gated DSAR export; (5) an anonymizing erasure with an analytics/log cascade + suppression-by-hash; (6) a daily retention purge job. Each unit is independently testable and committable.

**Tech Stack:** Bun · Hono · Drizzle (bun-sql prod / PGlite tests) · Vitest · BullMQ/Valkey (ioredis) · shadcn-vue · zod · node:crypto (HMAC-SHA256).

## Global Constraints

Every task implicitly includes these (copied from the spec + project rules):

- **R1 TypeScript only**; `any` only as a last resort with a stated reason.
- **R3 shadcn-vue only** for UI; install missing primitives via the shadcn CLI; plain layout `<div>`s are fine.
- **R4 Schema changes via generated migrations only**: edit the Drizzle schema, then `cd apps/api && bunx drizzle-kit generate`. Never hand-write/-edit a migration SQL file.
- **R5 Prove it:** after each task, `cd apps/api && bunx tsc --noEmit` must stay at the frozen baseline **49** (0 net new); `bun lint` clean; new tests green.
- **R7 Simplicity / R8 surgical:** minimum code; touch only what the task needs; preserve handler bodies; don't refactor adjacent code.
- **R9 Security structural & server-side:** every read/write scoped by a **server-derived** `orgId`/`userId` (from the session/persisted row, never client-supplied); `SUPPRESSION_HASH_SECRET` is server-only, never returned to the browser; validate inputs with zod at every boundary.
- **Gate (verify before "done"):** api tsc 49 · web own-src ≤ 33 (`vue-tsc -b` total minus `../api/` lines) · backend suite green incl. new nets · lint clean.
- **Commits:** `git commit --no-gpg-sign`, stage only the task's explicit paths (never `.claude/*`, `.mcp.json`, `git add -A`), end every message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Tests run under Vitest** (`cd apps/api && bunx vitest run <file>`), NOT `bun test` (no `vi` global there). API tests are excluded from `tsc` (`include: src/** + index.ts`).
- **Erasure semantics:** anonymize (not hard-delete); de-identify only the PII-bearing rows; keep de-identified aggregates. Footer: **hard-gate** the send when no postal address.

## File Structure

**New files:**
- `apps/api/src/utils/suppressionHash.ts` — `hashEmail(email)` (HMAC-SHA256, server secret). One responsibility: deterministic one-way email hashing.
- `apps/api/src/services/gdprService.ts` — `exportRecipient` + `eraseRecipient`. One responsibility: recipient data-subject operations.
- `apps/api/src/services/retentionService.ts` — `purgeExpired`. One responsibility: time-window deletion of aged rows.
- `apps/api/src/services/queue/retentionJob.ts` — register + process the daily repeatable purge.
- `apps/api/tests/services/gdpr.test.ts`, `apps/api/tests/services/retention.test.ts`, `apps/api/tests/services/suppressionHash.test.ts`, `apps/api/tests/services/canspamFooter.test.ts`.

**Modified files:**
- `apps/api/src/db/pg/schema/identity.ts` — org sender columns.
- `apps/api/src/db/pg/schema/queue.ts` — `suppression_list.email_hash` (+ `email` nullable).
- `apps/api/src/services/orgService.ts` — `getSenderIdentity` / `setSenderIdentity`.
- `apps/api/src/routes/admin.ts` — sender-identity route + GDPR export/erase routes.
- `apps/api/src/routes/campaigns.ts` — `assertSenderIdentity` launch gate.
- `apps/api/src/services/queue/processor.ts` — footer injection + worker gate.
- `apps/api/src/services/queue/suppressionStore.ts` — hash-aware `isSuppressed` + `suppressByHash`.
- `apps/api/src/services/contactService.ts` — import-time suppression check.
- `apps/api/src/services/rbacService.ts` — `GDPR_MANAGE` permission.
- `apps/api/src/db/pg/seed.ts` — grant `gdpr.manage` to owner/admin roles.
- `apps/api/src/services/auditService.ts` — `contacts.erased` + `data.retention_purge` actions.
- `apps/api/src/utils/canspam.ts` (new, tiny) — `buildComplianceFooter` pure fn.
- `apps/web/src/views/admin/OrgSettings.vue` — sender-identity card.
- `apps/web/src/lib/api/admin.ts` — `getSenderIdentity`/`updateSenderIdentity`/`gdprExport`/`gdprErase`.
- the web contact detail view — export/erase actions.
- `.env.example` — `SUPPRESSION_HASH_SECRET`.

---

### Task 1: Schema + email-hash util + env

**Files:**
- Modify: `apps/api/src/db/pg/schema/identity.ts` (organizations)
- Modify: `apps/api/src/db/pg/schema/queue.ts` (suppression_list)
- Create: `apps/api/src/utils/suppressionHash.ts`
- Create: `apps/api/tests/services/suppressionHash.test.ts`
- Modify: `.env.example`
- Generate: a migration under `apps/api/src/db/pg/migrations/`

**Interfaces:**
- Produces: `hashEmail(email: string): string` (lowercase+trim → hex HMAC-SHA256). `organizations.sender_company_name|postal_address|postal_address_set_at`. `suppression_list.email_hash` (nullable text), `suppression_list.email` now nullable.

- [ ] **Step 1: Write the failing test** — `apps/api/tests/services/suppressionHash.test.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { hashEmail } from '../../src/utils/suppressionHash'

describe('hashEmail', () => {
  beforeAll(() => { process.env.SUPPRESSION_HASH_SECRET = 'test-suppression-secret' })

  it('is deterministic and case/space-insensitive', () => {
    expect(hashEmail('A@B.com')).toBe(hashEmail('  a@b.com '))
  })
  it('differs for different emails and is not the plaintext', () => {
    const h = hashEmail('a@b.com')
    expect(h).not.toBe(hashEmail('c@d.com'))
    expect(h).not.toContain('a@b.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/suppressionHash.test.ts`
Expected: FAIL — cannot find module `../../src/utils/suppressionHash`.

- [ ] **Step 3: Implement the util** — `apps/api/src/utils/suppressionHash.ts`

```ts
import { createHmac } from 'node:crypto'

/**
 * One-way, deterministic hash of an email for suppression-by-hash (GDPR erasure
 * keeps recipients suppressed without retaining their address). Server-only
 * secret; not reversible.
 */
export function hashEmail(email: string): string {
  const secret = process.env.SUPPRESSION_HASH_SECRET
  if (!secret) throw new Error('SUPPRESSION_HASH_SECRET is not set')
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex')
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/suppressionHash.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the org sender columns** — in `apps/api/src/db/pg/schema/identity.ts`, inside the `organizations` `pgTable` column object, after `updated_at`:

```ts
    sender_company_name: text('sender_company_name'),
    postal_address: text('postal_address'),
    postal_address_set_at: ts('postal_address_set_at'),
```

- [ ] **Step 6: Add the suppression hash column + make email nullable** — in `apps/api/src/db/pg/schema/queue.ts`, in `suppression_list`: change `email: text('email').notNull()` to `email: text('email')`, and add `email_hash: text('email_hash')`. Add a unique to the table's index array:

```ts
    unique('uq_suppress_user_hash').on(t.user_id, t.email_hash),
```

- [ ] **Step 7: Generate the migration (R4)**

Run: `cd apps/api && bunx drizzle-kit generate`
Expected: a new `NNNN_*.sql` migration appears under `src/db/pg/migrations/` adding the 3 org columns, `suppression_list.email_hash`, dropping the `email` NOT NULL, and the new unique. Do NOT hand-edit it.

- [ ] **Step 8: Verify the migration applies (schema loads in PGlite)**

Run: `cd apps/api && bunx vitest run tests/services/suppressionHash.test.ts` (the PGlite template re-migrates; a broken migration fails here). Also `bunx tsc --noEmit | grep -cE "error TS"` → still `49`.
Expected: tests PASS; tsc 49.

- [ ] **Step 9: Document the env** — add to `.env.example`:

```
# One-way HMAC secret for GDPR suppression-by-hash (32+ random bytes). Server-only.
SUPPRESSION_HASH_SECRET=
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/utils/suppressionHash.ts apps/api/tests/services/suppressionHash.test.ts \
        apps/api/src/db/pg/schema/identity.ts apps/api/src/db/pg/schema/queue.ts \
        apps/api/src/db/pg/migrations .env.example
git commit --no-gpg-sign -m "feat(p7a): sender-identity + suppression-hash schema + hashEmail util

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Sender-identity service + route + admin UI

**Files:**
- Modify: `apps/api/src/services/orgService.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/tests/services/gdpr.test.ts` (sender-identity describe block; file shared with Task 5/6)
- Modify: `apps/web/src/lib/api/admin.ts`, `apps/web/src/views/admin/OrgSettings.vue`

**Interfaces:**
- Consumes: `getDb()`, `organizations` (Task 1 columns).
- Produces: `orgService.getSenderIdentity(orgId): Promise<{sender_company_name: string|null; postal_address: string|null; postal_address_set_at: string|null}>`; `orgService.setSenderIdentity(orgId, { sender_company_name?, postal_address? }): Promise<void>`. Route `GET /admin/org/sender-identity`, `PUT /admin/org/sender-identity`. Web `adminApi.getSenderIdentity()`, `adminApi.updateSenderIdentity(input)`.

- [ ] **Step 1: Write the failing test** — add to `apps/api/tests/services/gdpr.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { orgService } from '../../src/services/orgService'

const ORG = 'org_test'

describe('orgService sender identity', () => {
  let db: TestDb
  beforeEach(async () => {
    process.env.SUPPRESSION_HASH_SECRET = 'test-suppression-secret'
    db = await freshDbMigrated(); __setTestDb(db)
    await db.insert(organizations).values({ id: ORG, name: 'Acme', slug: 'acme' })
  }, 30_000)
  afterEach(() => __setTestDb(null))

  it('sets and reads sender identity and stamps postal_address_set_at', async () => {
    await orgService.setSenderIdentity(ORG, { sender_company_name: 'Acme Inc', postal_address: '1 A St, NY' })
    const id = await orgService.getSenderIdentity(ORG)
    expect(id.sender_company_name).toBe('Acme Inc')
    expect(id.postal_address).toBe('1 A St, NY')
    expect(id.postal_address_set_at).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: FAIL — `orgService.setSenderIdentity is not a function`.

- [ ] **Step 3: Implement the service methods** — append to the `OrgService` class in `apps/api/src/services/orgService.ts` (imports `eq`, `organizations`, `getDb` already present):

```ts
  async getSenderIdentity(orgId: string) {
    const [org] = await getDb()
      .select({
        sender_company_name: organizations.sender_company_name,
        postal_address: organizations.postal_address,
        postal_address_set_at: organizations.postal_address_set_at,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
    return org ?? { sender_company_name: null, postal_address: null, postal_address_set_at: null }
  }

  async setSenderIdentity(orgId: string, input: { sender_company_name?: string; postal_address?: string }): Promise<void> {
    const values: Record<string, string> = { updated_at: new Date().toISOString() }
    if (input.sender_company_name !== undefined) values.sender_company_name = input.sender_company_name
    if (input.postal_address !== undefined) {
      values.postal_address = input.postal_address
      values.postal_address_set_at = new Date().toISOString()
    }
    await getDb().update(organizations).set(values).where(eq(organizations.id, orgId))
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the routes** — in `apps/api/src/routes/admin.ts`, define a schema near the other admin schemas and add two chained endpoints (keep the single fluent chain; `getOrgId(c)` is server-derived; reuse the org-management permission used by `PUT /admin/org`, e.g. `requirePermission(PERMISSIONS.ORG_MANAGE)`):

```ts
const SenderIdentitySchema = z.object({
  sender_company_name: z.string().max(200).optional(),
  postal_address: z.string().max(1000).optional(),
})
```
```ts
  .get('/admin/org/sender-identity', requirePermission(PERMISSIONS.ORG_VIEW), async (c) => {
    const orgId = getOrgId(c)
    return success(c, await orgService.getSenderIdentity(orgId))
  })
  .put('/admin/org/sender-identity', requirePermission(PERMISSIONS.ORG_MANAGE), zValidator('json', SenderIdentitySchema), async (c) => {
    const orgId = getOrgId(c)
    await orgService.setSenderIdentity(orgId, c.req.valid('json'))
    return success(c, undefined, 'Sender identity updated')
  })
```
(Use the exact permission constants present in `PERMISSIONS` for org view/manage — confirm names in `rbacService.ts`.)

- [ ] **Step 6: Verify api gate**

Run: `cd apps/api && bunx tsc --noEmit | grep -cE "error TS"`
Expected: `49`. Then `bunx vitest run tests/app-boot.test.ts tests/routes/versioning.test.ts` → pass.

- [ ] **Step 7: Add the web client methods** — in `apps/web/src/lib/api/admin.ts` (typed `hc<AdminRoutes>` client already present), add:

```ts
  getSenderIdentity: async (): Promise<{ sender_company_name: string | null; postal_address: string | null; postal_address_set_at: string | null }> => {
    const res = await client.admin.org['sender-identity'].$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load sender identity')
    return body.data as { sender_company_name: string | null; postal_address: string | null; postal_address_set_at: string | null }
  },
  updateSenderIdentity: async (input: { sender_company_name?: string; postal_address?: string }) => {
    const res = await client.admin.org['sender-identity'].$put({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update sender identity')
  },
```

- [ ] **Step 8: Add the OrgSettings card** — in `apps/web/src/views/admin/OrgSettings.vue`, add a shadcn `Card` (install via `bunx shadcn-vue@latest add card label input button textarea` if any are missing) with `sender_company_name` + `postal_address` fields bound to a `ref`, loaded via `adminApi.getSenderIdentity()` on mount and saved via `adminApi.updateSenderIdentity()`. Include the notice text: "A valid physical postal address is required before you can send campaigns (CAN-SPAM)." Use shadcn primitives only (R3); plain layout `<div>`s for spacing are fine.

- [ ] **Step 9: Verify web gate**

Run: `cd apps/web && OUT=$(bunx vue-tsc -b 2>&1); echo own-src=$(( $(echo "$OUT"|grep -cE "error TS") - $(echo "$OUT"|grep -E "error TS"|grep -cE "\.\./api/|/apps/api/") ))`
Expected: `own-src=33` (no new own-src errors).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/orgService.ts apps/api/src/routes/admin.ts apps/api/tests/services/gdpr.test.ts \
        apps/web/src/lib/api/admin.ts apps/web/src/views/admin/OrgSettings.vue
git commit --no-gpg-sign -m "feat(p7a): org sender-identity service, route, and admin UI card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: CAN-SPAM footer + hard-gate

**Files:**
- Create: `apps/api/src/utils/canspam.ts`
- Create: `apps/api/tests/services/canspamFooter.test.ts`
- Modify: `apps/api/src/services/queue/processor.ts`
- Modify: `apps/api/src/routes/campaigns.ts`
- Test: add a launch-gate net to `apps/api/tests/services/gdpr.test.ts`

**Interfaces:**
- Consumes: `orgService.get(orgId)` (returns org incl. `postal_address`, `sender_company_name`, `name`); `orgService.getSenderIdentity` (Task 2).
- Produces: `buildComplianceFooter(org: { sender_company_name: string|null; name: string; postal_address: string|null }, unsubscribeUrl: string): string`; `assertSenderIdentity(org): void` (throws `AppError(400, …)` when `postal_address` is empty).

- [ ] **Step 1: Write the failing test** — `apps/api/tests/services/canspamFooter.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildComplianceFooter } from '../../src/utils/canspam'

describe('buildComplianceFooter', () => {
  it('includes company name, postal address, and an unsubscribe link', () => {
    const html = buildComplianceFooter(
      { sender_company_name: 'Acme Inc', name: 'Acme', postal_address: '1 A St, NY' },
      'mailto:x@y.z?subject=unsubscribe'
    )
    expect(html).toContain('Acme Inc')
    expect(html).toContain('1 A St, NY')
    expect(html).toContain('unsubscribe')
  })
  it('falls back to org name when company name is blank, and escapes HTML', () => {
    const html = buildComplianceFooter(
      { sender_company_name: null, name: 'A<b>', postal_address: '1 St & 2nd' },
      'mailto:x@y.z'
    )
    expect(html).toContain('A&lt;b&gt;')
    expect(html).toContain('1 St &amp; 2nd')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/canspamFooter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/utils/canspam.ts`

```ts
import { AppError } from './validate'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** CAN-SPAM footer: sender identity + valid physical postal address + unsubscribe link. */
export function buildComplianceFooter(
  org: { sender_company_name: string | null; name: string; postal_address: string | null },
  unsubscribeUrl: string
): string {
  const who = escapeHtml(org.sender_company_name || org.name)
  const where = escapeHtml(org.postal_address || '')
  return (
    `<div style="font-size:12px;color:#666;margin-top:24px;border-top:1px solid #ddd;padding-top:12px;">` +
    `${who}<br>${where}<br>` +
    `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>` +
    `</div>`
  )
}

/** Hard-gate: a marketing send requires a valid physical postal address (CAN-SPAM). */
export function assertSenderIdentity(org: { postal_address: string | null }): void {
  if (!org.postal_address || !org.postal_address.trim()) {
    throw new AppError(400, 'Set your organization physical mailing address (Settings → Org) before sending campaigns')
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/canspamFooter.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the launch hard-gate** — in `apps/api/src/routes/campaigns.ts`, `POST /campaigns/:id/launch`, after the status check and before the content resolution, add (import `orgService` and `assertSenderIdentity`):

```ts
    // CAN-SPAM hard-gate: org must have a physical postal address before any marketing send.
    const org = await orgService.get(orgId)
    if (!org) return error(c, 'Organization not found', 404)
    try { assertSenderIdentity(org) } catch (e) { return error(c, (e as Error).message, 400) }
```

- [ ] **Step 6: Wire the worker footer + defense-in-depth gate** — in `apps/api/src/services/queue/processor.ts`, load the org ONCE per job (not per email) where the job is set up, and build the footer once:

```ts
// near job start, after job is loaded:
const org = job.org_id ? await orgService.get(job.org_id) : null
const footer = org?.postal_address
  ? buildComplianceFooter(org, job.from_email ? `mailto:${job.from_email}?subject=unsubscribe` : '')
  : ''
```
Then in `sendOne` (or where `html` is finalized before `transport.send`), append the footer:
```ts
const finalHtml = footer ? `${html}${footer}` : html
```
and pass `finalHtml` to `transport.send({ ..., html: finalHtml, text: htmlToText(finalHtml) })`. If `org` has no `postal_address`, the job should fail closed: log + mark the job failed rather than send a non-compliant batch (defense-in-depth for sends queued before the launch gate). Match the file's existing org-loading/threading style; thread `footer` into `sendOne` as a parameter.

- [ ] **Step 7: Launch-gate net** — add to `apps/api/tests/services/gdpr.test.ts` a test asserting `assertSenderIdentity` throws for `{postal_address: null}` and does not throw for a set address (pure-function level; the route wiring is covered by app-boot + manual). Example:

```ts
import { assertSenderIdentity } from '../../src/utils/canspam'
it('hard-gate throws without a postal address, passes with one', () => {
  expect(() => assertSenderIdentity({ postal_address: null })).toThrow()
  expect(() => assertSenderIdentity({ postal_address: '1 A St' })).not.toThrow()
})
```

- [ ] **Step 8: Verify gates**

Run: `cd apps/api && bunx vitest run tests/services/canspamFooter.test.ts tests/services/gdpr.test.ts tests/app-boot.test.ts` and `bunx tsc --noEmit | grep -cE "error TS"`.
Expected: tests PASS; tsc `49`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/utils/canspam.ts apps/api/tests/services/canspamFooter.test.ts \
        apps/api/src/services/queue/processor.ts apps/api/src/routes/campaigns.ts apps/api/tests/services/gdpr.test.ts
git commit --no-gpg-sign -m "feat(p7a): CAN-SPAM footer injection + sender-identity hard-gate (launch + worker)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: GDPR data export (DSAR) + permission

**Files:**
- Modify: `apps/api/src/services/rbacService.ts` (add `GDPR_MANAGE`)
- Modify: `apps/api/src/db/pg/seed.ts` (grant `gdpr.manage` to owner/admin)
- Create: `apps/api/src/services/gdprService.ts` (`exportRecipient`)
- Modify: `apps/api/src/routes/admin.ts` (export route)
- Modify: `apps/api/src/services/auditService.ts` (no change if `contacts.exported` already exists; else add)
- Test: `apps/api/tests/services/gdpr.test.ts` (export describe)
- Modify: `apps/web/src/lib/api/admin.ts` + the web contact detail view (export action)

**Interfaces:**
- Consumes: `getDb()`, `contactService.getContact(orgId, contactId)`, schemas `event_analytics`, `engagement_events`, `email_logs`, `contacts`.
- Produces: `PERMISSIONS.GDPR_MANAGE = 'gdpr.manage'`. `gdprService.exportRecipient(orgId: string, contactId: string): Promise<RecipientExport | null>` where `RecipientExport = { contact; events; engagement; emailLogs }`. Route `GET /admin/contacts/:id/gdpr-export`. Web `adminApi.gdprExport(contactId)`.

- [ ] **Step 1: Write the failing test** — add an `exportRecipient` describe to `apps/api/tests/services/gdpr.test.ts` (seed an org, a contact, one `event_analytics` row with `recipient_email` = the contact email; assert the export bundles the contact + that event, and that a different org's id returns null/empty — org scoping):

```ts
import { gdprService } from '../../src/services/gdprService'
import { contacts, event_analytics } from '../../src/db/pg/schema'
// inside describe with db/__setTestDb setup:
it('exports a recipient bundle, org-scoped', async () => {
  await db.insert(contacts).values({ id: 'c1', org_id: ORG, user_id: 'u1', list_id: 'l1', email: 'p@q.r', status: 'active' } as any)
  await db.insert(event_analytics).values({ id: 'e1', org_id: ORG, user_id: 'u1', event_type: 'open', recipient_email: 'p@q.r' } as any)
  const out = await gdprService.exportRecipient(ORG, 'c1')
  expect(out?.contact.email).toBe('p@q.r')
  expect(out?.events.length).toBe(1)
  expect(await gdprService.exportRecipient('org_other', 'c1')).toBeNull()
})
```
(Adjust the insert column lists to the real `contacts`/`event_analytics` columns — match the schema.)

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: FAIL — `gdprService` not found.

- [ ] **Step 3: Implement `exportRecipient`** — `apps/api/src/services/gdprService.ts`

```ts
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { contacts, event_analytics, engagement_events, email_logs } from '../db/pg/schema'
import { contactService } from './contactService'

export interface RecipientExport {
  contact: Record<string, unknown>
  events: Record<string, unknown>[]
  engagement: Record<string, unknown>[]
  emailLogs: Record<string, unknown>[]
}

class GdprService {
  async exportRecipient(orgId: string, contactId: string): Promise<RecipientExport | null> {
    const contact = await contactService.getContact(orgId, contactId)
    if (!contact) return null
    const db = getDb()
    const [events, engagement, emailLogs] = await Promise.all([
      db.select().from(event_analytics).where(and(eq(event_analytics.org_id, orgId), eq(event_analytics.recipient_email, contact.email))),
      db.select().from(engagement_events).where(eq(engagement_events.contact_id, contactId)),
      db.select().from(email_logs).where(and(eq(email_logs.org_id, orgId), eq(email_logs.email, contact.email))),
    ])
    return { contact: contact as unknown as Record<string, unknown>, events, engagement, emailLogs }
  }
}

export const gdprService = new GdprService()
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the permission + seed grant** — in `apps/api/src/services/rbacService.ts` `PERMISSIONS`, add `GDPR_MANAGE: 'gdpr.manage',`. In `apps/api/src/db/pg/seed.ts`, add `'gdpr.manage'` to the `permissions` arrays of the owner and admin system roles (data-driven; do not hardcode elsewhere).

- [ ] **Step 6: Add `contacts.erased` + `data.retention_purge` audit actions** — in `apps/api/src/services/auditService.ts` `AuditAction` union, add `| 'contacts.erased' | 'data.retention_purge'` (leave `contacts.exported` if already present).

- [ ] **Step 7: Add the export route** — in `apps/api/src/routes/admin.ts` (org-scoped, `GDPR_MANAGE`, audited, JSON download):

```ts
  .get('/admin/contacts/:id/gdpr-export', requirePermission(PERMISSIONS.GDPR_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const user = requireAuth(c)
    const contactId = c.req.param('id')
    const data = await gdprService.exportRecipient(orgId, contactId)
    if (!data) return error(c, 'Contact not found', 404)
    auditService.log({ orgId, actorId: user.id, action: 'contacts.exported', entityType: 'contact', entityId: contactId })
    c.header('Content-Type', 'application/json')
    c.header('Content-Disposition', `attachment; filename="gdpr-export-${contactId}.json"`)
    return c.body(JSON.stringify(data, null, 2))
  })
```

- [ ] **Step 8: Verify api gate**

Run: `cd apps/api && bunx tsc --noEmit | grep -cE "error TS"` → `49`; `bunx vitest run tests/services/gdpr.test.ts tests/app-boot.test.ts` → pass.

- [ ] **Step 9: Web export action** — in `apps/web/src/lib/api/admin.ts` add `gdprExport` using the `rpcFetch` fallback (file download, not the envelope):

```ts
  gdprExport: async (contactId: string): Promise<Blob> => {
    const res = await rpcFetch(`${rpcBase()}/admin/contacts/${contactId}/gdpr-export`, { method: 'GET' })
    if (!res.ok) throw new Error('Export failed')
    return res.blob()
  },
```
(Ensure `rpcBase`, `rpcFetch` are imported in admin.ts — they are if any fallback already exists; else add the import.) Add an "Export data (GDPR)" shadcn `Button` to the web contact detail view that calls `gdprExport`, then triggers a browser download of the blob.

- [ ] **Step 10: Verify web gate + commit**

Run: `cd apps/web && OUT=$(bunx vue-tsc -b 2>&1); echo own-src=$(( $(echo "$OUT"|grep -cE "error TS") - $(echo "$OUT"|grep -E "error TS"|grep -cE "\.\./api/|/apps/api/") ))` → `own-src=33`.

```bash
git add apps/api/src/services/gdprService.ts apps/api/src/services/rbacService.ts apps/api/src/db/pg/seed.ts \
        apps/api/src/services/auditService.ts apps/api/src/routes/admin.ts apps/api/tests/services/gdpr.test.ts \
        apps/web/src/lib/api/admin.ts apps/web/src/views/<contact-detail-view>.vue
git commit --no-gpg-sign -m "feat(p7a): GDPR DSAR export (service, GDPR_MANAGE perm, route, UI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: GDPR erasure (anonymize + suppression hash + cascade)

**Files:**
- Modify: `apps/api/src/services/gdprService.ts` (`eraseRecipient`)
- Modify: `apps/api/src/services/queue/suppressionStore.ts` (hash-aware checks + `suppressByHash`)
- Modify: `apps/api/src/services/contactService.ts` (import-time suppression check)
- Modify: `apps/api/src/routes/admin.ts` (erase route)
- Test: `apps/api/tests/services/gdpr.test.ts` (erasure describe)
- Modify: `apps/web/src/lib/api/admin.ts` + the web contact detail view (erase action)

**Interfaces:**
- Consumes: `hashEmail` (Task 1), `contactService.getContact`, `suppressionStore`.
- Produces: `gdprService.eraseRecipient(orgId, contactId, actorId): Promise<boolean>`; `suppressionStore.isSuppressed(userId, email)` now also matches `email_hash`; `suppressionStore.suppressByHash(userId, orgId, emailHash, reason): Promise<void>`. Route `POST /admin/contacts/:id/gdpr-erase`. Web `adminApi.gdprErase(contactId)`.

- [ ] **Step 1: Write the failing test** — add an erasure describe to `apps/api/tests/services/gdpr.test.ts`:

```ts
import { hashEmail } from '../../src/utils/suppressionHash'
import { suppressionStore } from '../../src/services/queue/suppressionStore'
import { email_logs } from '../../src/db/pg/schema'
it('erasure anonymizes the contact, de-identifies analytics/logs, and suppresses by hash (idempotent, org-scoped)', async () => {
  await db.insert(contacts).values({ id: 'c2', org_id: ORG, user_id: 'u1', list_id: 'l1', email: 'gone@x.y', first_name: 'Gus', status: 'active' } as any)
  await db.insert(event_analytics).values({ id: 'e2', org_id: ORG, user_id: 'u1', event_type: 'open', recipient_email: 'gone@x.y' } as any)
  await db.insert(email_logs).values({ id: 'lg1', org_id: ORG, email: 'gone@x.y', first_name: 'Gus', status: 'sent' } as any)

  const ok = await gdprService.eraseRecipient(ORG, 'c2', 'admin1')
  expect(ok).toBe(true)
  const after = await gdprService.exportRecipient(ORG, 'c2')
  expect(after?.contact.email == null).toBe(true)              // PII cleared
  expect(after?.contact.status).toBe('erased')                // tombstone kept
  expect(await suppressionStore.isSuppressed('u1', 'gone@x.y')).toBe(true) // suppressed by hash
  await expect(gdprService.eraseRecipient(ORG, 'c2', 'admin1')).resolves.toBe(true) // idempotent
  expect(await gdprService.eraseRecipient('org_other', 'c2', 'admin1')).toBe(false) // org-scoped
})
```
(Match the real column lists.)

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: FAIL — `eraseRecipient` / `suppressByHash` not defined.

- [ ] **Step 3: Make suppression hash-aware** — in `apps/api/src/services/queue/suppressionStore.ts` import `hashEmail`, extend `isSuppressed` to match either column, and add `suppressByHash`:

```ts
async isSuppressed(userId: string, email: string): Promise<boolean> {
  const normalized = email.toLowerCase()
  const hash = hashEmail(normalized)
  const [row] = await getDb()
    .select({ id: suppression_list.id })
    .from(suppression_list)
    .where(and(eq(suppression_list.user_id, userId), or(eq(suppression_list.email, normalized), eq(suppression_list.email_hash, hash))))
    .limit(1)
  return !!row
}

async suppressByHash(userId: string, orgId: string | null, emailHash: string, reason: string): Promise<void> {
  await getDb()
    .insert(suppression_list)
    .values({ id: generateId('sup'), user_id: userId, org_id: orgId, email: null, email_hash: emailHash, reason })
    .onConflictDoNothing({ target: [suppression_list.user_id, suppression_list.email_hash] })
}
```
(Import `or` from `drizzle-orm`; `email` is now nullable per Task 1.)

- [ ] **Step 4: Implement `eraseRecipient`** — append to `GdprService` in `apps/api/src/services/gdprService.ts` (de-identify ONLY the PII-bearing rows; `engagement_events` needs no change because the contact tombstone holds no PII; run in a transaction):

```ts
async eraseRecipient(orgId: string, contactId: string, actorId: string): Promise<boolean> {
  const contact = await contactService.getContact(orgId, contactId)
  if (!contact) return false
  const email = contact.email
  const db = getDb()
  if (email) {
    const hash = hashEmail(email)
    await db.transaction(async (tx) => {
      await tx.update(event_analytics).set({ recipient_email: null })
        .where(and(eq(event_analytics.org_id, orgId), eq(event_analytics.recipient_email, email)))
      await tx.update(email_logs).set({ email: '[erased]', first_name: null, company: null })
        .where(and(eq(email_logs.org_id, orgId), eq(email_logs.email, email)))
      await tx.update(contacts)
        .set({ email: null, first_name: null, last_name: null, company: null, phone: null, custom_fields: '{}', status: 'erased', updated_at: new Date().toISOString() })
        .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
    })
    await suppressionStore.suppressByHash(contact.user_id, orgId, hash, 'gdpr_erasure')
  } else {
    // already anonymized — idempotent no-op beyond ensuring tombstone status
    await db.update(contacts).set({ status: 'erased' }).where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
  }
  auditService.log({ orgId, actorId, action: 'contacts.erased', entityType: 'contact', entityId: contactId })
  return true
}
```
(Add the imports: `contacts`, `email_logs`, `event_analytics`, `suppressionStore`, `hashEmail`, `auditService`, `and`, `eq`. Match the real `contacts` column names — e.g. `custom_fields`.)

- [ ] **Step 5: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the import-time suppression check** — in `apps/api/src/services/contactService.ts` `importContacts`, after email validation and before the duplicate check, skip suppressed:

```ts
if (await suppressionStore.isSuppressed(userId, email)) {
  result.invalid++
  result.errors.push({ row: i + 1, email, reason: 'Email is suppressed' })
  continue
}
```
(Confirm the local variable names — `userId`, `email`, `result`, the loop index — match the existing handler; import `suppressionStore`.)

- [ ] **Step 7: Add the erase route** — in `apps/api/src/routes/admin.ts`:

```ts
  .post('/admin/contacts/:id/gdpr-erase', requirePermission(PERMISSIONS.GDPR_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    const user = requireAuth(c)
    const ok = await gdprService.eraseRecipient(orgId, c.req.param('id'), user.id)
    if (!ok) return error(c, 'Contact not found', 404)
    return success(c, undefined, 'Recipient erased')
  })
```

- [ ] **Step 8: Verify api gate + suppression-at-send net**

Add a net asserting an erased email is blocked by `evaluateGates` (import `evaluateGates` from `queue/gates`, erase a contact, then `expect((await evaluateGates('u1', ORG, 'gone@x.y')).allowed).toBe(false)`).
Run: `cd apps/api && bunx vitest run tests/services/gdpr.test.ts` and `bunx tsc --noEmit | grep -cE "error TS"` → `49`.

- [ ] **Step 9: Web erase action** — add `adminApi.gdprErase(contactId)` (typed client `POST`), and a destructive shadcn `AlertDialog` ("Permanently erase this recipient's personal data? This cannot be undone.") on the contact detail view calling it, then navigating back. Verify web own-src=33.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/gdprService.ts apps/api/src/services/queue/suppressionStore.ts \
        apps/api/src/services/contactService.ts apps/api/src/routes/admin.ts apps/api/tests/services/gdpr.test.ts \
        apps/web/src/lib/api/admin.ts apps/web/src/views/<contact-detail-view>.vue
git commit --no-gpg-sign -m "feat(p7a): GDPR erasure — anonymize + analytics cascade + suppression-by-hash (send & import)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Retention purge (scheduled)

**Files:**
- Create: `apps/api/src/services/retentionService.ts`
- Create: `apps/api/tests/services/retention.test.ts`
- Create: `apps/api/src/services/queue/retentionJob.ts`
- Modify: the worker bootstrap (where the scheduler worker/queue is started) + the API bootstrap (where repeatable jobs are registered) — follow the scheduler's existing registration site.

**Interfaces:**
- Consumes: `getDb()`, `event_analytics`, `engagement_events`, `email_logs`, `auditService.cleanup`.
- Produces: `retentionService.purgeExpired(now: Date, windowDays: number): Promise<{ table: string; deleted: number }[]>`; `registerRetentionJob()` (adds the daily repeatable); a worker handler that calls `purgeExpired(new Date(), Number(process.env.RETENTION_DAYS ?? 730))`.

- [ ] **Step 1: Write the failing test** — `apps/api/tests/services/retention.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { event_analytics } from '../../src/db/pg/schema'
import { retentionService } from '../../src/services/retentionService'

describe('retentionService.purgeExpired', () => {
  let db: TestDb
  beforeEach(async () => { db = await freshDbMigrated(); __setTestDb(db) }, 30_000)
  afterEach(() => __setTestDb(null))

  it('deletes rows older than the window and keeps newer ones', async () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString()
    const fresh = new Date('2020-12-25T00:00:00Z').toISOString()
    await db.insert(event_analytics).values([
      { id: 'old', user_id: 'u1', event_type: 'open', created_at: old } as any,
      { id: 'new', user_id: 'u1', event_type: 'open', created_at: fresh } as any,
    ])
    const res = await retentionService.purgeExpired(new Date('2021-01-01T00:00:00Z'), 30)
    const ev = res.find(r => r.table === 'event_analytics')
    expect(ev?.deleted).toBe(1)
    const remaining = await db.select().from(event_analytics)
    expect(remaining.map(r => r.id)).toEqual(['new'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/api && bunx vitest run tests/services/retention.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service** — `apps/api/src/services/retentionService.ts`

```ts
import { lt } from 'drizzle-orm'
import { getDb } from '../db/pg/client'
import { event_analytics, engagement_events, email_logs } from '../db/pg/schema'

class RetentionService {
  async purgeExpired(now: Date, windowDays: number): Promise<{ table: string; deleted: number }[]> {
    const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString()
    const db = getDb()
    const out: { table: string; deleted: number }[] = []
    for (const [table, t] of [
      ['event_analytics', event_analytics],
      ['engagement_events', engagement_events],
      ['email_logs', email_logs],
    ] as const) {
      const deleted = await db.delete(t).where(lt(t.created_at, cutoff)).returning({ id: t.id })
      out.push({ table, deleted: deleted.length })
    }
    return out
  }
}

export const retentionService = new RetentionService()
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/api && bunx vitest run tests/services/retention.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the repeatable job + handler** — `apps/api/src/services/queue/retentionJob.ts`, mirroring the scheduler's queue/connection setup (`createRedisConnection`, `Queue`, `Worker`):

```ts
import { Queue, Worker } from 'bullmq'
import { createRedisConnection } from './redis'
import { retentionService } from '../retentionService'
import { auditService } from '../auditService'
import { logger } from '../../utils/logger'

const RETENTION_QUEUE = 'data-retention'
const windowDays = () => Number(process.env.RETENTION_DAYS ?? 730)

export async function registerRetentionJob(): Promise<void> {
  const q = new Queue(RETENTION_QUEUE, { connection: createRedisConnection() })
  await q.add('purge', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'daily-retention-purge', removeOnComplete: true, removeOnFail: 100 })
}

export function startRetentionWorker(): Worker {
  return new Worker(RETENTION_QUEUE, async () => {
    const res = await retentionService.purgeExpired(new Date(), windowDays())
    await auditService.cleanup(90)
    logger.info(`[retention] purged ${JSON.stringify(res)}`)
  }, { connection: createRedisConnection() })
}
```
(Use the exact connection/queue helpers the scheduler uses — confirm `createRedisConnection` import path.)

- [ ] **Step 6: Wire bootstrap** — call `registerRetentionJob()` where the scheduler's repeatable is registered (API boot, guarded `NODE_ENV !== 'test'`), and `startRetentionWorker()` where the scheduler worker starts (worker process). Follow the existing scheduler wiring exactly.

- [ ] **Step 7: Verify gate**

Run: `cd apps/api && bunx vitest run tests/services/retention.test.ts tests/app-boot.test.ts` and `bunx tsc --noEmit | grep -cE "error TS"` → `49`.

- [ ] **Step 8: Document env + commit**

Add to `.env.example`: `RETENTION_DAYS=730`.
```bash
git add apps/api/src/services/retentionService.ts apps/api/tests/services/retention.test.ts \
        apps/api/src/services/queue/retentionJob.ts .env.example <bootstrap-files>
git commit --no-gpg-sign -m "feat(p7a): scheduled retention purge (event/analytics/log TTL + audit cleanup)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** ① sender identity → Task 1 (schema) + Task 2 (service/route/UI). ② footer + hard-gate → Task 3. ③ DSAR export → Task 4. ④ erasure (anonymize + cascade + suppression hash) → Task 5; send + import enforcement → Task 5 steps 3/6/8. ⑤ retention purge (+ folds `auditService.cleanup`) → Task 6. `GDPR_MANAGE` perm → Task 4. Audit actions → Task 4 step 6. Every spec component maps to a task. ✓

**Placeholder scan:** Two intentional `<contact-detail-view>.vue` / `<bootstrap-files>` markers remain where the exact web contact-detail path and the scheduler bootstrap site must be located in-repo during execution (the Explore map gave a wrong contact-view path; the implementer confirms it). Every code step ships complete code. No "add error handling"/"TBD" steps.

**Type consistency:** `hashEmail(email)` (Task 1) used identically in Tasks 3/5. `orgService.getSenderIdentity/setSenderIdentity` (Task 2) consumed by Task 3's gate/footer via `orgService.get`. `gdprService.exportRecipient` (Task 4) reused in Task 5's assertion. `suppressionStore.isSuppressed/suppressByHash` (Task 5) consumed by send (gates) + import. `retentionService.purgeExpired(now, windowDays)` (Task 6) signature matches its test + job handler. `assertSenderIdentity`/`buildComplianceFooter` signatures match across Task 3. ✓

**Notes for the implementer:** column lists in test `insert`s and the `contacts` anonymize set must be reconciled to the live schema (snake_case, integer bools, JSON-as-text) — the schema is the source of truth. Confirm `PERMISSIONS.ORG_VIEW/ORG_MANAGE` exact names. Keep the gate green after every task.
