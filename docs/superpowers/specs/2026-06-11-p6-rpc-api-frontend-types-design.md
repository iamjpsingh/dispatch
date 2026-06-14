# P6 — RPC + API surface + frontend types (design)

_Phase 6 of the Dispatch SaaS re-platform. Branch `feat/saas-replatform`. Predecessor: P5
(object storage + statelessness) complete. Governs CLAUDE.md R1–R9._

## 1. Goal & exit criteria

**Master spec (P6):** "`hono/client` RPC; shared zod schemas in `packages/shared`; refactor `web`
API client; frontend component/store tests; OpenAPI drift check (generation later); `/api/v1`
versioning."

**Exit:** end-to-end type safety; **no hand-duplicated types** across the web↔api boundary.
`bun typecheck` flat at the 49-error baseline, `bun lint` clean, backend + frontend suites green,
app working at every commit (strangler).

## 2. Why this phase exists — the current state

- **Routes are dynamically mounted.** `app.ts:163` does `routes.forEach((r) => app.route('/api', r))`.
  Each route file builds its app as separate statements (`const app = new Hono()`, then
  `app.get(...)`, `app.post(...)`, `export default app`), so `typeof app` carries **no route
  schema** — `hono/client` RPC inference is impossible as-is.
- **The web client is hand-rolled with duplicated types.** `apps/web/src/lib/api/client.ts` is an
  `ApiClient` class over `fetch` plus ~170 lines of TypeScript interfaces (`SMTPConfig`, `EmailLog`,
  `Campaign`, `QueueJobSummary`, …) **hand-copied** from backend shapes. 13 `lib/api/*.ts` modules
  (~2,875 LOC) call string endpoints with manual generic type params and their own duplicated
  interfaces. This duplication is precisely what P6 removes.
- **`packages/shared` is empty** (`export {}`), reserved for the shared zod schemas.
- **Request validation is a manual call, not middleware.** Routes call `validateBody(c, Schema)`
  (`apps/api/src/utils/validate.ts`) inside handlers; **0 of 25 route files** use
  `@hono/zod-validator`'s `zValidator`, which is what RPC needs for request-type inference.

## 3. Locked decisions (from brainstorming)

1. **Strangler, domain-by-domain.** Stand up the typed client + shared zod, then migrate one domain
   per increment; each slice ships green with the app fully working. The legacy `ApiClient` stays
   until its last caller is migrated, then is deleted. (Not a big-bang cutover.)
2. **Keep the typed `{ success, data, message }` envelope.** Handlers keep returning the existing
   envelope via `success(c, …)` / `error(c, …)`; the typed client infers the envelope end-to-end so
   `body.data` is fully typed. Call sites keep reading `.data` — minimal churn, no per-route return
   rewrite, no per-call-site success/error rewrite. (Not the raw-status response shape.)
3. **Per-domain RPC types + per-domain `hc` clients** — not one global `AppType`. A single 25-route
   union is a known tsc/IDE perf cliff; per-domain types match the strangler cadence and keep each
   client small. Each route file exports `type <Domain>Routes = typeof <domain>Routes`.
4. **Defer the hono v3→v4 upgrade.** api is on `hono@^3.12.0`; `hc` RPC + `@hono/zod-validator`
   work on v3. A v4 upgrade is a breaking change (middleware signatures, etc.) and is out of scope
   for P6 (R8 surgical). Revisit separately if needed.

## 4. Architecture

```
packages/shared/src/<domain>.ts     zod request schemas + inferred types (single source of truth)
        │  imported by both sides
        ├─────────────────────────────────────────────┐
        ▼                                              ▼
apps/api/src/routes/<domain>.ts                apps/web/src/lib/rpc/<domain>.ts
  const <domain>Routes = new Hono()              const client = hc<<Domain>Routes>(`${BASE}/api/v1`)
    .get('/x', handler)                          // typed: client.<domain>[':id'].$get()
    .post('/x', zValidator('json', Schema), h)   // body inferred from shared Schema
  export default <domain>Routes
  export type <Domain>Routes = typeof <domain>Routes
        │                                              │
        ▼                                              ▼
  mounted in app.ts under BOTH /api and /api/v1   web stores/composables/views call the typed client
```

### 4.1 Shared schemas — `packages/shared`
Per domain, lift the inline zod request schemas out of the route file into
`packages/shared/src/<domain>.ts`, exporting the schema **and** its `z.infer` type. Both the API
route (validation) and the web (form/payload types) import from `@dispatch/shared`. Add
`@dispatch/shared` + `zod` to `apps/web/package.json`. A barrel `packages/shared/src/index.ts`
re-exports each domain module.

**R2 note:** only program-structure request schemas move here (field names, lengths, formats).
User-content categories (provider types, roles, statuses, tags) remain DB-backed and read at
runtime — schemas validate shape, not the allowed value set, where that set is data-driven.

### 4.2 API side — chained routes + `zValidator` + exported type (per domain)
For each domain's route file, in its increment:
1. Restructure the handlers into **one chained expression**:
   `const xRoutes = new Hono().get(...).post(...)…` so `typeof xRoutes` carries the route schema.
   Internal paths are unchanged (e.g. `/campaigns/:id`).
