# P7a — GDPR / CAN-SPAM Compliance — Design

**Date:** 2026-06-21 · **Branch:** `feat/saas-replatform` · **Phase:** P7 (slice a of the
"Admin panel + audit UI + GDPR/i18n" phase). North-star spec: `2026-06-06-dispatch-saas-replatform.md`
§P7. Governed by CLAUDE.md R1–R9.

## Context

A pre-implementation survey of the four P7 areas found:

- **Admin panel** — already substantially built and wired to real APIs (P6 typed the admin surface):
  org/members/teams/roles/invitations + platform user/org management + settings + an audit-log
  dual-view. Gap relevant here: no org "sender identity / physical address".
- **Audit** — `auditService` + `audit_logs`/`activity_logs` + read endpoints + admin UI exist, but
  only ~18% of mutating routes call it. **(Out of scope for this slice — see Non-goals.)**
- **GDPR / CAN-SPAM** — mostly absent, and these are the GA release-blockers:
  - no recipient data export (DSAR / right of access);
  - no erasure (right to be forgotten); `contactService.deleteContacts` does **not** cascade, orphaning
    PII in `engagement_events` / `event_analytics` / `email_logs` / `campaign_analytics`;
  - no retention/purge for event & analytics tables (unbounded growth);
  - no org physical-address field and **no CAN-SPAM footer injection** in the send path.
  - (Already done: `List-Unsubscribe` + One-Click headers are injected in the worker `processor`.)
- **i18n** — absent; the north-star spec marks it "deferred, optional pre-GA" and lists it under
  "Do NOT build pre-GA". **(Out of scope.)**

This document specifies **only the GDPR/CAN-SPAM compliance slice (P7a)**. Audit-trail wiring is a
separate P7 slice (P7b); i18n is deferred.

## Goals

1. **Sender identity** — an org-level physical postal address + sender/company name (schema + admin UI).
2. **CAN-SPAM footer** — inject the physical address + a visible unsubscribe link into every outbound
   marketing email at the send choke point; **hard-gate** campaign sends when no address is configured.
3. **GDPR data export (DSAR)** — admin-initiated, per-recipient export of all data held about a contact,
   as a downloadable JSON.
4. **GDPR erasure** — admin-initiated "right to be forgotten": **anonymize** the contact + de-identify
   its analytics/log rows, and record a one-way **suppression hash** so the recipient stays suppressed
   without retaining their address.
5. **Retention purge** — a scheduled job that purges aged event/analytics/log rows.

## Non-goals (this slice)

- Audit-trail wiring across the remaining mutating routes (separate slice **P7b**).
- i18n / vue-i18n (deferred per north-star spec).
- Per-org retention configuration (a single global default ships first; per-org override is a later
  follow-up).
- Async/queued export & erasure (synchronous per-contact handlers ship first; bulk DSAR jobs later).
- Structured international address components / validation (a single multi-line postal-address text
  field is sufficient for the CAN-SPAM "valid physical postal address" requirement).

## Locked decisions (from brainstorming)

- **Erasure = anonymize + suppression hash** (not hard-delete): satisfies erasure (no recoverable PII)
  while keeping de-identified aggregate analytics intact.
- **Footer = hard-gate the send** when the org has no postal address (structural, server-side, R9).
- **A.** Sender address stored as **dedicated typed columns** on `organizations` (not the untyped
  `settings` JSON).
- **B.** Erasure suppression stored by **extending the existing org-scoped `suppression_list`** with an
  `email_hash` column (not a new table) — it is already consulted at send time.
- **C.** Retention window is a **global default** (`RETENTION_DAYS`, default **730**), not per-org.
- **D.** A new **`GDPR_MANAGE`** RBAC permission gates export/erasure (not a reuse of `CONTACTS_MANAGE`).

## Architecture — six isolated units

Each unit has one responsibility, a defined interface, and explicit dependencies, so it can be built and
tested independently.

### 1. Data model & migration (R4 — generated, never hand-edited)

Change the Drizzle schema, then `cd apps/api && bunx drizzle-kit generate`.

- **`organizations`** (identity schema) gains:
  - `sender_company_name text` (nullable)
  - `postal_address text` (nullable — multi-line "valid physical postal address")
  - `postal_address_set_at timestamp` (nullable — set when first configured; cheap "is compliant" check)
