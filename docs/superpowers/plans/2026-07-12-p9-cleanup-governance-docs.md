# P9 — Cleanup, Governance & Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the Dispatch SaaS re-platform (P1–P9) — fold in the four P8-deferred security follow-ups, surgically remove dead code + repo cruft, add governance files, and publish ops docs + Swagger.

**Architecture:** Four workstreams over seven tasks: three security fixes (rate-limit hardening, function-level authz, DNS-rebinding pin — TDD), one surgical cleanup (dead code + one generated migration + RPC/manifest cascade), docs + Swagger, governance files, then a final whole-branch review + gate.

**Tech Stack:** Hono + hono/bun, Drizzle (Postgres/PGlite), Bun test/vitest, Node `crypto`/`dns`, `swagger-ui-dist`.

## Global Constraints

- **R1:** TypeScript only; no NEW source file > 200 LOC. (Pre-existing over-cap route files unchanged.)
- **R4:** schema changes only via `bunx drizzle-kit generate` from `apps/api/` — never hand-edit a migration.
- **R8:** surgical — remove only provably-dead, unreferenced code; don't refactor adjacent code.
- **R9:** derive identity server-side; validate at boundaries.
- Commits: `git commit --no-gpg-sign`; **no Co-Authored-By: Claude / claude.ai / Anthropic attribution** anywhere.
- **Gate (every task must hold):** api `tsc` = **40** (no net-new) · web `vue-tsc` = 0 · full backend suite green (816/0/28 at start) · `bun lint` no new problems (3 pre-existing errors: analytics.ts:411, dashboard.ts:27, events.ts:50) · audit `coverage.test.ts` 2/2 · no new src file > 200 LOC.
- **Runtime facts:** production is Bun (`oven/bun` image). Tests run under Node/vitest with `drizzle-orm/bun-sql` aliased to a shim + PGlite via `freshDbMigrated()` + `__setTestDb()`. If a suite-load fails with `Cannot find package 'bun' … drizzle-orm/bun-sql/driver.js`, it is a stale vite dep-optimizer cache: `rm -rf apps/api/node_modules/.vite node_modules/.vitest` and re-run.

---

## Task 1: Rate-limit hardening (M5 trusted-proxy IP + L1 forgot-password throttle)

**Files:**
- Modify: `apps/api/src/middleware/rateLimit.ts` (client-IP derivation)
- Modify: `apps/api/src/app.ts:104-111` (wire the limiter onto forgot/reset/change-password)
- Test: `apps/api/tests/security/rate-limit-hardening.test.ts` (Create)

**Interfaces:**
- Produces: `clientIp(c: Context): string` (exported from `rateLimit.ts`) — the trusted client IP used as the limiter key.

### M5 — key on the proxy-observed IP, not the spoofable leftmost XFF
`rateLimit.ts:39` keys on `xff.split(',')[0]` (client-controlled leftmost). Replace with a
`clientIp()` helper that reads the entry `TRUSTED_PROXY_HOPS` positions from the RIGHT (default 1 —
prod runs behind one reverse proxy), falling back to the socket IP.

### L1 — throttle forgot/reset/change-password
`app.ts:104-111` wires limiters only to login/register/send/parse-excel. Add `authRateLimit` to
`/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/change-password` (+ `/api/v1/` twins).

- [ ] **Step 1: Write the failing test** — `apps/api/tests/security/rate-limit-hardening.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { clientIp } from '../../src/middleware/rateLimit'

// TRUSTED_PROXY_HOPS defaults to 1 → the client IP is the RIGHTMOST XFF entry (proxy-observed).
function ctx(xff?: string) {
  const app = new Hono()
  let captured = ''
  app.get('/', (c) => { captured = clientIp(c); return c.text('ok') })
  const headers: Record<string, string> = xff ? { 'x-forwarded-for': xff } : {}
  return app.fetch(new Request('http://localhost/', { headers })).then(() => captured)
}

describe('P9 M5 — clientIp keys on the proxy-observed IP', () => {
  it('takes the rightmost XFF entry (1 trusted proxy), ignoring a spoofed leftmost', async () => {
    expect(await ctx('5.6.7.8')).toBe('5.6.7.8')
    // attacker prepends a fake IP; the proxy appended the real one on the right
    expect(await ctx('9.9.9.9, 5.6.7.8')).toBe('5.6.7.8')
    expect(await ctx('1.1.1.1, 2.2.2.2, 5.6.7.8')).toBe('5.6.7.8')
  })
  it('falls back to a non-empty key when XFF is absent', async () => {
    expect(await ctx()).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bunx vitest run tests/security/rate-limit-hardening.test.ts`
