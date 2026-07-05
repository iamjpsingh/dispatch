# P8 — Security & Compliance Audit Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the known pre-GA vulnerabilities (SSRF, two IDORs, webhook fail-open, a crashing handler) with regression tests, run an adversarial discovery sweep for unknowns, and wire security scans into CI — fixing Critical/High now and documenting Medium/Low.

**Architecture:** Fix-known-first (Tasks 1–3), then bounded adversarial discovery sweep + fix (Tasks 4–5), then CI gates (Task 6), then final whole-branch security review + gate (Task 7). Fixes are route-layer/service-layer; existing R9 structural scoping is audited, not re-plumbed.

**Tech Stack:** Hono, Drizzle (Postgres), Bun test/vitest, Node `crypto`, existing `webhookSignature`/`eventBus`/`schedulerStore` modules.

## Global Constraints

- **R1:** TypeScript only; no source file > 200 LOC. (webhooks.ts, send.ts, contacts.ts, admin.ts are pre-existing over-cap — do NOT split; add minimal changes only.)
- **R8 surgical:** touch only what each task requires; flag pre-existing issues, don't fix unprompted.
- **R9:** derive identity server-side; never trust client-supplied org/tenant; secrets never to the browser; validate at boundaries (zod).
- **Gate baseline (start of P8):** api `tsc` = **47** (send-crash fix already dropped it 48→47). Every task must NOT add net-new tsc errors; several tasks REDUCE the count (eventBus −3, untyped-actions −4 → target ≤ ~40). Full backend suite green (786/0/28 at start). `bun lint` adds no new problems. `bun lint` has 3 pre-existing errors (analytics/dashboard/events) that are NOT in scope.
- **Fix bar:** Critical/High fixed with a regression test each; Medium/Low logged to `docs/superpowers/p8-security-followups.md`.
- **TDD:** each fix = failing test (RED, proves the hole) → fix → GREEN. Commit per task with `--no-gpg-sign` and the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Subagents must NEVER run destructive git (stash/reset/checkout/clean) on the shared tree.

## File Structure

- `apps/api/src/routes/webhooks.ts` — MODIFY (T1: SSRF guard, fail-closed verification, remove dead eventBus emits)
- `apps/api/src/middleware/webhookSignature.ts` — MODIFY (T1: export an SNS-URL allowlist helper; T3: explicit length-guard)
- `apps/api/src/services/queue/schedulerStore.ts` — MODIFY (T2: org-scope `getActive`/`cancel`)
- `apps/api/src/services/schedulerService.ts` — MODIFY (T2: thread `orgId`)
- `apps/api/src/routes/send.ts` — MODIFY (T2: pass `getOrgId(c)` to scheduler calls)
- `apps/api/src/routes/contacts.ts` — MODIFY (T2: remove the 2 dead public-preference routes)
- `apps/api/tests/audit/manifest/contacts.ts` + `apps/api/src/config/index.ts` — MODIFY (T2: drop the removed route from manifest + public-path allowlist)
- `apps/api/src/routes/admin.ts` — MODIFY (T2: `await` the create/delete team handlers)
- `apps/api/src/services/audit/types.ts` — MODIFY (T3: +4 AuditAction members)
- `apps/api/tests/security/*.test.ts` — CREATE (per-task regression tests)
- `docs/superpowers/p8-security-followups.md` — CREATE (T5/T7: Medium/Low backlog)
- `.github/workflows/*.yml` — MODIFY (T6: dep-scan + hardcoded-value scan jobs, advisory)

---

## Task 1: webhooks.ts hardening (SSRF + fail-closed + eventBus crash)

**Files:** Modify `apps/api/src/routes/webhooks.ts`, `apps/api/src/middleware/webhookSignature.ts`; Test `apps/api/tests/security/webhooks-hardening.test.ts`.

Three fixes in one file (one cohesive security pass):

