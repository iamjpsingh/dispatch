# P7b — Audit-Event Wiring — Design

**Date:** 2026-07-03 · **Branch:** `feat/saas-replatform` · **Phase:** P7 (slice b of the
"Admin panel + audit UI + GDPR/i18n" phase). North-star spec: `2026-06-06-dispatch-saas-replatform.md`
§P7. Governed by CLAUDE.md R1–R9. Follows P7a (`2026-06-21-p7a-gdpr-canspam-compliance-design.md`).

## Context

The audit infrastructure already exists and works:

- **`auditService.log()`** → `audit_logs` (security-sensitive; carries a `changes` before/after diff,
  `ip_address`, `user_agent`). **`logActivity()`** → `activity_logs` (product feed for the dashboard).
  Both are **fire-and-forget and never throw** (bodies wrapped in try/catch; failures swallowed +
  `logger.error`).
- **Read side already wired:** `queryAuditLogs` / `queryActivityLogs` / `getRecentActivity` are consumed
  by `admin.ts` routes and an admin **audit-log dual-view** (built in P6/P7a).
- **Actions are typed unions** (`AuditAction` / `ActivityAction`) — a closed, developer-defined event
  taxonomy.

Audit calls are made today at the **service layer**, and only for a subset of domains:
`authLocalService` (login/logout/register), `orgService` (org.*), `invitationService` (member.*),
`teamService` (team.*), `gdprService` (contacts.erased), plus `contacts.exported` inline in `admin.ts`.
So **auth / org / member / team / gdpr are already covered**.

**The gap:** the domains whose services do **not** self-audit have zero coverage at their routes —
campaigns, contacts (import/delete/merge), apikeys, config/**SMTP + provider secrets**/settings,
templates, automations, segments, forms, pages, webhooks, whatsapp, warmup, routing, plugins, queue,
send. These are exactly the mutating surfaces a security/compliance auditor cares about, and closing
them is the remaining P7 compliance work (P7 exit: "admin usable; compliance basics in place").

**Immutability already holds** structurally: the *only* code path that mutates `audit_logs` /
`activity_logs` is `auditService.cleanup()` (the retention purge, itself audited as
`data.retention_purge`). No route exposes an update/delete on those tables; the schema has no
`updated_at` (append-only by shape).

## Goals

1. **Complete `audit_logs` coverage** — every audit-worthy mutating route records a semantic audit
   entry (actor, org, entity, action), derived server-side.
2. **Regression-proof completeness** — a coverage test that fails CI when a new mutating route ships
   without an audit-or-exempt decision.
3. **API-immutability guard** — a test encoding the "no update/delete on audit tables outside the
   retention job" guarantee.
4. **Dashboard feed enrichment** — populate `activity_logs` for the content-CRUD actions the existing
   `ActivityAction` union already names, so `getRecentActivity` is useful.

## Non-goals (this slice)

- **i18n / vue-i18n** — deferred; listed under "Do NOT build pre-GA" in the north-star spec.
- **Cryptographic hash-chaining** of the audit log — genuine tamper-*evidence* is a P8/GA concern and
  fights the retention-purge job (deleting rows breaks a chain). "Tamper-evident" here means
  **server-derived actor + append-only-via-API + complete, CI-enforced coverage**.
- **New admin views** — the audit dual-view and read endpoints already exist; at most we verify
  rendering and add filter facets.
- **Re-plumbing the already-covered domains** (auth/org/member/team/gdpr self-audit at the service
  layer) — left untouched (R8).
- Middleware auto-capture of every request (evaluated and rejected: generic rows are low-signal and
  duplicate the semantic calls).

## Locked decisions (from brainstorming)

- **A. Ambition = complete + API-immutable, coverage-test-enforced, not cryptographic.**
- **B. Layer = route handlers** (not service methods): the route is where the actor + IP + user-agent
  naturally live, it is what the coverage test enumerates, and it avoids threading actor/ip/ua through
  many service signatures (R8). Existing service-layer self-audits stay as-is.