- **`suppression_list`** (already org-scoped, consulted at send time) gains:
  - `email_hash text` (nullable, indexed) — present for erasure-origin rows whose plaintext email was
    removed
  - `reason text` (nullable, if not already present) — e.g. `'gdpr_erasure'`, `'bounce'`, `'complaint'`
- **Retention** needs no schema; rows are purged by their existing `created_at`.

**Suppression hash:** `hashEmail(email) = HMAC-SHA256(normalize(email), SUPPRESSION_HASH_SECRET)` where
`normalize` lowercases + trims, and `SUPPRESSION_HASH_SECRET` is a server-only env (documented in
`.env.example`; never returned to the browser — R9). One-way: storing the hash (not the address)
honors "do not contact" without retaining PII.

### 2. CAN-SPAM footer + hard-gate (send path)

- **`buildComplianceFooter(org, unsubscribeUrl): string`** — a pure function returning an HTML footer
  block containing `org.sender_company_name` (falling back to org name), `org.postal_address`, and a
  visible unsubscribe link. Independently testable; no I/O.
- **Injection point:** the worker `processor` (apps/api worker), at the same choke point that already
  injects the `List-Unsubscribe` headers — append the footer to the HTML body before transport. This is
  the single send path, so no campaign/template can bypass it.
- **Hard-gate `assertSenderIdentity(org)`** — throws/blocks when `postal_address` is empty. Enforced at
  **two** server-side points (R9, defence in depth): `POST /campaigns/:id/launch` (fail fast with a
  clear 400: "Set your organization's physical mailing address before sending") and again in the worker
  immediately before send (so scheduled/queued sends created before this check also gate). Applies to
  marketing/campaign sends; one-off transactional/test sends are out of the gate's scope (documented).
- **Unsubscribe link** reuses the existing unsubscribe URL builder behind the current `List-Unsubscribe`
  header (single source of truth for the per-recipient unsubscribe token).

### 3. GDPR data export (DSAR)

- **`gdprService.exportRecipient(orgId, contactId): RecipientExport`** — assembles, org-scoped:
  the contact row, its preference state, its `engagement_events`, its `event_analytics`, and the list of
  campaigns it received (from `email_logs`). Returns a plain serializable object.
- **`GET /admin/contacts/:id/gdpr-export`** — org-scoped (server-derived `orgId`), gated by
  `GDPR_MANAGE`, returns the JSON as a file download (`Content-Disposition`). Writes an audit entry
  (`contacts.exported`).
- **Admin UI:** an "Export data (GDPR)" action on the contact.

### 4. GDPR erasure (anonymize + suppression hash)

- **`gdprService.eraseRecipient(orgId, contactId): void`** — idempotent, org-scoped, in a transaction:
  1. compute `emailHash = hashEmail(contact.email)`;
  2. **anonymize the contact:** clear `email`, `first_name`, `last_name`, `company`, `phone`,
     `custom_fields`; set `status = 'erased'` (tombstone retained for referential integrity / audit);
  3. **de-identify the cascade:** null the recipient PII (`recipient_email`, any name) on this contact's
     rows in `engagement_events`, `event_analytics`, and `email_logs` (counts/aggregates preserved);
  4. **upsert suppression** `(org_id, email_hash, reason='gdpr_erasure')` so future sends and imports are
     blocked.
- **`POST /admin/contacts/:id/gdpr-erase`** — org-scoped, gated by `GDPR_MANAGE`, audited
  (`contacts.erased`). Irreversible.
- **Admin UI:** a destructive shadcn `AlertDialog` confirm.
- **Suppression enforcement extension:** the send-time and import-time suppression checks are extended to
  also match `email_hash` (hash the candidate email, look it up), so an erased recipient is never
  re-emailed or silently re-imported.

### 5. Retention purge (scheduled)

- **`retentionService.purgeExpired(now, windowDays): { table: string; deleted: number }[]`** — deletes
  rows older than `now - windowDays` from `event_analytics`, `engagement_events`, and `email_logs`;
  returns per-table counts. Pure-ish (DB writes only), independently testable on boundaries.