### 1a — SSRF in SNS SubscriptionConfirmation (Critical)
Current (`webhooks.ts:151-158`): the `SubscriptionConfirmation` branch calls `await fetch(payload.SubscribeURL)` with zero validation and `return`s before the signature check at line 162.

Fix: before any fetch, (1) verify the SNS message signature via `verifySNSSignature(payload)` (SNS confirmation messages are signed), AND (2) validate `SubscribeURL` is `https:` on host `sns.<region>.amazonaws.com`. Add + export `isAllowedSnsUrl(url: string): boolean` in `webhookSignature.ts` (reuse the host/protocol logic already inside `verifySNSSignature` at lines 76–84). Reject with 401 and NO fetch otherwise.

```ts
// webhookSignature.ts — export a reusable allowlist check
export function isAllowedSnsUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)
  } catch { return false }
}
```
```ts
// webhooks.ts — SubscriptionConfirmation branch
if (payload.Type === 'SubscriptionConfirmation') {
  const valid = await verifySNSSignature(payload)
  if (!valid || !payload.SubscribeURL || !isAllowedSnsUrl(payload.SubscribeURL)) {
    logger.warn('[Webhook] SNS: rejected subscription confirmation (bad signature or URL)')
    return c.json({ ok: false, error: 'Invalid subscription confirmation' }, 401)
  }
  await fetch(payload.SubscribeURL)
  return c.json({ ok: true, message: 'Subscription confirmed' })
}
```

### 1b — Fail-closed verification (High)
Current: every provider verifies only inside `if (key)` and `if (sigFieldsPresent)` guards → a missing key OR omitted signature fields silently skips verification and processes the payload.

Fix rule: for every provider endpoint that HAS a verification-key helper (SES/SNS, Mailgun, SendGrid, SparkPost), require the key configured AND the signature present AND valid — else 401 before processing. Postmark (no signature mechanism by design) stays as-is with an explicit `// SECURITY: relies on URL secrecy` comment (documented Medium in followups). Restructure each provider block from "verify if possible" to "reject unless verified", e.g. Mailgun:
```ts
const signingKey = await getMailgunSigningKey()
if (!signingKey) return c.json({ ok: false, error: 'Webhook verification not configured' }, 401)
const eventData = payload['event-data'] || payload
const sig = eventData.signature || payload.signature
if (!sig?.timestamp || !sig?.token || !sig?.signature ||
    !verifyMailgunSignature(sig.timestamp, sig.token, sig.signature, signingKey)) {
  logger.warn('[Webhook] Mailgun: invalid signature'); return c.json({ ok: false, error: 'Invalid signature' }, 401)
}
```
Apply the analogous inversion to SES (require `SigningCertURL` + valid), SendGrid, SparkPost.

### 1c — Remove dead eventBus emits (High — clears 3 tsc errors)
Current (`webhooks.ts:318/345/371`): `eventBus.emit('email_reply_received', {…})` — `eventBus` is not imported (TS2304 ×3, ReferenceError at runtime), the call signature is wrong (`emit(type, userId, data?)` — see `eventBus.ts:49`), `'email_reply_received'` is NOT in the `EventType` union, and NOTHING listens for it. It is a half-built dead feature.

Fix: DELETE the three `eventBus.emit('email_reply_received', {…})` blocks (keep the surrounding `logger.info` reply logging). Do NOT add the import or build the feature. Log a followup note that inbound-reply event routing is unbuilt (P9 candidate).

- [ ] **Step 1: RED tests** — `tests/security/webhooks-hardening.test.ts`, driving `webhookRoutes` via `app.fetch` (mock `webhookSignature` helpers + `bounceProcessor`):
  - SSRF: `POST /webhooks/bounce/ses` with `{ Type:'SubscriptionConfirmation', SubscribeURL:'http://169.254.169.254/latest/meta-data/' }` → assert 401 AND `global.fetch` (spied) NOT called.
  - fail-closed: `POST /webhooks/bounce/mailgun` with no signing key configured (`getMailgunSigningKey`→null) and a bounce payload → assert 401 (currently processes → 200).
  - eventBus: `POST /webhooks/inbound/sendgrid` with a valid parse body → assert 200 and no throw (currently ReferenceError → 400).
  Run: `bunx vitest run tests/security/webhooks-hardening.test.ts` → expect FAILs (SSRF fetches + 200, mailgun 200, inbound 400).