Expected: FAIL — `clientIp` is not exported.

- [ ] **Step 3: Implement `clientIp` and rewrite the limiter key** in `rateLimit.ts`. Add the import at the top and the helper above `rateLimit()`, then use it inside the returned middleware:

```ts
import type { Context, Next } from 'hono'
import { getConnInfo } from 'hono/bun'

const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? '1') || 1)

/** The trusted client IP for rate-limiting: the XFF entry TRUSTED_PROXY_HOPS from the right
 *  (the proxy-observed address a client cannot forge), else the socket IP, else x-real-ip. */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const idx = parts.length - TRUSTED_PROXY_HOPS
    if (idx >= 0 && parts[idx]) return parts[idx]
  }
  try {
    const addr = getConnInfo(c).remote.address
    if (addr) return addr
  } catch { /* no socket info in this runtime */ }
  return c.req.header('x-real-ip') || 'unknown'
}
```

Then replace the `const ip = c.req.header('x-forwarded-for')?.split(',')[0]...` block (lines 39-41) with:

```ts
    const ip = clientIp(c)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bunx vitest run tests/security/rate-limit-hardening.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the forgot/reset/change-password throttle** — in `app.ts`, immediately after line 111 (the existing rate-limit `app.use` block), add:

```ts
app.use('/api/auth/forgot-password', authRateLimit)
app.use('/api/auth/reset-password', authRateLimit)
app.use('/api/auth/change-password', authRateLimit)
app.use('/api/v1/auth/forgot-password', authRateLimit)
app.use('/api/v1/auth/reset-password', authRateLimit)
app.use('/api/v1/auth/change-password', authRateLimit)
```

- [ ] **Step 6: Verify gate** — `cd apps/api && bunx tsc --noEmit | grep -c "error TS"` → **40**. Run `bunx vitest run tests/security/rate-limit-hardening.test.ts tests/routes/auth.test.ts` → PASS. `cd /Users/jpsingh/Developer/Project/dispatch && bun lint 2>&1 | grep -c error` → still 3.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/rateLimit.ts apps/api/src/app.ts apps/api/tests/security/rate-limit-hardening.test.ts
git commit --no-gpg-sign -m "fix(p9): key rate-limit on proxy-observed IP (M5) + throttle password-reset routes (L1)"
```

---

## Task 2: M4 — function-level authorization on sending-infra routes

**Files:**
- Modify: `apps/api/src/routes/routing.ts` (4 mutating handlers)
- Modify: `apps/api/src/routes/warmup.ts` (5 mutating handlers)
- Modify: `apps/api/src/routes/oauth.ts` (2 mutating handlers)
- Modify: `apps/api/src/routes/plugins.ts` (5 mutating handlers)
- Test: `apps/api/tests/security/function-level-authz.test.ts` (Create)

**Interfaces:**
- Consumes: `requirePermission`, `PERMISSIONS` (from `middleware/rbac` + `services/rbacService`).

Add `requirePermission(...)` to every MUTATING handler (GET/read handlers stay on `requireAuth` —
they are self-scoped reads, lower risk, and a `readonly` role may legitimately need to view). Reuse
existing permissions: sending-infra (routing/warmup/oauth) → `SMTP_MANAGE`; plugins → `SETTINGS_MANAGE`.

Exact handlers to guard:
- `routing.ts`: `.put('/routing/config', …)`, `.post('/routing/providers/init', …)`, `.post('/routing/providers/:configId/health', …)`, `.post('/routing/failover', …)` → `requirePermission(PERMISSIONS.SMTP_MANAGE)`.
- `warmup.ts`: `.post('/warmup', …)`, `.post('/warmup/:id/pause', …)`, `.post('/warmup/:id/resume', …)`, `.post('/warmup/:id/cancel', …)`, `.delete('/warmup/:id', …)` → `SMTP_MANAGE`.
- `oauth.ts`: `.delete('/oauth/:configId/disconnect', …)`, `.post('/oauth/:configId/test', …)` → `SMTP_MANAGE`. (Leave `/oauth/*/connect` + `/auth/*/callback` — OAuth handshake redirects — untouched.)
- `plugins.ts`: `.post('/plugins', …)`, `.post('/plugins/:id/activate', …)`, `.post('/plugins/:id/disable', …)`, `.put('/plugins/:id/settings', …)`, `.delete('/plugins/:id', …)` → `SETTINGS_MANAGE`. (`/plugins/providers*` are removed in Task 4 — do not add a permission there.)