- **C. `audit_logs` is the mandatory system-of-record** (what the coverage test enforces);
  **`activity_logs` is secondary** dashboard-feed enrichment for content CRUD only.
- **D. Taxonomy stays a typed union**, R2-exempt (program structure, not user content), and is
  **extracted out of the over-cap `auditService.ts`** into a new `audit/types.ts` (R1).
- **E. Coverage is proven statically** (manifest vs live `app.routes`) plus **behavioral** tests on the
  high-value ops — not by exhaustively exercising all ~100 routes.

## Architecture — isolated units

### 1. Audit taxonomy + types (R1 extraction)

`auditService.ts` is already 229 lines (pre-existing, over the 200-LOC R1 cap). Expanding the unions
in place would worsen that. **Extract** `AuditAction`, `ActivityAction`, `AuditEntry`, `ActivityEntry`,
`LogQuery` into **`src/services/audit/types.ts`**; `auditService.ts` imports them and drops back under
200 lines. Then **expand** the unions with the new domain actions (e.g. `campaign.scheduled`,
`campaign.duplicated`, `webhook.created|updated|deleted`, `page.*`, `form.*`, `automation.updated|deleted`,
`segment.deleted`, `plugin.enabled|disabled|configured`, `routing.updated`, `warmup.updated`,
`queue.*`, `whatsapp.config_updated|template_updated`, `provider.connected|disconnected`,
`send.dispatched`, `apikey.rotated`). The exact final set is enumerated in the plan while walking each
handler; every value is compile-time-checked at its call site.

### 2. Route-layer audit primitives

**`src/services/audit/context.ts`** — two typed helpers over the Hono `Context`:

- `auditFromContext(c, { action, entityType, entityId?, changes?, metadata? }): void`
- `activityFromContext(c, { action, entityType, entityId?, description, metadata? }): void`

Each derives, **server-side**: `actorId`/`actorEmail` from `requireAuth(c)`, `orgId` from `getOrgId(c)`,
`ipAddress` from `x-forwarded-for` / `x-real-ip`, `userAgent` from `user-agent`; then calls
`auditService.log` / `logActivity` fire-and-forget (never awaited in handlers; the service never
throws). A handler audit becomes a single line with no signature changes. Unit-tested against a mock
context (correct actor/ip/ua/org mapping).

### 3. Coverage manifest + test (the completeness teeth)

- **Manifest** (`tests/audit/manifest.ts`): a declared mapping of every mutating route
  `"METHOD /path"` → either an `AuditAction` (audited) or `{ exempt: <reason> }`. Values are typed
  against the imported `AuditAction` so a typo fails `tsc`.
- **Coverage test** (`tests/audit/coverage.test.ts`): builds the real app, reads `app.routes`, dedupes
  (the same router is mounted at `/api` and `/api/v1`), filters to POST/PUT/PATCH/DELETE, and asserts a
  **two-way** match: every registered mutating route appears in the manifest, and every manifest entry
  maps to a real route (no stale entries). A new unlisted mutation → **CI red**, forcing an
  audited-or-exempt decision.
- **Exemption criteria** (each allowlisted route carries a reason): ① derived-data recompute
  (analytics/warmup/routing recompute, dashboard refresh); ② preview/test/validate (previews,
  test-sends, counts, verify); ③ machine/public ingestion (tracking events, inbound provider webhooks,
  public form submissions); ④ draft autosave (the eventual publish/launch is audited).

### 4. Immutability guard test

`tests/audit/immutability.test.ts` — scans `src/` and fails if any file issues `.update(audit_logs`,
`.delete(audit_logs`, `.update(activity_logs`, or `.delete(activity_logs` **outside**
`auditService.cleanup`. Encodes the append-only-via-API guarantee so a future edit that adds a
mutating path is caught.

### 5. Domain wiring (route-by-route)

