# P9 — Cleanup, Governance & Docs — Design Spec

**Status:** approved (brainstorm 2026-07-12) · **Branch:** `feat/saas-replatform` (P1–P8 complete + pushed @ 3c0ab70)

## Goal

Close the LOCKED SaaS re-platform (P1–P9) by making the repo GA-ready: fold in the four
P8-deferred security follow-ups, surgically remove dead/decorative code and repo cruft, add the
missing governance files (LICENSE is a confirmed release-blocker), and publish self-hosting +
deliverability ops docs and the OpenAPI spec as Swagger. **Exit:** lean tree; governance complete;
docs published; no open Critical/High/Medium security items.

## Scope

**In scope** (chosen "spec-scoped + security", "surgical" cleanup):
- Security follow-ups: **M4** (missing `requirePermission`), **M5** (spoofable XFF rate-limit),
  **L1** (forgot-password throttle), **DNS-rebinding** mitigation.
- Surgical dead-code removal + repo cruft + one generated migration for orphaned tables.
- Governance: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`.
- Docs: `SELF-HOSTING.md`, `DELIVERABILITY.md`, serve OpenAPI via self-contained Swagger UI +
  a bounded freshness pass.

**Out of scope — deferred post-GA** (tracked, not addressed here):
- Pre-existing debt: api `tsc` 40 route/service contract-type errors; 3 baseline lint errors
  (analytics.ts:411, dashboard.ts:27, events.ts:50); ~64 web test failures (reka-ui SelectIcon
  jsdom crash). These predate P9 and are not release-blockers.
- i18n (entirely unbuilt — a from-scratch feature, not cleanup).
- `d1UserDatabase` → Postgres migration (still the LIVE SMTP-config store, 8 importers — a real
  migration, not cleanup).
- Full line-by-line OpenAPI reconciliation of all 3,854 lines / auto-generation from Hono (needs
  re-plumbing every route with `@hono/zod-openapi`).
- Automation `http_request`/`webhook` flow-nodes and the generic plugin **hook framework** are
  KEPT as unfinished extension points (documented, not removed).

## Global Constraints

- **R1** TS only; no NEW source file > 200 LOC (pre-existing over-cap files unchanged).
- **R4** schema changes only via `bunx drizzle-kit generate` from `apps/api/`.
- **R8** surgical — removals limited to provably-dead, unreferenced code.
- **R9** security structural/server-side; validate at boundaries.
- Commits: `--no-gpg-sign`; **no Claude/claude.ai attribution** on commits/PRs/artifacts.
- **Gate baseline:** api `tsc` = 40 (no net-new) · web vue-tsc 0 · full backend suite green
  (816/0/28 at P8 close) · `bun lint` no new problems · audit coverage 2/2 · no new src file > 200.

---

## Workstream 1 — Security follow-ups (TDD, regression test each)

### M4 — Missing `requirePermission` (broken function-level authz)
`routing.ts`, `plugins.ts`, `oauth.ts`, `warmup.ts` gate every handler on `requireAuth` only, so a
`readonly`/`member` role can mutate sending infrastructure. **Fix:** add `requirePermission(...)` to
each handler, **reusing existing permissions** (no new permission constants): provider/sending-infra
mutations (routing config + failover + provider init/health, OAuth disconnect/test, warmup
create/pause/cancel/delete) → `SMTP_MANAGE`; plugin install/activate/disable/settings/uninstall →
`SETTINGS_MANAGE`; read-only handlers → the matching `*_VIEW`. Exact per-route mapping finalized at
implementation against `config.ts`'s precedent. **RED test:** a `readonly`-session hits each mutating
route → expect 403; an authorized role → 200/2xx.

### L1 — No throttle on `POST /auth/forgot-password`
`forgot-password` (and `reset-password`/`change-password`) are covered by no rate-limiter. **Fix:**
wire the existing `authRateLimit` (or a dedicated per-email cooldown) onto these routes in `app.ts`.
**RED test:** N+1 rapid calls from one key → 429 after the limit.

### M5 — Rate limiter keys on spoofable leftmost X-Forwarded-For
`middleware/rateLimit.ts` keys on `xff.split(',')[0]` (client-controlled). **Fix:** introduce a
`TRUSTED_PROXY_HOPS` env (default **1** — prod runs behind one reverse proxy per the deploy decision).
Derive the client IP as the entry `hops` positions from the RIGHT of `X-Forwarded-For` (the
proxy-observed IP the client cannot forge); fall back to the connecting/socket IP (Hono `getConnInfo`)
when XFF is absent or too short. **RED test:** a spoofed leftmost XFF no longer yields a fresh bucket;
the real (rightmost/socket) IP is the key.

### DNS-rebinding mitigation (defense-in-depth)
`isPublicHttpUrl` resolves the host, then `fetch` re-resolves independently, so an attacker
controlling authoritative DNS can pass the guard and connect to an internal IP. **Bun's `fetch` has no
clean custom-dispatcher/lookup for IP-pinning** (esp. with TLS SNI). **Fix (two layers):**
1. App-level pin where feasible — for `http:`, after `isPublicHttpUrl` validates, connect to the
   resolved IP with the original `Host` header (so no re-resolution). For `https:`, attempt the same
   only if it can be done without breaking SNI/cert validation; otherwise leave the boundary + sink
   re-check as-is (already closes the open-SSRF) and rely on layer 2.
2. **Network egress policy is the real control** — `SELF-HOSTING.md` documents firewalling the app
   container's egress from RFC1918 / link-local / metadata ranges. App guard + egress firewall =
   defense-in-depth.
No brittle full-IP-pin for https. Update the overstated code comment if the pin is partial.

---

## Workstream 2 — Surgical dead-code cleanup (+ 1 migration)

Remove only provably-dead, unreferenced code; drop orphaned tables via a generated migration; handle
the removal cascade (RPC types + audit manifest + web callers).

- **`rssService`** — unmounted, no worker invokes it. Remove `src/services/rssService.ts` + its test +
  the orphaned `rss_feeds` table (generated migration). Confirm zero importers first.
- **Decorative built-in plugin providers** — remove `BUILT_IN_PROVIDERS` (ses/sendgrid/postmark),
  `getAvailableProviders`, `installBuiltinProvider`, and the `/plugins/providers` +
  `/plugins/providers/install` routes (no send-path consumer). **Keep** the generic plugin framework
  (manifest install, get/list/activate/disable, hooks). Retire the `provider.connected` audit action
  only if it becomes unused.
- **`segmentService.buildQuery` / `conditionToSQL` / `previewCount`** — dormant (echo-only;
  `rules_json` is never populated). Remove them + the `POST /segments/:id/preview` route. Keep the
  rest of segmentService.
- **Repo cruft** — remove stale root files (`test-datepicker.html`, `UI-UX-FIXES.md`,
  `UI-REDESIGN-PLAN.md`, `SESSION-PROGRESS.md`) and the stale `apps/api/dist` build artifact
  (+ gitignore it). **Keep** `PRD.md` / `TRD.md` (reference).
- **Cascade per removed route:** drop its RPC route-type export; remove its audit-manifest entry
  (else the coverage test's two-way diff fails); grep web for `/plugins/providers` and
  `/segments/:id/preview` callers and remove those calls / UI bits. Gate: api tsc no worse, full suite
  green, audit coverage 2/2, generated migration validated on PGlite.

---

## Workstream 3 — Docs + Swagger

- **Serve OpenAPI as Swagger** — `docs/api-explorer.html` is a Swagger UI viewer but pulls assets from
  a CDN (breaks under CSP/offline). Serve `docs/openapi.yaml` at `GET /docs` via a **self-contained**
  Swagger UI (assets vendored, no CDN). openapi.yaml (3,854 lines, hand-maintained, no generator) is
  stale past P4 → do a **bounded freshness pass** adding the missing top-level P4–P8 path groups
  (scheduled-jobs, GDPR/DSAR, sender-identity, audit/activity, retention) + a header note that the
  spec is manually maintained. Not a full 3,854-line audit; not auto-gen from Hono.
- **`docs/SELF-HOSTING.md`** — prod deploy model (compose.prod.yml override: internal-only DB/cache
  ports, shared external network behind one reverse proxy routing by domain), required env
  (ENCRYPTION_KEY + FALLBACK_ENCRYPTION_KEY, DATABASE_URL, Valkey/ioredis, R2/S3, SMTP), boot
  migrations + seeding, backup/restore (pg_dump + R2), `/health` + `/metrics`, and the
  **egress-firewall recommendation** (Workstream 1).
- **`docs/DELIVERABILITY.md`** — SPF/DKIM/DMARC, domain verification, IP warmup, suppression/bounce
  handling, CAN-SPAM footer + sender identity, RFC-8058 List-Unsubscribe.
- Link both ops docs + the `/docs` Swagger endpoint from `README.md`.

---

## Workstream 4 — Governance files

Standard templates, additive:
- **`LICENSE`** — MIT (matches `package.json` `"license": "MIT"`); copyright holder = repo owner.
- **`CONTRIBUTING.md`** — dev setup (`bun install`, `docker compose up`, migrations, tests), the
  R1–R9 rules summary, branch/commit conventions (incl. no-Claude-attribution), PR process.
- **`SECURITY.md`** — private vulnerability disclosure (no public issues for vulns; response
  expectations), supported versions.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant v2.1.
- **`CHANGELOG.md`** — Keep-a-Changelog format, seeded with the P1–P9 SaaS re-platform as the
  **3.0.0** entry (matches `package.json` version).

---

## Execution (grouped SDD, ~5 tasks)

1. **Security follow-ups** — M4 + L1 + M5 + DNS-pin, TDD (RED→GREEN), regression test each.
2. **Surgical cleanup** — dead-code removal + generated migration + RPC/manifest/web cascade.
3. **Docs** — SELF-HOSTING + DELIVERABILITY + serve Swagger + freshness pass.
4. **Governance** — 5 governance files + repo-cruft removal + README links.
5. **Final** — whole-branch review + full gate + `finishing-a-development-branch`.

Security first (only remaining GA-gating items, TDD + review); cleanup reviewed for cascade
correctness; governance/docs are mechanical/additive.

## Exit gate (P9 = re-platform complete)

- Governance complete: all 5 files present.
- Docs published: `SELF-HOSTING.md` + `DELIVERABILITY.md` + Swagger served at `/docs`.
- Lean tree: dead code + cruft removed; generated migration validated on PGlite.
- Security: M4/M5/L1 fixed with regression tests; DNS-rebinding mitigated (app-pin where feasible +
  egress-policy documented); `p8-security-followups.md` updated to mark the folded items resolved.
- api `tsc` ≤ 40 (no net-new) · web vue-tsc 0 · full backend suite green · `bun lint` no new · audit
  coverage 2/2 · no new src file > 200 LOC.

## Self-review

**Placeholder scan:** the M4 per-route permission mapping and the https-pin feasibility are marked
"finalized/decided at implementation" — these are genuine implementation-time determinations (which
existing permission best fits each route; whether Bun's https fetch can pin without breaking SNI), not
placeholders; the *rule* (reuse existing manage-permissions; egress-policy as the real DNS-rebinding
control) is concrete. **Consistency:** the exit gate matches the four workstreams; out-of-scope items
(debt, i18n, d1UserDatabase, full OpenAPI regen) are explicitly excluded and rationalized.
**Scope:** one implementation plan — four bounded workstreams + a final gate; no decomposition needed.
**Ambiguity:** cleanup depth ("surgical", keep frameworks) and Swagger effort ("bounded freshness
pass") were pinned in the brainstorm and restated here.
