# P8 — Security & Compliance Audit Gate (design)

**Date:** 2026-07-05 · **Branch:** `feat/saas-replatform` · **Phase:** P8 (task #15)
**Precedes:** P9 (cleanup/governance/docs). **Depends on:** P1–P7 complete.

## Goal

A dedicated pre-GA security pass. Two halves: (a) fix the known, enumerated vulnerabilities carried in the master spec + the items surfaced during P5–P7b; (b) run an adversarial **discovery sweep** to find unknown vulnerabilities, then triage and fix. Wire dependency/secret/hardcoded-value scans into CI. This is the "audit gate" the master re-platform spec (2026-06-06, §P8) calls for.

The app is on an unmerged branch, **not deployed** — so the fix bar is calibrated to that: fix everything Critical/High now (with a regression test per fix); triage Medium/Low into a documented pre-GA follow-up list rather than fixing exhaustively.

## Success criteria (gate to pass)

- Every **Critical/High** finding — from both the known inventory and the discovery sweep — is fixed, each with a regression test that demonstrates the hole is closed (evidence-driven; a cross-tenant repro that now 403/404s, an SSRF that's now blocked, etc.).
- **Medium/Low** findings are logged to `docs/superpowers/p8-security-followups.md` with severity, location, and repro notes — deferred to actual pre-GA, not fixed here.
- CI security jobs (CodeQL, gitleaks, `bun audit`, hardcoded-value scan) run green in **advisory** mode.
- **api `tsc` drops** (send.ts crash fix already removed 1 → 48→47; the `eventBus` fix removes 3; the untyped-action union additions remove ~4) — net target ≤ ~44 (likely ~40), and NO net-new errors.
- Full backend suite green; `bun lint` adds no new problems; no new src file > 200 LOC.

## Approach (chosen: A — fix-known-first, then sweep)

Fix the certain known items first (they need no discovery), which shrinks the sweep's noise; then run the discovery sweep against the hardened code; triage + fix new Critical/High; then wire CI gates; then whole-branch verify + document.

## Section 1 — Known-item inventory (severity-ranked)

Confirmed via recon on 2026-07-05 (line numbers approximate, verify at fix time):

| # | Finding | Severity | Fix approach + test |
|---|---|---|---|
| 1 | **SSRF** — `routes/webhooks.ts:154` `await fetch(payload.SubscribeURL)` fetches an attacker-controlled URL from the SNS `SubscriptionConfirmation` body | **Critical** | Verify the SNS signature **before** any fetch; allowlist the host to `sns.<region>.amazonaws.com`; reject internal/link-local/private targets. Test: a confirmation with a `SubscribeURL` pointing at `169.254.169.254` / `localhost` is rejected with no outbound fetch. |
| 2 | **`/api/scheduled-jobs` cross-tenant IDOR** — `schedulerService.getScheduledJobs()` → `schedulerStore.getActive()` and `cancelScheduledJob(jobId)` are permission-gated (`CAMPAIGNS_VIEW`/`MANAGE`) but **not org-scoped** | **High** | Thread `orgId` into both; filter the active list by org; assert the job's `org_id` matches the caller before cancel (404 otherwise). Test: org A cannot see or cancel org B's scheduled job. (Carried release-blocker from P5.) |
| 3 | **Webhook signature fail-open** — provider endpoints verify "when keys are available"; a missing key likely means the payload is processed unverified | **High** | Fail-closed on every provider bounce/inbound endpoint: if no verification key is configured OR the signature is invalid → 401, no processing. Test: unsigned/invalid payload is rejected; a spoofed bounce cannot suppress a recipient. |
| 4 | **`eventBus` crash** — `routes/webhooks.ts:318/345/371` call `eventBus.emit(...)` but never import it (3 `TS2304` errors) → inbound-reply handlers throw at runtime | **High** | Add `import { eventBus } from '../services/eventBus'` (matches `scoringEngine`/`tracking`/`events` usage); confirm the `.emit` signature; test the inbound-reply handler processes without throwing. Clears 3 tsc errors. |
| 5 | **Preference IDOR** — `GET`/`POST /contacts/preferences/public/:email` are unauthenticated (public, for the tracking worker) | **High → confirm** | Triage how `orgId` is derived. If client-supplied (query/body) with no token → a signed token (HMAC, like the suppression hash) or server-derived scoping so one org can't read/write another org's contact preferences. Severity confirmed by a cross-tenant repro at fix time. Test: cross-org preference read/write is rejected. |
| 6 | **Open redirect** — `routes/oauth.ts:81/93` `c.redirect(result.redirectUrl)` | **Medium → confirm** | Triage whether `redirectUrl` derives from user input (`state`/`returnTo`). If so, allowlist to same-origin / known internal paths. If it's server-constructed only, downgrade to a documented note. |
| 7 | **Non-constant-time secret compares** — webhook sigs already use `timingSafeEqual` (`middleware/webhookSignature.ts:21,61`) ✓ | **Medium** | Sweep for `===`/`!==` comparisons of reset tokens, API keys, session tokens, invitation tokens; replace with `timingSafeEqual`. Length-guard `timingSafeEqual` (it throws on length mismatch). |

Every Critical/High fix ships with its regression test. #5/#6 severity is settled by a repro attempt during triage (evidence-driven).

## Section 2 — Discovery sweep

A **bounded** adversarial review across the branch, one agent per attack surface:

- **Tenant isolation / IDOR** — is every `getDb()` read/write scoped to `orgId`? (highest-value axis — #2 and #5 prove this class exists)
- **Auth / RBAC boundaries** — missing `requirePermission`, and missing-`await` truthiness bypasses on async auth/permission calls (already hit twice: rbac in P2, team handlers in P7b)
- **Injection / input validation** — raw SQL, unvalidated boundaries, the dormant SQLite-flavored `segmentService.buildQuery` TODO
- **Secret handling** — secrets returned to the browser, secrets logged, non-constant-time compares
- **SSRF / redirect / path** — any other `fetch`/`redirect`/file access on user-controlled input

Each finding is **adversarially verified with a repro attempt before it counts** (kills phantom vulns). Findings are deduped against the Section-1 inventory. Per the P7a lesson (the review Workflow stalled twice), the sweep is a bounded fan-out with a **direct-verification fallback**: if it stalls, the controller verifies the returned findings directly rather than retrying a third time.

## Section 3 — CI security gates

P1's CI already runs **CodeQL + gitleaks** (advisory debt jobs). P8 adds:

- **Dependency CVE scan** — `bun audit` if available, else an equivalent (`npm audit` against the lockfile, or `osv-scanner`); the plan picks the working tool.
- **Hardcoded-value scan** — dual purpose: (a) secret-in-code detection (complements gitleaks), (b) **R2 audit** — flag user-facing categories/labels/options hardcoded as constants/enums that should be DB-driven.

Per the established "honest-incremental" CI philosophy (required jobs green, debt jobs advisory), the new security jobs run **advisory** (report, non-blocking) now; the design notes the flip-to-**required** at actual GA.

## Section 4 — Task structure (SDD)

1. **T1 — webhooks.ts hardening:** SSRF (#1) + fail-closed verification (#3) + eventBus import (#4). One file, one cohesive security pass, with tests.
2. **T2 — tenant-isolation IDORs:** scheduled-jobs (#2) + preference (#5). Thread/derive `orgId`; cross-tenant repro tests.
3. **T3 — redirect + secret-compare sweep:** open redirect (#6) + timing-safe compares (#7).
4. **T4 — discovery sweep + triage:** run the bounded adversarial sweep; adversarially verify each finding; produce a severity-ranked, deduped confirmed-findings list.
5. **T5 — fix sweep Critical/High:** fix each confirmed Critical/High from T4 with a regression test; log Medium/Low to the followups doc.
6. **T6 — CI security gates + hardcoded/R2 scan:** wire `bun audit` + the hardcoded-value scan (advisory); confirm CodeQL/gitleaks still green.
7. **T7 — final gate:** whole-branch security review (unmocked, source-level — the pass that caught the P7b double-log); full suite; tsc/lint/LOC gate; write `p8-security-followups.md`; mark P8 done.

## Scope boundary — P7b-flagged leftovers

- **Fold into P8:** the untyped service audit actions (`user.password_reset`/`user.password_change`, `invitation.created`/`invitation.accepted` — add to the `AuditAction` union → clears ~4 tsc errors, supports the "tsc clean" posture) — handle in T3 or T6. The teamService `create` (admin.ts:653) + `delete` (:682) missing-`await` dead-guards (correctness/security-adjacent — a no-op/not-found team op currently returns success) — handle in T2 alongside the IDOR work.
- **Defer to P9:** `teamService.ts:187` activity-feed action mislabel (`team.created` for a member-add) — cosmetic, secondary feed only; needs an ActivityAction taxonomy addition.

## Decisions

- **A — fix-known-first, then sweep** (approved): certain items closed before the open-ended sweep, reducing sweep noise.
- **Fix bar: Critical/High now, document Medium/Low** (approved): calibrated to not-deployed status; every fix carries a repro/regression test.
- **CI security jobs advisory now** (approved), flip-to-required at GA — consistent with the P1 honest-incremental CI philosophy.
- **Discovery sweep is bounded + adversarially-verified + direct-verify fallback** — heeds the P7a twice-failed-Workflow lesson.
- Existing R9 structural security (per-phase tenant scoping, encrypted secrets, zod boundaries) is assumed in place; P8 audits it, doesn't re-plumb it.

## Out of scope / follow-ups

- Full Medium/Low remediation → documented in `p8-security-followups.md`, deferred to actual pre-GA.
- CAPTCHA on `/register` + per-org quotas + new-tenant quarantine (spam-relay risk) — the master spec slates these for P3/P4; confirm status during the sweep and log if still open.
- Cryptographic audit-log hash-chaining (carried from P7b) → GA.
- i18n (P7 deferred non-goal) → pre-GA.
- teamService activity mislabel → P9.

See [[dispatch-session-status]] · [[dispatch-p7b-status]] · [[dispatch-audit-verdict]] · [[user-wants-blunt-honesty]].