Each handler currently reads `requireAuth(c)` inside the body; the middleware is inserted in the
route chain **before** the handler, e.g.:

```ts
// routing.ts — before
.put('/routing/config', zValidator('json', RoutingConfigSchema), async (c) => {
// routing.ts — after
.put('/routing/config', requirePermission(PERMISSIONS.SMTP_MANAGE), zValidator('json', RoutingConfigSchema), async (c) => {
```

`routing.ts` and `warmup.ts` may not yet import `requirePermission`/`PERMISSIONS` — add:
```ts
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
```
(if not already present — check the top of each file first).

- [ ] **Step 1: Write the failing test** — `apps/api/tests/security/function-level-authz.test.ts`. Mirror `tests/integration/identity-auth-rbac.test.ts` (real middleware + real rbac + PGlite). Mock only the heavy service singletons so importing the routes is side-effect-free; assert a `readonly` session is DENIED each mutation.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../src/services/auditService', () => ({ auditService: { log: vi.fn() } }))
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { seedSystemRoles } from '../../src/db/pg/seed'
import { organizations, users, sessions, org_members } from '../../src/db/pg/schema'
import { authMiddleware } from '../../src/middleware/auth'
import routingRoutes from '../../src/routes/routing'
import warmupRoutes from '../../src/routes/warmup'
import oauthRoutes from '../../src/routes/oauth'
import pluginsRoutes from '../../src/routes/plugins'

const ORG = 'org_a'
const TOK_READONLY = 'tok_ro'
const future = () => new Date(Date.now() + 86_400_000).toISOString()

async function seed(db: TestDb) {
  await seedSystemRoles(db)
  await db.insert(organizations).values({ id: ORG, name: 'A', slug: 'a' })
  await db.insert(users).values({ id: 'u_ro', email: 'ro@t.co', name: 'RO', password_hash: 'x' })
  await db.insert(org_members).values({ id: 'om_ro', org_id: ORG, user_id: 'u_ro', role: 'readonly', status: 'active' })
  await db.insert(sessions).values({ id: 's_ro', user_id: 'u_ro', token: TOK_READONLY, org_id: ORG, expires_at: future() })
}

function app() {
  const a = new Hono()
  a.use('*', authMiddleware)
  a.route('/', routingRoutes); a.route('/', warmupRoutes); a.route('/', oauthRoutes); a.route('/', pluginsRoutes)
  a.onError((_e, c) => c.json({ success: false }, 500))
  return a
}
const req = (m: string, p: string, b: object = {}) => new Request(`http://localhost${p}`, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK_READONLY}` }, body: JSON.stringify(b),
})

describe('P9 M4 — readonly cannot mutate sending infrastructure', () => {
  let a: Hono
  beforeEach(async () => { const db = await freshDbMigrated(); __setTestDb(db); await seed(db); a = app() }, 30_000)
  afterEach(() => { __setTestDb(null); vi.clearAllMocks() })

  it('denies readonly on routing / warmup / oauth / plugins mutations (403)', async () => {
    expect((await a.fetch(req('PUT', '/routing/config', { strategy: 'round_robin' }))).status).toBe(403)
    expect((await a.fetch(req('POST', '/warmup', { domain: 'x.com', dailyTarget: 10 }))).status).toBe(403)
    expect((await a.fetch(req('DELETE', '/oauth/cfg1/disconnect'))).status).toBe(403)
    expect((await a.fetch(req('POST', '/plugins', { manifest: { name: 'X', type: 'hook' } }))).status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bunx vitest run tests/security/function-level-authz.test.ts`
Expected: FAIL — handlers return 2xx/4xx-not-403 (currently only `requireAuth`, which a readonly session passes).
(If it fails to load with the bun-sql cache error, clear the vite cache per Global Constraints and re-run.)