- [ ] **Step 2:** Implement 1a + 1b + 1c.
- [ ] **Step 3:** GREEN — rerun → all pass. `bun typecheck` → api = **44** (was 47; −3 eventBus). `bun lint` → 0 new in webhooks.ts.
- [ ] **Step 4:** Commit `fix(p8): webhooks SSRF guard + fail-closed verification + remove dead eventBus emits`.

---

## Task 2: Tenant-isolation IDORs (scheduled-jobs + dead preference endpoints) + team await

**Files:** Modify `schedulerStore.ts`, `schedulerService.ts`, `routes/send.ts`, `routes/contacts.ts`, `tests/audit/manifest/contacts.ts`, `config/index.ts`, `routes/admin.ts`; Test `apps/api/tests/security/scheduled-jobs-isolation.test.ts`.

### 2a — scheduled-jobs IDOR (High)
`schedulerStore.getActive()` has no org filter and doesn't project `org_id`; `cancel(id)` has no org check. The `scheduled_jobs` table HAS `org_id` (`schema/queue.ts:100`, nullable for legacy rows).

Fix:
```ts
// schedulerStore.ts
async getActive(orgId: string) {
  return getDb().select({ /* …existing cols… */ })
    .from(scheduled_jobs)
    .where(and(eq(scheduled_jobs.org_id, orgId), inArray(scheduled_jobs.status, ['scheduled','running'])))
    .orderBy(asc(scheduled_jobs.scheduled_time))
},
async cancel(id: string, orgId: string): Promise<boolean> {
  const changed = await getDb().update(scheduled_jobs).set({ status: 'cancelled' })
    .where(and(eq(scheduled_jobs.id, id), eq(scheduled_jobs.org_id, orgId), inArray(scheduled_jobs.status, ['scheduled','running'])))
    .returning({ id: scheduled_jobs.id })
  return changed.length > 0
},
```
```ts
// schedulerService.ts
async getScheduledJobs(orgId: string) { return schedulerStore.getActive(orgId) }
async cancelScheduledJob(jobId: string, orgId: string): Promise<boolean> {
  const cancelled = await schedulerStore.cancel(jobId, orgId)
  if (cancelled) await removeScheduledRun(jobId)
  return cancelled
}
```
```ts
// send.ts routes — thread orgId
.get('/scheduled-jobs', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const jobs = await schedulerService.getScheduledJobs(getOrgId(c)); return success(c, jobs)
})
.delete('/scheduled-jobs/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const cancelled = await schedulerService.cancelScheduledJob(c.req.param('id'), getOrgId(c))
  if (cancelled) { auditFromContext(c, { action:'job.cancelled', entityType:'job', entityId:c.req.param('id') }); return success(c, undefined, 'Scheduled job cancelled') }
  return error(c, 'Job not found or cannot be cancelled', 404)
})
```
Note: legacy `org_id IS NULL` rows become invisible/uncancellable via the API — acceptable (pre-existing rows; documented). Also update any OTHER caller of `getScheduledJobs()`/`cancelScheduledJob()` surfaced by tsc (thread orgId).

### 2b — Remove dead public-preference endpoints (High — kills the IDOR surface)
`GET`/`POST /contacts/preferences/public/:email` take `orgId` from `c.req.query('org')`/`body.org` (client-supplied), no auth, no token → cross-tenant read/write of preference state. Recon found NO caller in web/worker/packages (the tracking worker serves its own `/preferences/:trackingId` D1-direct flow). 