Add `auditFromContext` (and, for content CRUD, `activityFromContext`) calls to the audit-worthy
handlers across: campaigns, contacts, apikeys, config/secrets/settings, templates, automations,
segments, forms, pages, webhooks, whatsapp, warmup, routing, plugins, queue, send, oauth. Each slice
turns its portion of the coverage test from RED to GREEN. `entityId` = the affected resource id;
`changes` = before/after only where cheap and meaningful (e.g. settings/role/secret updates).

### 6. Admin surface (verify only)

The audit dual-view + read endpoints already exist. P7b verifies the new action types render in the
existing view and, optionally and cheaply, adds action / entity-type filter facets. No new view.

## Data flow (happy paths)

- **Mutation:** handler runs → on success calls `auditFromContext(c, { action, entityType, entityId })`
  → `audit_logs` row (actor/org/ip/ua/time). Content CRUD *also* calls `activityFromContext` →
  `activity_logs` (dashboard feed). Both fire-and-forget; a logging failure never affects the response.
- **Read:** admin opens Audit view → `queryAuditLogs` / `queryActivityLogs` (org-scoped) → dual-view.
- **Regression:** a new mutating route with no manifest entry → coverage test fails in CI.

## Security & privacy (R9)

- Actor and org are **server-derived** (`requireAuth` / `getOrgId`) — never client-supplied.
- Audit writes are org-scoped; reads are org-scoped in `admin.ts` (platform-admin cross-org view stays
  as the existing platform surface).
- Audit logging is fire-and-forget and MUST NOT alter request semantics or leak: no secret *values* in
  `changes`/`metadata` (record that a secret changed, never its plaintext — R9).
- Immutability is structural (no mutating API) and guarded by a test.
- All boundary inputs already validated with zod at the routes (unchanged).

## Testing (R5; net-first PGlite per project pattern)

- **Unit:** `auditFromContext` / `activityFromContext` map a mock context to the correct entry.
- **Coverage:** manifest vs `app.routes` (static completeness) — the regression guard.
- **Immutability:** the guard scan.
- **Behavioral (PGlite, sampled):** apikey create/revoke, SMTP/secret CUD, `settings.updated`,
  campaign launch/cancel/delete, contacts import/delete → assert the `audit_logs` row (action / entity
  / actor). Representative high-value set, not all routes.
- **Full backend suite** run before "done" (explicit P7a lesson: focused-per-task tests missed 8
  cross-file regressions; the full suite catches them).

**Gate (must hold):** api `tsc` **49** baseline (+0 net-new — everything typed), web own-src **≤ 33**,
backend suite green incl. new tests, `bun lint` clean, R1–R9 satisfied (no source file over 200 LOC as
a result of this work).

## Build order (→ becomes the implementation plan)

1. **Foundation:** extract `audit/types.ts` (shrinks `auditService.ts` < 200) + expand taxonomy +
   `audit/context.ts` helper + helper unit net.
2. **Teeth first (RED):** manifest + coverage test + immutability guard — initially lists every
   mutating route as un-audited (test RED), establishing the work-list.
3. **Wire domains** handler-by-handler, GREENing the coverage test slice by slice, in order:
   campaigns → contacts → secrets/config/apikeys → templates/automations/segments →
   forms/pages/webhooks → whatsapp/warmup/routing/plugins/queue/send/oauth.
4. **Finish:** `activity_logs` dashboard enrichment for content CRUD, admin-view verify (+ optional
   filter facets), full-suite + gate.

Each step keeps the gate green (except step 2's intentionally-RED coverage test, which the domain
slices turn GREEN) and is independently committable.

## Out of scope / follow-ups

- i18n (deferred); cryptographic hash-chaining and append-only DB constraints (P8/GA); async/bulk audit
  export.
- Carried release-blocker for P8: `GET`/`DELETE /api/scheduled-jobs` cross-tenant IDOR
  (getActive/cancel unscoped).
- Opportunistic: if a domain's service is the cleaner home for an audit call (shared by worker +
  routes), note it — but do not refactor the existing service-layer self-audits in this slice (R8).