2. Replace each `const body = await validateBody(c, Schema)` with the
   `zValidator('json', Schema)` middleware (`@hono/zod-validator`, added to `apps/api`), reading
   `c.req.valid('json')` in the handler. Same runtime validation (still 400 on failure), now with
   request-type inference. Query/param validation uses `zValidator('query'|'param', …)` where a
   route reads them. The custom `validateBody` is retired per-domain and deleted once unused.
3. `export default xRoutes` (unchanged) **and** `export type XRoutes = typeof xRoutes`.
4. Handler return shapes are **untouched** — still `success(c, data)` / `error(c, msg, status)`.

`app.ts` changes from the `forEach` loop to explicit chained mounts, each domain mounted under
**both** `/api` (legacy client) and `/api/v1` (typed client) during the strangler.

### 4.3 Web side — typed `hc` client (per domain)
- **One-time foundation:** `apps/web/src/lib/rpc/client.ts` exposes a configured `hc` factory —
  `fetch` with `credentials: 'include'` and the CSRF-token header logic lifted verbatim from the
  current `ApiClient.request` (read `csrf_token` cookie, set `X-CSRF-Token` on mutations). Base URL
  `\`${import.meta.env.VITE_API_URL ?? ''}/api/v1\``.
- **Per domain:** `apps/web/src/lib/rpc/<domain>.ts` = `hc<<Domain>Routes>(...)`. Rewrite that
  domain's `lib/api/<domain>.ts` callers (and the store/composable/view call sites that use them) to
  the typed client; delete the domain's hand-written interface block as the typed replacement lands.
  The envelope is read as `const body = await res.json(); if (body.success) use(body.data)`.
- Importing `<Domain>Routes` (a backend **type**) into the web is type-only — no runtime backend
  code is bundled into the SPA. (Enforced by `import type`.)

### 4.4 `/api/v1` versioning
The same route handlers mount under both `/api` and `/api/v1`. New typed clients target `/api/v1`;
the legacy `ApiClient` keeps using `/api` until deleted. Public/unversioned paths (tracking,
webhooks, health, OAuth callbacks, form submit) are **not** moved under `/api/v1` — they are
external contracts. Dropping the bare `/api` prefix is deferred to P9 cleanup.

### 4.5 Frontend tests
Per migrated domain: store/composable tests that exercise the typed client against a **mocked
`fetch`** (assert request shape + envelope handling), proportional to the domain's surface — not
exhaustive endpoint coverage. Smoke tests for any view whose call sites changed. The existing
`apps/web/tests/lib/apiClient.test.ts` and `tests/lib/api.test.ts` evolve/retire as those files are
replaced. Frontend suite stays green at every commit.

### 4.6 OpenAPI drift check
Per the master spec, OpenAPI **generation is deferred** (P9 publishes Swagger). P6 adds only a
lightweight CI guard against silent drift — a test asserting every domain mounted in `app.ts` has a
corresponding `packages/shared` schema module and a typed `lib/rpc` client (so a new route can't
ship without its typed surface). Exact assertion finalized in the implementation plan.

## 5. Increment plan (each ships green: tsc=49, lint clean, suites green, app working)

- **P6.1 — Foundation + pilot.** Add `@hono/zod-validator` (api) and `hono`/`zod`/`@dispatch/shared`
  (web). Build the `hc` factory (CSRF + credentials). Scaffold `packages/shared` barrel. Convert
  `app.ts` mounting to explicit chained mounts under `/api` + `/api/v1`. Migrate **one pilot domain
  end-to-end (`auth`)** — shared schema, chained+zValidator route + exported type, typed `lib/rpc`
  client, web call sites, store/composable tests. Proves the whole pattern on the smallest real
  surface.
- **P6.2 … P6.N-1 — one domain per increment.** Suggested order by isolation/size:
  config → contacts → templates → campaigns → segments → analytics → automations → forms → pages →
  apikeys → warmup → routing → queue/send → dashboard/report → admin → whatsapp. (Server-to-server
  domains — tracking, webhooks, events, oauth, index — have no web client; they get chained+typed
  for `/api/v1` parity but no `lib/rpc` module.)
- **P6.N — Teardown + guards.** Delete the legacy `ApiClient` + any residual `lib/api/*` once
  unused; remove the now-dead `validateBody` if fully retired (flag, don't force); add the OpenAPI
  drift-check test; finalize `/api/v1`. Update `PROGRESS.md` + memory.

## 6. Risks & mitigations

- **tsc/IDE perf from large inferred types** → per-domain types (decision 3), not one `AppType`. If a
  single domain's type is still heavy, narrow the exported type to the routes the web actually calls.
- **hono v3 RPC quirks** → pin behavior with the pilot (P6.1) before fanning out; if v3's `hc` proves
  inadequate for a pattern, surface it as a scoped decision rather than silently upgrading.
- **CSRF/credentials regressions** → the `hc` factory reuses the exact header/cookie logic from
  `ApiClient`; covered by the foundation tests in P6.1.
- **Envelope typing mismatches** → handlers must return through `success`/`error` consistently; the
  pilot validates that `c.json({success,data})` infers cleanly through `hc`.
- **Hidden call sites** → grep each `lib/api/<domain>` export's usages before deleting its interfaces;
  the per-domain slice migrates all callers before removing the legacy path.

## 7. Out of scope (deferred)

hono v4 upgrade · OpenAPI generation / Swagger publish (P9) · raw-status response shape · dropping
the bare `/api` prefix (P9) · pre-GA i18n · any new endpoints (P6 re-types existing surface only).