Fix: DELETE both routes from `contacts.ts` (lines ~168-195). Remove `'POST /contacts/preferences/public/:email'` from `tests/audit/manifest/contacts.ts` (else the coverage test's stale-entry check fails). Remove `'/api/contacts/preferences/public/'` from the public-path allowlist in `config/index.ts:71`. **Before deleting**, re-confirm no caller: `grep -rn "preferences/public" apps/ packages/` (excluding the route defs + this plan). If a caller IS found, STOP and escalate — the fallback is an HMAC link-token (mirror `utils/suppressionHash.ts`), not removal.

### 2c — team create/delete missing-await (P7b-flagged; correctness/security-adjacent)
`admin.ts:653` `const team = teamService.create(...)` and `:682` `const deleted = teamService.delete(...)` are un-awaited async → the `if (!deleted)` guard tests a truthy Promise (dead) → not-found/no-op returns success. Fix: add `await` at both sites (the delete handler `.delete('/admin/teams/:teamId', …, (c) =>` also needs `async`). Mirrors the P7b T9 fix on the other 3 team handlers.

- [ ] **Step 1: RED** — `tests/security/scheduled-jobs-isolation.test.ts` (PGlite, real schedulerStore): seed a scheduled_job with `org_id='orgB'`; call `getScheduledJobs('orgA')` → assert it's ABSENT; call `cancelScheduledJob(jobBId, 'orgA')` → assert returns false AND the job is still 'scheduled'. Run → FAIL (leaks/cancels cross-org).
- [ ] **Step 2:** Implement 2a; verify RED→GREEN. Implement 2b (removal) + 2c (await).
- [ ] **Step 3:** `bunx vitest run tests/security/scheduled-jobs-isolation.test.ts tests/audit/coverage.test.ts tests/audit/wiring/admin-auth.test.ts` → PASS (coverage stays green after the manifest entry removal). `bun typecheck` → api ≤ 44, no net-new. `bun lint` → 0 new.
- [ ] **Step 4:** Commit `fix(p8): org-scope scheduled-jobs (IDOR) + remove dead public-preference endpoints + await team create/delete`.

---

## Task 3: AuditAction taxonomy reconciliation + verified-safe documentation

**Files:** Modify `apps/api/src/services/audit/types.ts`, `apps/api/src/middleware/webhookSignature.ts`, `apps/api/tests/audit/manifest/admin-auth.ts`.

### 3a — Type the 4 untyped service audit actions (clears 4 tsc errors)
`authLocalService.ts:254/278` log `user.password_reset`/`user.password_change`; `invitationService.ts:86/160` log `invitation.created`/`invitation.accepted` — none are in the `AuditAction` union (the 4 pre-existing TS2322 errors). These service calls run at runtime but are untyped.

Fix: add the 4 members to `AuditAction` in `types.ts` (grouped by domain):
```ts
// in the Auth / session / user group:
| 'user.password_reset' | 'user.password_change'
// in the Members / teams / permissions / invitations group:
| 'invitation.created' | 'invitation.accepted'
```
Then update the two `// service` manifest comments in `admin-auth.ts` to name the real action (`POST /auth/change-password` service logs `user.password_change`; `POST /admin/invitations` logs `invitation.created`; accept logs `invitation.accepted`) — comment-only, no key/value change (coverage stays green).

### 3b — Explicit length-guard on timingSafeEqual (Medium hardening)
`webhookSignature.ts:16,56` call `timingSafeEqual(Buffer.from(computed), Buffer.from(signature))` — safe (fails closed via the enclosing try/catch when lengths differ) but relies on exception control flow. Add an explicit pre-check for clarity:
```ts
const a = Buffer.from(computed), b = Buffer.from(signature)
return a.length === b.length && timingSafeEqual(a, b)
```
Apply to both `verifyMailgunSignature` and `verifySparkPostSignature`.

### 3c — Document verified-safe items
Open redirect (`oauth.ts:81/93`) and the secret-compare sweep were both traced clean during recon (redirect origin is always server-built from `SERVER.FRONTEND_URL` + fixed path literals with no `returnTo`; all secret checks use timingSafeEqual/argon2/`Bun.password`/DB `eq()`). Record both as "verified safe — no fix" in `docs/superpowers/p8-security-followups.md` (created in T5, or stub it here).

- [ ] **Step 1:** Apply 3a (union +4) + 3b (length-guards). `bun typecheck` → api = **40** (was 44; −4). Confirm the 4 named files no longer error.
- [ ] **Step 2:** Focused test: `bunx vitest run tests/services/webhookSignature.test.ts` if it exists, else add a tiny test that a length-mismatched signature returns false (no throw). `bunx vitest run tests/audit/coverage.test.ts` → 2/2.
- [ ] **Step 3:** Commit `fix(p8): type 4 untyped service audit actions + explicit timingSafeEqual length-guard`.

---

## Task 4: Discovery sweep + triage

**Files:** none (produces a findings artifact); Output: `docs/superpowers/p8-sweep-findings.md`.

Run a BOUNDED adversarial security review across the branch (`8f4e752..HEAD` scope is P7/P8; but sweep the whole `apps/api/src` for the security axes). One agent per attack surface, each returning findings with file:line + a described exploit:

1. **Tenant isolation / IDOR** — every `getDb()` read/write scoped to `orgId`? (highest value — #2a/#2b confirm the class exists). Look for service methods that take an id but no orgId and don't filter by org.
2. **Auth/RBAC** — routes missing `requirePermission`; async auth/permission calls missing `await` (truthiness bypass — the class hit in P2 rbac + P7b team handlers).
3. **Injection / validation** — raw SQL / string-interpolated queries; unvalidated boundaries; the dormant SQLite-flavored `segmentService.buildQuery`.
4. **Secret handling** — secrets returned to the browser (route responses including `*_secret`/`password`/`token` columns); secrets logged; config endpoints leaking decrypted values.
5. **SSRF / redirect / path** — other `fetch()`/`c.redirect()`/file reads on user-controlled input.

- [ ] **Step 1:** Dispatch the 5 sweep agents (bounded fan-out). Each returns a findings list (file:line, axis, exploit sketch, proposed severity).
- [ ] **Step 2: Adversarial verification** — for EACH finding, a separate verifier attempts a concrete repro (or reads the code path to confirm reachability). A finding only survives if the verifier confirms it's real + reachable. Dedup against T1–T3. **Per the P7a lesson:** if the sweep or verification stalls, the controller verifies the surviving findings DIRECTLY rather than retrying a third time.
- [ ] **Step 3:** Write `docs/superpowers/p8-sweep-findings.md` — the confirmed findings, severity-ranked, deduped. Commit `docs(p8): discovery-sweep confirmed findings`.

---

## Task 5: Fix sweep Critical/High + document Medium/Low

**Files:** per-finding (unknown until T4); Test: `apps/api/tests/security/<finding>.test.ts` per fix.

- [ ] **Step 1:** For each **Critical/High** confirmed finding from T4: write a RED regression test that demonstrates the hole (cross-tenant repro → currently succeeds), fix it (org-scope / add guard / validate), GREEN. One commit per finding (or per tight cluster): `fix(p8): <finding>`.
- [ ] **Step 2:** Write every **Medium/Low** confirmed finding to `docs/superpowers/p8-security-followups.md` (severity, file:line, repro note, why deferred) — plus the T1 Postmark-URL-secrecy note, the T3c verified-safe items, and the inbound-reply-event unbuilt note. Do NOT fix these.
- [ ] **Step 3:** `bun typecheck` + full backend suite (`bunx vitest run`) → green. Commit `docs(p8): medium/low security follow-ups for GA`.

---

## Task 6: CI security gates (advisory)

**Files:** Modify/Create `.github/workflows/*.yml`.

Per the P1 honest-incremental CI philosophy (required jobs green, debt jobs advisory), add NON-BLOCKING jobs:

- [ ] **Step 1: Dependency CVE scan** — add a job running `bun audit` (if the installed Bun supports it; else `npx osv-scanner --lockfile bun.lock` or `npm audit --package-lock-only`). `continue-on-error: true` (advisory). Confirm it runs on the existing workflow.
- [ ] **Step 2: Hardcoded-value scan** — add a job/script that greps `apps/api/src` for (a) potential inline secrets (long base64/hex literals, `api_key =`/`secret =` string literals — complementing gitleaks), and (b) R2 violations (user-facing category/label/option arrays hardcoded as `const X = [...]` that should be DB-driven). Output a report; `continue-on-error: true`. Keep the script < 200 LOC under `scripts/`.
- [ ] **Step 3:** Confirm CodeQL + gitleaks (from P1) still run. `bun typecheck`/suite unaffected (CI-only change).
- [ ] **Step 4:** Commit `ci(p8): advisory dependency-CVE + hardcoded-value security scans`.

---

## Task 7: Final whole-branch security review + gate + docs

**Files:** `docs/superpowers/p8-security-followups.md` (finalize); memory/ledger.

- [ ] **Step 1:** Run a final UNMOCKED, source-level whole-branch security review (opus) over the P8 diff + the security-sensitive surface (the pass-shape that caught the P7b double-log): confirm no Critical/High remains open, no new tenant-isolation gap introduced by the fixes, and the followups doc is complete. Adversarially verify any new finding before acting.
- [ ] **Step 2: Full gate** — `bun typecheck` (api ≤ ~40, no net-new; web own-src ≤ 33); full backend suite green; `bun lint` no new problems; no new src file > 200 LOC; every Critical/High has a regression test.
- [ ] **Step 3:** Finalize `docs/superpowers/p8-security-followups.md`; update the session-status + create `dispatch-p8-status.md` memory; mark P8 complete.
- [ ] **Step 4:** Commit `docs(p8): P8 security audit gate complete`.

---

## Self-Review (plan vs. spec)

**Spec coverage:** §1 inventory → T1 (SSRF #1, fail-open #3, eventBus #4), T2 (scheduled-jobs IDOR #2, preference IDOR #5), T3 (timing-safe #7, + open-redirect #6 documented verified-safe). §2 discovery sweep → T4. §3 CI gates → T6. §4 structure → T1–T7. Scope boundary (untyped actions, team await) → T3a, T2c; teamService mislabel correctly deferred (not in plan → P9). Success criteria (Critical/High + tests, Medium/Low doc, tsc drops, advisory CI) → T5/T7. All covered.

**Placeholder scan:** T4/T5 fixes are unknown-until-discovery by nature (a sweep can't pre-write fixes for undiscovered vulns) — the PROCESS + verification bar + output artifact are concrete, which is the correct level for a discovery task, not a placeholder. All determinate fixes (T1–T3, T6) have concrete code.

**Type consistency:** `getScheduledJobs(orgId)`/`cancelScheduledJob(jobId, orgId)` and `getActive(orgId)`/`cancel(id, orgId)` signatures are consistent across schedulerService↔schedulerStore↔send.ts. The 4 new AuditAction members match the exact strings the services already emit (recon §7). `isAllowedSnsUrl` is defined in webhookSignature.ts and consumed in webhooks.ts.

## Out of scope / follow-ups (documented, not built)

- Medium/Low sweep findings → `p8-security-followups.md`, deferred to pre-GA.
- Postmark webhook URL-secrecy (no signature mechanism) → documented.
- Inbound-reply event routing (the removed dead emits) unbuilt → P9 candidate.
- `teamService.ts:187` activity mislabel → P9.
- CAPTCHA/`/register` quotas/new-tenant quarantine → confirm during T4 sweep; log if still open.
- Flip CI security jobs required-at-GA.