- **Scheduling:** a **daily BullMQ repeatable job** registered with the existing queue infrastructure
  (the same mechanism the scheduler uses). Window from `RETENTION_DAYS` (default **730**).
- Folds in the already-existing `auditService.cleanup(90)` (audit/activity logs >90d) — today defined but
  never scheduled — so all retention runs from one job.

### 6. Admin UI (shadcn-vue, R3)

- **`OrgSettings.vue`** gains a "Sender identity / Compliance" card: a form (shadcn primitives) for
  company name + postal address, with a clear "required before you can send campaigns" notice and the
  configured/last-updated state. Saves via the org update route.
- **Contact view** gains the GDPR **export** and **erase** actions (§3, §4).
- shadcn primitives only (install via CLI if missing); no hand-rolled inputs (R3).

## Data flow (happy paths)

- **Send:** launch → `assertSenderIdentity(org)` (400 if missing) → enqueue → worker resolves content →
  injects `List-Unsubscribe` + `buildComplianceFooter` → transport.
- **Export:** admin clicks Export → `GET …/gdpr-export` (GDPR_MANAGE) → `exportRecipient` → JSON download
  → audit `contacts.exported`.
- **Erase:** admin confirms → `POST …/gdpr-erase` (GDPR_MANAGE) → `eraseRecipient` (anonymize + cascade +
  suppression hash) → audit `contacts.erased`. Subsequent send/import for that email → suppressed by hash.
- **Retention:** daily job → `purgeExpired(now, RETENTION_DAYS)` + `auditService.cleanup(90)` → logged counts.

## Security & privacy (R9)

- Every read/write is scoped by a **server-derived** `orgId` (session/persisted row); never trust a
  client-supplied org/contact owner.
- `SUPPRESSION_HASH_SECRET` is server-only, never returned to the browser; the suppression value is a
  one-way hash (no recoverable address).
- Export & erase are gated by the new `GDPR_MANAGE` permission and **audited** (actor, target, time).
- Erasure is irreversible and transactional; partial failure rolls back (no half-anonymized state).
- Footer enforcement is structural (server-side gate), not a UI-only check.
- All boundary inputs validated with zod (R9).

## Testing (R5; net-first PGlite per the project pattern)

- **Service nets (PGlite):** `exportRecipient` shape/scoping; `eraseRecipient` clears PII + de-identifies
  cascade + writes suppression hash + is idempotent + org-scoped (no cross-org erase); `purgeExpired`
  deletes only rows past the window (boundary rows kept).
- **Suppression:** an erased email (matched by hash) is blocked at send and at import.
- **Send path:** footer present in the rendered body; `assertSenderIdentity` blocks launch when no
  address; passes when set.
- **Permissions:** export/erase return 403 without `GDPR_MANAGE`; org-scoping prevents cross-tenant access.
- **Gate (must hold):** api `tsc` 49 baseline (+0 net new), web own-src ≤ 33, backend suite green incl.
  new nets, `bun lint` clean, R-rules satisfied.

## Suggested build order (→ becomes the implementation plan)

1. Schema + migration (sender-identity columns, suppression `email_hash`/`reason`) + `hashEmail` util + env.
2. Sender-identity service/route + `OrgSettings` card (admin can set the address).
3. Footer builder + worker injection + `assertSenderIdentity` hard-gate (launch + worker).
4. GDPR export (service + route + UI + audit + `GDPR_MANAGE` perm).
5. GDPR erasure (service + route + UI + suppression-hash send/import enforcement + audit).
6. Retention purge service + daily BullMQ repeatable job (+ fold in `auditService.cleanup`).

Each step keeps the gate green and is independently committable.

## Out of scope / follow-ups

- **P7b — audit-trail wiring:** call `auditService.log/logActivity` from the ~80% of mutating routes that
  don't yet (campaigns send/cancel/delete, contacts import/delete, apikeys, config/secrets, templates,
  automations, segments, pages, forms). Service + UI + read endpoints already exist.
- i18n (deferred); per-org retention config; async/bulk DSAR jobs; structured intl address.
- Pre-existing bug to reconcile opportunistically: `contactService.deleteContacts` orphaning analytics
  (the erasure cascade here establishes the pattern to reuse).