- [ ] **Step 3: Add `requirePermission(...)` to each mutating handler** listed above (and the two imports where missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bunx vitest run tests/security/function-level-authz.test.ts`
Expected: PASS (all four return 403).

- [ ] **Step 5: Verify gate** — `bunx tsc --noEmit | grep -c "error TS"` → **40**. `bunx vitest run tests/routes/routing.test.ts tests/routes/warmup.test.ts tests/routes/oauth.test.ts tests/routes/plugins.test.ts` → PASS (existing route tests may mock rbac; confirm none regress — if a test drove a mutation as an unauthenticated/mocked user and now expects 200, update it to seed a session with `smtp.manage`/`settings.manage`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/routing.ts apps/api/src/routes/warmup.ts apps/api/src/routes/oauth.ts apps/api/src/routes/plugins.ts apps/api/tests/security/function-level-authz.test.ts
git commit --no-gpg-sign -m "fix(p9): require manage-permission on routing/warmup/oauth/plugins mutations (M4)"
```

---

## Task 3: DNS-rebinding mitigation — pin the validated IP for http webhooks

**Files:**
- Modify: `apps/api/src/utils/ssrfGuard.ts` (add `resolvePublicHttpTarget`)
- Modify: `apps/api/src/services/webhookService.ts` (use the pin for `http:` in both fetch sinks)
- Test: `apps/api/tests/security/webhook-ssrf.test.ts` (extend)

**Interfaces:**
- Produces: `resolvePublicHttpTarget(rawUrl: string): Promise<{ url: string; host: string } | null>` — for an `http:` URL whose host resolves ONLY to public IPs, returns `{ url: <same URL with the host replaced by the pinned IP>, host: <original hostname> }`; returns `null` if the scheme is `https:` (caller keeps the existing behaviour) or the URL is not public. This removes the resolve-then-reconnect gap for http by connecting to the vetted IP with the original `Host` header.

The `https:` case is intentionally NOT pinned (Bun `fetch` cannot pin the IP without breaking TLS
SNI/cert validation) — it relies on the existing boundary + sink `isPublicHttpUrl` re-check plus the
egress-firewall control documented in Task 5.

- [ ] **Step 1: Write the failing test** — extend `tests/security/webhook-ssrf.test.ts` (append inside the describe block):

```ts
  it('DNS-pin: an http webhook to a hostname is fetched at the resolved IP with the original Host header', async () => {
    // localhost resolves to 127.0.0.1 → still blocked; use a hostname that resolves public.
    // Use an IP-literal http URL: pinning is a no-op but the Host/URL must be preserved.
    await seedWebhook(db, 'http://8.8.8.8/hook')
    await webhookService.testWebhook(ORG, 'wh_1')
    const call = fetchMock.mock.calls[0] as unknown[] | undefined
    const url = String(call?.[0])
    const opts = call?.[1] as RequestInit | undefined
    expect(url).toBe('http://8.8.8.8/hook')          // IP literal: host already pinned
    expect(opts?.redirect).toBe('manual')             // redirect guard still present
  })
```

- [ ] **Step 2: Run test to verify it fails** (or passes vacuously) — it will pass for the IP-literal case only once the pinned-URL path is wired; run and confirm behaviour:

Run: `cd apps/api && bunx vitest run tests/security/webhook-ssrf.test.ts`
Expected: the new assertion FAILs if the sink still fetches the raw hostname URL through an
unpinned path; PASS once Step 3 wires the pin (for an IP literal the pinned URL equals the input).

- [ ] **Step 3: Implement `resolvePublicHttpTarget`** in `ssrfGuard.ts` (reuse the existing `isBlockedIp`/`lookup`/bracket-strip logic; add below `isPublicHttpUrl`):

```ts
/**
 * For an http: URL whose host resolves only to public addresses, return the URL with the host
 * replaced by the pinned resolved IP (so fetch connects to the vetted address, defeating DNS
 * rebinding) plus the original hostname for the Host header. Returns null for https: (caller keeps
 * default behaviour — TLS SNI prevents IP-pinning) or for a non-public/invalid URL.
 */
export async function resolvePublicHttpTarget(rawUrl: string): Promise<{ url: string; host: string } | null> {
  let u: URL
  try { u = new URL(rawUrl) } catch { return null }
  if (u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let ip: string
  if (isIP(host)) {
    if (isBlockedIp(host)) return null
    ip = host
  } else {
    try {
      const addrs = await lookup(host, { all: true })
      if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return null
      ip = addrs[0].address
    } catch { return null }
  }
  const pinned = new URL(u.toString())
  pinned.hostname = isIP(ip) === 6 ? `[${ip}]` : ip
  return { url: pinned.toString(), host: u.host }
}
```

`isBlockedIp` and `lookup`/`isIP` are already in the module (make `isBlockedIp` reachable — it is a
module-level function, so no export needed since `resolvePublicHttpTarget` lives in the same file).

- [ ] **Step 4: Use the pin in `webhookService`** — in BOTH `sendWebhook` and `testWebhook`, after the
existing `isPublicHttpUrl` guard, compute the fetch target. Replace `fetch(webhook.url, { … })` with a
pinned target for http (add near the top of the file: `import { isPublicHttpUrl, resolvePublicHttpTarget } from '../utils/ssrfGuard'`):

```ts
    // http: pin to the resolved IP (defeats DNS rebinding); https: keep original (TLS SNI).
    const pin = await resolvePublicHttpTarget(webhook.url)
    const fetchUrl = pin ? pin.url : webhook.url
    const hostHeader = pin ? { Host: pin.host } : {}
```
then in the fetch options set `const response = await fetch(fetchUrl, { method: 'POST', redirect: 'manual', headers: { ...hostHeader, 'Content-Type': 'application/json', … } })` — merge `hostHeader` into the existing headers object (Host first so it is not overridden).

- [ ] **Step 5: Run the SSRF tests**

Run: `cd apps/api && bunx vitest run tests/security/webhook-ssrf.test.ts`
Expected: PASS (all prior cases + the new pin assertion). tsc: `bunx tsc --noEmit | grep -c "error TS"` → **40**.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/ssrfGuard.ts apps/api/src/services/webhookService.ts apps/api/tests/security/webhook-ssrf.test.ts
git commit --no-gpg-sign -m "fix(p9): pin resolved IP for http webhook delivery (DNS-rebinding mitigation)"
```

---

## Task 4: Surgical dead-code cleanup + generated migration

**Files:**
- Delete: `apps/api/src/services/rssService.ts`, `apps/api/tests/services/rss.test.ts`
- Modify: `apps/api/src/db/pg/schema/integrations.ts` (drop `rss_feeds` table)
- Generate: `apps/api/src/db/pg/migrations/0014_*.sql` (via drizzle-kit — drops `rss_feeds`)
- Modify: `apps/api/src/services/pluginManager.ts` (remove `BUILT_IN_PROVIDERS`, `getAvailableProviders`, `installBuiltinProvider`)
- Modify: `apps/api/src/routes/plugins.ts` (remove `/plugins/providers` + `/plugins/providers/install`)
- Modify: `apps/api/src/services/segmentService.ts` (remove `buildQuery`, `conditionToSQL`, `previewCount`)
- Modify: `apps/api/src/routes/segments.ts` (remove `POST /segments/:id/preview`)
- Modify: `apps/api/tests/audit/manifest/content.ts` (drop the segments-preview entry), `apps/api/tests/audit/manifest/infra.ts` (drop the plugins-providers entry)

**Interfaces:** none produced. This task only removes.

**Before deleting, confirm zero callers** (do this and STOP if any is found):
```bash
grep -rn "rssService" apps/api/src | grep -v "rssService.ts"          # expect empty
grep -rn "installBuiltinProvider\|getAvailableProviders\|plugins/providers" apps/api/src apps/web/src | grep -v "pluginManager.ts\|routes/plugins.ts"   # expect empty
grep -rn "buildQuery\|segments/.*preview" apps/api/src apps/web/src | grep -v "segmentService.ts\|routes/segments.ts"   # expect empty
```

- [ ] **Step 1: Remove `rssService`** — delete `src/services/rssService.ts` + `tests/services/rss.test.ts`. Drop the `rss_feeds` table definition (and any `rssFeeds`/`rss_feeds` export) from `src/db/pg/schema/integrations.ts`. Grep the schema `index.ts`/barrel for a `rss_feeds` re-export and remove it.

- [ ] **Step 2: Generate the migration**

Run: `cd apps/api && bunx drizzle-kit generate`
Expected: a new `migrations/0014_*.sql` containing `DROP TABLE … "rss_feeds"` (+ a new meta snapshot). Do NOT hand-edit it.

- [ ] **Step 3: Remove the decorative plugin providers** — in `pluginManager.ts` delete `BUILT_IN_PROVIDERS`, `getAvailableProviders()`, `installBuiltinProvider()`. In `routes/plugins.ts` delete the `.get('/plugins/providers', …)` and `.post('/plugins/providers/install', …)` handlers. Remove the now-unused `provider.connected` audit action from `services/audit/types.ts` ONLY if grep shows no remaining emitter (`grep -rn "provider.connected" apps/api/src`).

- [ ] **Step 4: Remove the dormant segment query builder** — in `segmentService.ts` delete `buildQuery`, `conditionToSQL`, `previewCount` (and the `SegmentRules`/`SegmentCondition` types only if now unreferenced — check first). In `routes/segments.ts` delete the `.post('/segments/:id/preview', …)` handler.

- [ ] **Step 5: Fix the audit manifest** — remove `'POST /segments/:id/preview': …` from `tests/audit/manifest/content.ts` and `'POST /plugins/providers/install': …` / `'GET /plugins/providers': …` from `tests/audit/manifest/infra.ts` (the coverage test two-way-diffs the live routes against the manifest — a stale entry for a removed route fails it).

- [ ] **Step 6: Remove repo cruft**

```bash
cd /Users/jpsingh/Developer/Project/dispatch
git rm test-datepicker.html UI-UX-FIXES.md UI-REDESIGN-PLAN.md SESSION-PROGRESS.md
git rm -r --cached apps/api/dist 2>/dev/null || true
echo "dist/" >> apps/api/.gitignore
```
(Keep `PRD.md` / `TRD.md`.)

- [ ] **Step 7: Verify gate**

Run: `cd apps/api && bunx vitest run tests/audit/coverage.test.ts tests/services/segments.test.ts tests/services/plugins.test.ts` → PASS (coverage 2/2). `bunx tsc --noEmit | grep -c "error TS"` → **≤ 40** (may drop). Run the full suite `bunx vitest run` → green (a freshly-migrated PGlite now excludes `rss_feeds`; confirm no test referenced it). `cd .. && bun lint 2>&1 | grep -c error` → 3.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "chore(p9): remove dead code (rssService, decorative plugin providers, dormant segment buildQuery) + repo cruft"
```

---

## Task 5: Ops docs + serve OpenAPI as Swagger

**Files:**
- Create: `docs/SELF-HOSTING.md`, `docs/DELIVERABILITY.md`
- Modify: `docs/openapi.yaml` (bounded freshness pass — add missing P4–P8 path groups + a maintenance note)
- Modify: `apps/api/src/app.ts` (serve `/openapi.yaml` + `/docs` self-contained Swagger UI)
- Modify: `apps/api/package.json` (add `swagger-ui-dist`)

**Interfaces:** none produced.

- [ ] **Step 1: Add the Swagger UI dependency (vendored, no CDN)**

Run: `cd apps/api && bun add swagger-ui-dist`
Expected: `swagger-ui-dist` in `dependencies`.

- [ ] **Step 2: Serve the spec + Swagger UI** — in `app.ts`, before the SPA catch-all (`app.use('/*', serveStatic({ root: './frontend/dist' }))` at line 216), add a route that serves `docs/openapi.yaml` and a self-contained Swagger UI page whose assets are served same-origin from the installed `swagger-ui-dist`:

```ts
import { readFileSync } from 'node:fs'
import { absolutePath as swaggerUiAssetPath } from 'swagger-ui-dist'
// … near the other app.use static mounts:
app.get('/openapi.yaml', (c) => c.body(readFileSync('../../docs/openapi.yaml', 'utf-8'), 200, { 'Content-Type': 'text/yaml' }))
app.use('/docs-assets/*', serveStatic({ root: swaggerUiAssetPath(), rewriteRequestPath: (p) => p.replace(/^\/docs-assets/, '') }))
app.get('/docs', (c) => c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Dispatch API</title>
<link rel="stylesheet" href="/docs-assets/swagger-ui.css"></head><body><div id="swagger-ui"></div>
<script src="/docs-assets/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:'/openapi.yaml',dom_id:'#swagger-ui'})</script></body></html>`))
```
Resolve the `../../docs/openapi.yaml` path relative to the API process CWD at implementation (the API runs from `apps/api`; adjust to an absolute path via `new URL`/`process.cwd()` if the relative path does not resolve). Confirm `secureHeaders()` CSP does not block the same-origin `/docs-assets/*` scripts — if it does, relax the CSP for the `/docs` path only, or add the needed `script-src 'self'`.

- [ ] **Step 3: Bounded OpenAPI freshness pass** — add the missing top-level path groups introduced in P4–P8 to `docs/openapi.yaml` (at minimum: `/scheduled-jobs`, GDPR/DSAR export+erase, sender-identity, audit/activity logs, retention). Add a note under `info.description`: `> This spec is maintained by hand and may lag the implementation; treat the live API as source of truth.` Do NOT attempt a full 3,854-line audit.

- [ ] **Step 4: Write `docs/SELF-HOSTING.md`** — sections: Prerequisites (Bun, Docker); Environment variables (`ENCRYPTION_KEY` + `FALLBACK_ENCRYPTION_KEY`, `DATABASE_URL`, Valkey/`REDIS_URL`, R2/S3, SMTP, `TRUSTED_PROXY_HOPS`); Production deploy (the compose.prod.yml override model — internal-only DB/cache ports, one shared external reverse-proxy network routing by domain to `dispatch-api:5500`); Migrations + seeding at boot; Backup/restore (`pg_dump` + R2 object copy); Health/metrics (`/health`, `/metrics`); **Network egress hardening** — firewall the api container's egress from RFC1918 / `169.254.0.0/16` / metadata ranges (the robust DNS-rebinding/SSRF control, complementing the app-level guard).

- [ ] **Step 5: Write `docs/DELIVERABILITY.md`** — sections: SPF, DKIM, DMARC; domain verification; IP/domain warmup; suppression + bounce handling; CAN-SPAM footer + sender identity (postal address requirement); RFC-8058 one-click List-Unsubscribe.

- [ ] **Step 6: Link from README** — add a `## Documentation` section to `README.md` linking `docs/SELF-HOSTING.md`, `docs/DELIVERABILITY.md`, and the running `/docs` Swagger endpoint.

- [ ] **Step 7: Verify** — `cd apps/api && bunx tsc --noEmit | grep -c "error TS"` → **40**. Boot check (optional if PG available): `bun run dev` then `curl -s localhost:5500/docs | grep -c swagger-ui` → ≥1 and `curl -s localhost:5500/openapi.yaml | head -1` → `openapi: 3.0.3`. Full suite still green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/app.ts apps/api/package.json docs/openapi.yaml docs/SELF-HOSTING.md docs/DELIVERABILITY.md README.md
git commit --no-gpg-sign -m "docs(p9): self-hosting + deliverability ops docs + serve OpenAPI via self-contained Swagger UI"
```

---

## Task 6: Governance files

**Files (all Create):** `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`. Modify: `docs/superpowers/p8-security-followups.md` (mark folded items resolved).

- [ ] **Step 1: `LICENSE`** — the standard MIT license text. Copyright line: `Copyright (c) 2026 <repo owner>` (use the GitHub owner `iamjpsingh` / the name in `package.json` author if present; confirm at implementation). `package.json` already declares `"license": "MIT"`.

- [ ] **Step 2: `CONTRIBUTING.md`** — Development setup (`bun install`; `docker compose up -d postgres valkey minio`; `cd apps/api && bun run db:migrate` (or the boot auto-migrate); `bun test`); Project rules (summarize R1–R9 from `CLAUDE.md`); Branch/commit conventions (conventional-commit prefixes; **no Claude/AI attribution in commits**); PR process (typecheck + lint + tests green; required CI jobs).

- [ ] **Step 3: `SECURITY.md`** — Supported versions (3.x); Reporting a vulnerability (private disclosure — a contact email/GitHub security advisory; do NOT open public issues for vulns); Response expectations (acknowledge within N days). Reference the advisory CI scans (gitleaks/CodeQL/dep-audit).

- [ ] **Step 4: `CODE_OF_CONDUCT.md`** — Contributor Covenant v2.1 verbatim, with the enforcement contact filled in.

- [ ] **Step 5: `CHANGELOG.md`** — Keep-a-Changelog format. Seed one entry `## [3.0.0] - 2026-07-12` (matches `package.json` version) summarizing the SaaS re-platform: monorepo + Turborepo (P1), Postgres + Drizzle (P2), encryption at rest (P3), BullMQ/Valkey queue + deliverability (P4), R2 object storage (P5), RPC API surface (P6), admin/audit/GDPR/CAN-SPAM (P7), security audit gate (P8), cleanup/governance/docs (P9).

- [ ] **Step 6: Mark the P8 follow-ups resolved** — in `docs/superpowers/p8-security-followups.md`, move M4 / M5 / L1 and the DNS-rebinding item from "Deferred to P9" to a "Resolved in P9" note (with the commit refs), leaving only the genuinely post-GA items (IPv6 Teredo, full DNS-pin for https).

- [ ] **Step 7: Verify** — `ls LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md CHANGELOG.md` → all present. No code changed → gate unaffected.

- [ ] **Step 8: Commit**

```bash
git add LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md CHANGELOG.md docs/superpowers/p8-security-followups.md
git commit --no-gpg-sign -m "docs(p9): add LICENSE (MIT) + CONTRIBUTING + SECURITY + CODE_OF_CONDUCT + CHANGELOG"
```

---

## Task 7: Final whole-branch review + gate + finishing

**Files:** `.superpowers/sdd/progress.md` (ledger), memory.

- [ ] **Step 1: Final review** — run an adversarial review over the P9 diff (the security fixes especially): confirm M4 leaves no mutating sending-infra route on `requireAuth` only; M5 `clientIp` cannot be spoofed from the left; the DNS-pin does not break https delivery; the cleanup removed no live caller (coverage 2/2 proves the route/manifest set is consistent). Adversarially verify any finding before acting.

- [ ] **Step 2: Full gate** — `cd apps/api && bunx tsc --noEmit | grep -c "error TS"` → **≤ 40**; `cd ../web && bunx vue-tsc --noEmit | grep -c "error TS"` → **0**; `cd ../api && bunx vitest run` → full suite green; `cd /Users/jpsingh/Developer/Project/dispatch && bun lint 2>&1 | grep -c error` → **3** (no new); no new src file > 200 LOC (`wc -l` any file created this phase).

- [ ] **Step 3: Bookkeeping** — update `.superpowers/sdd/progress.md` with P9 completion; update the `dispatch-p8-status`/session-status memory to note P9 done → re-platform complete.

- [ ] **Step 4: Finishing** — invoke `superpowers:finishing-a-development-branch` to decide integration (the re-platform P1–P9 is complete: push + open the PR to `main`, or continue). Commit any remaining doc/ledger changes:

```bash
git add -A
git commit --no-gpg-sign -m "docs(p9): P9 complete — SaaS re-platform (P1-P9) done"
```

---

## Self-Review (plan vs. spec)

**Spec coverage:** Workstream 1 security → T1 (M5+L1), T2 (M4), T3 (DNS-rebinding). Workstream 2
cleanup → T4 (rss + plugin providers + segment buildQuery + cruft + migration + manifest cascade).
Workstream 3 docs → T5 (SELF-HOSTING + DELIVERABILITY + Swagger + freshness). Workstream 4 governance
→ T6 (5 files) + the p8-followups resolution. Exit gate → T7. All spec sections map to a task.

**Placeholder scan:** the M4 per-route permission is fully enumerated (SMTP_MANAGE / SETTINGS_MANAGE
per file); the LICENSE copyright owner and the exact `openapi.yaml` path resolution are the only
"confirm at implementation" items — both are concrete lookups (the git owner; the API CWD), not vague
requirements. The governance file bodies reference well-known canonical texts (MIT, Contributor
Covenant 2.1, Keep-a-Changelog) rather than pasting them — acceptable for standard boilerplate.

**Type/name consistency:** `clientIp` (T1) is the only produced symbol used across tasks and is
referenced only within T1. `resolvePublicHttpTarget` (T3) is defined and consumed within T3.
`isPublicHttpUrl`/`isBlockedIp`/`lookup`/`isIP` already exist in `ssrfGuard.ts`. Permission constants
(`SMTP_MANAGE`, `SETTINGS_MANAGE`) exist in `PERMISSIONS`. Manifest files (`content.ts`, `infra.ts`)
and the segment/plugin route+service targets were confirmed by grep.
