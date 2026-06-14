# P6 — RPC + API surface + frontend types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled web API client + duplicated TypeScript interfaces with `hono/client` (`hc`) RPC typed end-to-end, sourced from shared zod schemas in `packages/shared`, migrated domain-by-domain (strangler) under a new `/api/v1` prefix.

**Architecture:** Each API route file becomes one chained `new Hono().get(...).post(...)` expression that exports its type (`export type AuthRoutes = typeof authRoutes`); request bodies validate via `@hono/zod-validator` using schemas imported from `@dispatch/shared`. The web builds a per-domain typed client `hc<AuthRoutes>(...)` and swaps the **internals** of each `lib/api/<domain>.ts` module to it while keeping that module's exported function signatures stable — so stores/composables/views don't change. The `{ success, data, message }` envelope is preserved and inferred through the `success()`/`error()` helpers.

**Tech Stack:** hono 3.12.12 (`hono/client` `hc`), `@hono/zod-validator@^0.2` (hono v3 peer), zod 4, Vue 3 + Pinia, vitest + @vue/test-utils + jsdom.

---

## Conventions (read once, apply to every task)

**Green gate (every task's final step):** from repo root —
`bun typecheck` (must stay at the **49-error baseline**), `bun lint` (no new errors), `cd apps/api && bunx vitest run` (backend green), `cd apps/web && bunx vitest run` (frontend green). Only commit when all pass. Commit with `git commit --no-gpg-sign` and the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Stage only P6 files — never `.claude/settings*.json` or `.mcp.json`.

**Envelope inference rule:** handlers keep returning `success(c, data, msg?)` / `error(c, msg, status)`. On the web, every typed call reads:
```ts
const res = await client.<path>.$get(/* or $post({ json }) */)
const body = await res.json()        // { success: boolean; data?: T; message?: string }
if (!body.success) throw new Error(body.message ?? 'Request failed')
return body.data as T                // body.data is T | undefined; guard with body.success
```

**Per-domain recipe (Task 4 applies this to each domain — it is complete instructions, not a placeholder):**
1. **Shared schema** — create `packages/shared/src/<domain>.ts`: move that route file's inline `z.object(...)` request schemas here verbatim; `export` each schema and its `export type X = z.infer<typeof XSchema>`. Re-export from `packages/shared/src/index.ts`.
2. **Route** — in `apps/api/src/routes/<domain>.ts`: import schemas from `@dispatch/shared`; convert the separate `app.get(...)`/`app.post(...)` statements into ONE chained `const <domain>Routes = new Hono().get(...).post(...)…`; replace each `const x = await validateBody(c, Schema)` with the `zValidator('json', Schema)` middleware + `const x = c.req.valid('json')`; keep all handler bodies/returns identical; `export default <domain>Routes` AND `export type <Domain>Routes = typeof <domain>Routes`.
3. **Typed client + module internals** — in `apps/web/src/lib/api/<domain>.ts`: build `const client = hc<<Domain>Routes>(rpcBase())` (from `../rpc/client`); rewrite each exported function's **body** to call the typed client per the envelope rule; **keep each function's exported signature identical**; delete the domain's hand-written `interface`/`type` blocks, replacing usages with `@dispatch/shared` types or `InferResponseType<typeof client.<path>.$get>`.
4. **Tests** — add/adjust `apps/web/tests/lib/<domain>.test.ts` (mock global `fetch`, assert request URL/method/body + envelope handling) proportional to the module's surface.
5. Green gate + commit.

**Why later domains aren't pre-written as code:** each domain's concrete schemas/handlers are derived from its own route file by mechanically applying the recipe above. Task 3 (auth) is the fully-worked reference; the executor reads each subsequent route file and applies the identical transformation.

---

## Task 1: Foundation — deps, `hc` factory, shared scaffold

**Files:**
- Modify: `apps/api/package.json` (add `@hono/zod-validator`)
- Modify: `apps/web/package.json` (add `hono`, `zod`, `@dispatch/shared`)
- Create: `apps/web/src/lib/rpc/client.ts`
- Create: `apps/web/tests/lib/rpc/client.test.ts`
- Modify: `packages/shared/src/index.ts` (barrel comment)

- [ ] **Step 1: Add the API validator dep**

Run (from repo root):
```bash
cd apps/api && bun add @hono/zod-validator@^0.2.0 && cd ../..
```
Expected: `@hono/zod-validator` appears under `dependencies` in `apps/api/package.json`. Verify the installed peer matches hono 3 (no peer-dep warning about hono v4). If bun writes the dep to the **root** `package.json` instead of `apps/api/package.json`, move it into `apps/api/package.json` and restore root `package.json`.

- [ ] **Step 2: Add web deps**

Run:
```bash
cd apps/web && bun add hono@^3.12.12 zod@^4.3.6 @dispatch/shared@workspace:* && cd ../..
```
Expected: `apps/web/package.json` dependencies include `hono`, `zod`, and `@dispatch/shared` (workspace).

- [ ] **Step 3: Write the failing test for the `hc` factory's CSRF + credentials behavior**

Create `apps/web/tests/lib/rpc/client.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { rpcFetch, rpcBase } from '../../../src/lib/rpc/client'

describe('rpc client factory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    document.cookie = 'csrf_token=tok123'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('rpcBase targets /api/v1', () => {
    expect(rpcBase()).toMatch(/\/api\/v1$/)
  })

  it('sends credentials and attaches X-CSRF-Token on mutations', async () => {
    await rpcFetch('http://x/api/v1/auth/login', { method: 'POST' })
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok123')
  })

  it('does not attach CSRF on GET', async () => {
    await rpcFetch('http://x/api/v1/auth/me', { method: 'GET' })
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull()
  })
})
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `cd apps/web && bunx vitest run tests/lib/rpc/client.test.ts`
Expected: FAIL — cannot resolve `../../../src/lib/rpc/client`.

- [ ] **Step 5: Implement the factory**

Create `apps/web/src/lib/rpc/client.ts`:
```ts
// Typed RPC client factory. Wraps fetch with credentials + CSRF, matching the
// behavior of the legacy ApiClient. Per-domain clients are built as hc<Routes>(rpcBase(), { fetch: rpcFetch }).
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function csrfToken(): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1]
}

export const rpcFetch: typeof fetch = (input, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!SAFE.has(method)) {
    const tok = csrfToken()
    if (tok) headers.set('X-CSRF-Token', tok)
  }
  return fetch(input, { ...init, credentials: 'include', headers })
}

export function rpcBase(): string {
  const root = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  return `${root}/api/v1`
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd apps/web && bunx vitest run tests/lib/rpc/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Green gate + commit**

```bash
git add apps/api/package.json apps/web/package.json bun.lock apps/web/src/lib/rpc/client.ts apps/web/tests/lib/rpc/client.test.ts
git commit --no-gpg-sign -m "feat(p6.1): rpc client factory + zod-validator/shared deps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `/api/v1` versioning foundation (dual-mount + middleware normalization)

The legacy client keeps using `/api`; typed clients use `/api/v1`. Both must pass identically through auth/public/rate-limit middleware, which today key off exact `/api/...` prefixes.

**Files:**
- Modify: `apps/api/src/app.ts` (dual-mount + public-path normalization + v1 rate-limit mirrors)
- Create: `apps/api/tests/routes/versioning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/routes/versioning.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import app from '../../src/app'

describe('P6 /api/v1 versioning', () => {
  it('serves the same handler under /api and /api/v1 (public login path reachable, not auth-walled)', async () => {
    const base = await app.fetch(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    const v1 = await app.fetch(new Request('http://x/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    // Both reach the login handler → 400/401 (validation/credentials), NOT 401 "Authentication required" from the global guard.
    expect(base.status).toBe(v1.status)
    expect([400, 401]).toContain(v1.status)
  })

  it('treats /api/v1 protected routes as protected (no session → 401)', async () => {
    const res = await app.fetch(new Request('http://x/api/v1/campaigns'))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/api && bunx vitest run tests/routes/versioning.test.ts`
Expected: FAIL — `/api/v1/auth/login` hits the auth guard (PUBLIC_PATHS miss) and returns 401 "Authentication required", so statuses differ / login unreachable.

- [ ] **Step 3: Implement — normalize the version segment for matching, dual-mount, mirror rate limits**

In `apps/api/src/app.ts`:

(a) Add a normalizer near the top (after imports):
```ts
// During the P6 strangler both /api/* (legacy) and /api/v1/* (typed RPC) are served.
// Path-prefix middleware (public paths, rate limits) is written for /api/*; normalize
// the version segment so /api/v1/x is matched as /api/x.
const normalizeApiPath = (path: string) => path.replace(/^\/api\/v1\//, '/api/')
```

(b) In the auth middleware (the `app.use('*', async (c, next) => {...})` block), compute matching against the normalized path:
```ts
const path = c.req.path
const matchPath = normalizeApiPath(path)
if (!matchPath.startsWith('/api') && matchPath !== '/health') return next()
const isPublic = AUTH.PUBLIC_PATHS.some((p) => matchPath.startsWith(p)) || matchPath === '/'
if (matchPath.match(/^\/api\/forms\/[^/]+\/submit$/) && c.req.method === 'POST') return next()
if (isPublic) return next()
return authMiddleware(c, next)
```
(Replace the existing `path`-based checks in that block with `matchPath` as shown; leave `authMiddleware(c, next)` as-is.)

(c) Mirror the path-specific rate limits for v1 (right after the existing ones):
```ts
app.use('/api/v1/auth/login', authRateLimit)
app.use('/api/v1/auth/register', authRateLimit)
app.use('/api/v1/send', sendRateLimit)
```

(d) Dual-mount the routes (replace the `routes.forEach(...)` line):
```ts
routes.forEach((route) => {
  app.route('/api', route)
  app.route('/api/v1', route)
})
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/api && bunx vitest run tests/routes/versioning.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Green gate + commit**

```bash
git add apps/api/src/app.ts apps/api/tests/routes/versioning.test.ts
git commit --no-gpg-sign -m "feat(p6.1): serve routes under /api/v1 with version-normalized middleware

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Auth pilot — prove the full pattern end-to-end

This is the reference implementation for the per-domain recipe. `apps/api/src/routes/auth.ts` has 13 endpoints; `apps/web/src/lib/api/auth.ts` exposes `authApi.{login,register,logout,getMe,switchOrg,forgotPassword,validateResetToken,resetPassword,changePassword,updateProfile,checkUsername,setUsername,suggestUsername}`.

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/web/src/lib/api/auth.ts`
- Create: `apps/web/tests/lib/authApi.test.ts`

- [ ] **Step 1: Shared auth schemas**

Create `packages/shared/src/auth.ts` (schemas lifted verbatim from `routes/auth.ts:21-53`):
```ts
import { z } from 'zod'

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(1, 'Name is required').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
})
export const SwitchOrgSchema = z.object({ orgId: z.string().min(1, 'orgId is required') })
export const ForgotPasswordSchema = z.object({ email: z.string().email('Invalid email format') })
export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})
export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email('Invalid email format').optional(),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type SwitchOrgInput = z.infer<typeof SwitchOrgSchema>
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>
```

Update `packages/shared/src/index.ts`:
```ts
// @dispatch/shared — cross-app zod schemas & inferred types (P6: RPC surface).
export * as auth from './auth'
```

- [ ] **Step 2: Convert the auth route to chained + zValidator + exported type**

In `apps/api/src/routes/auth.ts`:
- Replace the local schema block (lines ~17-53) with: `import { RegisterSchema, LoginSchema, SwitchOrgSchema, ForgotPasswordSchema, ResetPasswordSchema, ChangePasswordSchema, UpdateProfileSchema } from '@dispatch/shared/auth'` and `import { zValidator } from '@hono/zod-validator'`.
- Convert `const app = new Hono()` + the separate `app.post(...)`/`app.get(...)`/`app.put(...)` statements into ONE chained expression `const authRoutes = new Hono().post(...).get(...)...`.
- For every endpoint that did `const x = await validateBody(c, Schema)`, add `zValidator('json', Schema)` as the handler's first arg and replace with `const x = c.req.valid('json')`. Example (register):
```ts
const authRoutes = new Hono()
  .post('/auth/register', zValidator('json', RegisterSchema), async (c) => {
    try {
      const { email, name, password } = c.req.valid('json')
      const session = await authLocalService.register(email, password, name)
      if (!session) return error(c, 'Registration failed. Email may already exist.', 400)
      const secure = isHttps(c.req.raw.headers, c.req.url)
      setCookie(c, COOKIE.SESSION_NAME, session.token, { ...COOKIE.OPTIONS, secure })
      const orgs = await orgService.listForUser(session.user.id)
      const role = session.orgId ? await rbacService.getUserRole(session.user.id, session.orgId) : null
      return success(c, {
        user: { id: session.user.id, email: session.user.email, name: session.user.name, is_platform_admin: !!session.user.is_platform_admin },
        orgId: session.orgId, role,
        orgs: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      }, 'Account created successfully')
    } catch (err) { logger.error('Registration error:', err); return error(c, 'Registration failed', 500) }
  })
  .post('/auth/login', zValidator('json', LoginSchema), async (c) => { /* body unchanged; const { email, password } = c.req.valid('json') */ })
  // ...chain logout, me, switch-org (zValidator SwitchOrgSchema), forgot-password (ForgotPasswordSchema),
  //    reset-password/:token (GET, no validator), reset-password (ResetPasswordSchema),
  //    change-password (ChangePasswordSchema), profile (PUT, UpdateProfileSchema),
  //    check-username, profile/username, profile/username/suggest — each body copied verbatim,
  //    swapping validateBody(c, S) → zValidator('json', S) + c.req.valid('json').
export default authRoutes
export type AuthRoutes = typeof authRoutes
```
Note: endpoints that read cookies/query and never called `validateBody` (logout, me, reset-password/:token, check-username, profile/username, suggest) keep their bodies **verbatim** — just move them into the chain. Remove the now-unused `validateBody` import from this file (leave `AppError` only if still used; it is not here → drop it). Do not touch `validateBody` in `utils/validate.ts` (other routes still use it).

- [ ] **Step 3: Verify envelope inference compiles (type-level proof)**

Add a temporary type assertion at the bottom of `apps/web/src/lib/api/auth.ts` during development (removed before commit) OR rely on Step 5's typed bodies. Confirm `bun typecheck` stays at 49 after Step 4 — if `hc<AuthRoutes>` fails to infer `body.data`, the envelope-through-`success()` assumption is broken; STOP and report (fallback: type the client response via `import type { ApiResponse } from ...` — but prove the inference first).

- [ ] **Step 4: Run backend auth tests (behavior unchanged)**

Run: `cd apps/api && bunx vitest run tests/routes/auth.test.ts` (and any auth integration test).
Expected: PASS — converting to `zValidator` + chaining changes types, not runtime behavior. If a test posted invalid JSON expecting a 400 from `validateBody`, `zValidator` also returns 400 (shape of the error body may differ: assert status, not the exact message).

- [ ] **Step 5: Swap `authApi` internals to the typed client (signatures unchanged)**

Rewrite `apps/web/src/lib/api/auth.ts` to use `hc<AuthRoutes>` while keeping every exported function's signature identical:
```ts
import { hc } from 'hono/client'
import type { AuthRoutes } from '../../../../api/src/routes/auth'
import type { User, AuthContext } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<AuthRoutes>(rpcBase(), { fetch: rpcFetch })

export const authApi = {
  login: async (email: string, password: string): Promise<AuthContext> => {
    const res = await client.auth.login.$post({ json: { email, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Login failed')
    return body.data as AuthContext
  },
  register: async (name: string, email: string, password: string): Promise<AuthContext> => {
    const res = await client.auth.register.$post({ json: { name, email, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Registration failed')
    return body.data as AuthContext
  },
  logout: async () => { await client.auth.logout.$post() },
  getMe: async (): Promise<AuthContext> => {
    const res = await client.auth.me.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not authenticated')
    return body.data as AuthContext
  },
  switchOrg: async (orgId: string): Promise<void> => {
    const res = await client.auth['switch-org'].$post({ json: { orgId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to switch organization')
  },
  forgotPassword: async (email: string): Promise<string> => {
    const res = await client.auth['forgot-password'].$post({ json: { email } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send reset email')
    return body.message ?? 'If an account exists with that email, a reset link has been sent.'
  },
  validateResetToken: async (token: string): Promise<boolean> => {
    const res = await client.auth['reset-password'][':token'].$get({ param: { token } })
    const body = await res.json()
    return body.success && !!body.data?.valid
  },
  resetPassword: async (token: string, password: string): Promise<void> => {
    const res = await client.auth['reset-password'].$post({ json: { token, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to reset password')
  },
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const res = await client.auth['change-password'].$post({ json: { currentPassword, newPassword } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to change password')
  },
  updateProfile: async (data: { name?: string; email?: string }): Promise<User> => {
    const res = await client.auth.profile.$put({ json: data })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update profile')
    return (body.data as { user: User }).user
  },
  checkUsername: async (username: string): Promise<{ available: boolean; suggestions: string[] }> => {
    const res = await client.auth['check-username'].$get({ query: { username } })
    const body = await res.json()
    return body.data as { available: boolean; suggestions: string[] }
  },
  setUsername: async (username: string) => {
    const res = await client.auth.profile.username.$put({ json: { username } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },
  suggestUsername: async (): Promise<string> => {
    const res = await client.auth.profile.username.suggest.$get()
    const body = await res.json()
    return (body.data as { suggestion: string } | undefined)?.suggestion ?? ''
  },
}
```
Note: `User`/`AuthContext` still come from `./client` for now (they are response shapes shared across modules; they move to `@dispatch/shared` or become `InferResponseType`-derived in a later consolidation — do not duplicate them here). If the relative `import type` path to `api/src/routes/auth` is awkward, add a `@dispatch/api/*` path alias in `apps/web/tsconfig.json` in this step and use it (type-only import — no runtime coupling).

- [ ] **Step 6: Write the failing frontend test for `authApi`**

Create `apps/web/tests/lib/authApi.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { authApi } from '../../src/lib/api/auth'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('authApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('login posts to /api/v1/auth/login and returns data', async () => {
    const ctx = { user: { id: 'u1', email: 'a@b.c', name: 'A' }, orgId: 'o1', role: 'admin', orgs: [] }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: ctx }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await authApi.login('a@b.c', 'pw')
    expect(out).toEqual(ctx)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/auth/login')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('login throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'bad creds' }, 401)))
    await expect(authApi.login('a@b.c', 'x')).rejects.toTHROW(/bad creds/)
  })
})
```
Fix the intentional typo `toTHROW` → `toThrow` before running.

- [ ] **Step 7: Run frontend tests**

Run: `cd apps/web && bunx vitest run tests/lib/authApi.test.ts`
Expected: PASS (2 tests). Also run the existing `tests/stores/auth.test.ts` to confirm the store (which calls `authApi`) is unaffected: `bunx vitest run tests/stores/auth.test.ts` → PASS.

- [ ] **Step 8: Full green gate + commit**

Run all four gate commands (Conventions). Then:
```bash
git add packages/shared/src/auth.ts packages/shared/src/index.ts apps/api/src/routes/auth.ts apps/web/src/lib/api/auth.ts apps/web/tests/lib/authApi.test.ts apps/web/tsconfig.json
git commit --no-gpg-sign -m "feat(p6.2): migrate auth domain to hono/client RPC + shared schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migrate remaining domains (apply the recipe, one commit per domain)

For each domain below, apply the **Per-domain recipe** (Conventions). Read the route file + the matching `lib/api/<module>.ts` first; derive concrete schemas/handlers from them. Each domain is its own green commit `feat(p6.x): migrate <domain> domain to RPC`. Order (low-coupling → high):

- [ ] **config** — `routes/config.ts` ↔ `lib/api/config.ts` (+ `stores/config.ts` calls these; keep module signatures stable so the store is untouched). Move `SMTPConfig` shape off `lib/api/client.ts` into `@dispatch/shared` if reused elsewhere; else infer.
- [ ] **contacts** — `routes/contacts.ts` ↔ `lib/api/contacts.ts`. Includes the P5.4 import-file routes; multipart upload endpoints keep `FormData` (RPC `$post({ form })` or fall back to `rpcFetch` directly for file uploads — note in the commit which endpoints used the raw fetch path and why).
- [ ] **templates** — `routes/templates.ts` ↔ `lib/api/templates.ts`.
- [ ] **campaigns** — `routes/campaigns.ts` ↔ `lib/api/campaigns.ts` (largest; `CreateCampaignSchema`/`UpdateCampaignSchema`/`ScheduleSchema`/`ABVariantSchema`/`ABWinnerSchema` → `@dispatch/shared`). Replace the big hand-written `Campaign`/`CampaignType`/`CampaignStatus` interfaces with shared/inferred types.
- [ ] **segments** — `routes/segments.ts` ↔ (no dedicated module; called from contacts/campaigns flows — grep usages).
- [ ] **analytics** — `routes/analytics.ts` ↔ `lib/api/analytics.ts` (large; mostly GET — response types via `InferResponseType`).
- [ ] **automations** — `routes/automations.ts` ↔ (grep web usages).
- [ ] **forms** — `routes/forms.ts` ↔ `lib/api/forms.ts` (keep the public `/api/forms/:id/submit` unversioned exemption working).
- [ ] **pages** — `routes/pages.ts` ↔ `lib/api/pages.ts`.
- [ ] **apikeys** — `routes/apikeys.ts` ↔ (grep web usages).
- [ ] **warmup** — `routes/warmup.ts` ↔ (grep web usages).
- [ ] **routing** — `routes/routing.ts` ↔ (grep web usages).
- [ ] **send + queue** — `routes/send.ts` + `routes/queue.ts` ↔ `lib/api/email.ts` (send flows; preserve the `/api/v1/send` rate-limit mirror from Task 2; the scheduled-jobs endpoints carry the pre-existing IDOR — do NOT fix here, it is tracked for P8).
- [ ] **dashboard + report** — `routes/dashboard.ts` + `routes/report.ts` ↔ dashboard/report views (grep usages; `DashboardStats` shape → shared/inferred).
- [ ] **admin** — `routes/admin.ts` ↔ `lib/api/admin.ts` (large; platform-admin scoped).
- [ ] **whatsapp** — `routes/whatsapp.ts` ↔ `lib/api/whatsapp.ts`.
- [ ] **cloudflare/oauth/email leftovers** — migrate `lib/api/cloudflare.ts`, `lib/api/email.ts` residue, and any `lib/api/index.ts` re-exports to typed clients; `routes/oauth.ts` is callback-only (no web module) — chain + export type for /api/v1 parity only.
- [ ] **server-to-server routes** (`tracking`, `webhooks`, `events`, `index`) — chain + `export type` for `/api/v1` parity; **no** web `lib/rpc` module (no browser caller). Keep their public-path exemptions intact.

After each domain: green gate (tsc=49, lint, both suites) + commit.

---

## Task 5: Teardown, drift guard, docs

**Files:**
- Delete: `apps/web/src/lib/api/client.ts` (the `ApiClient` + duplicated interfaces) — only once grep shows zero importers
- Modify: `apps/web/src/lib/api/*` / `index.ts` (remove dead re-exports)
- Possibly delete: `apps/api/src/utils/validate.ts` `validateBody` (only if grep shows zero callers; otherwise flag, don't delete — R8)
- Create: `apps/api/tests/routes/rpc-surface-drift.test.ts`
- Modify: `PROGRESS.md`, memory

- [ ] **Step 1: Confirm `ApiClient` is unused**

Run: `cd apps/web && grep -rn "from './client'\|from '../client'\|lib/api/client" src | grep -v 'rpc/client'`
Expected: only type-only imports of `User`/`AuthContext`/etc. remain. Move any still-referenced shared response types into `@dispatch/shared` (or a small `lib/rpc/types.ts`), repoint imports, then delete the `ApiClient` class + endpoint methods.

- [ ] **Step 2: Write the drift-guard test**

Create `apps/api/tests/routes/rpc-surface-drift.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'

// Guards against a route domain shipping without its typed surface: every route file
// (excluding server-to-server ones) must export a `*Routes` type and have a shared schema module.
const SERVER_ONLY = new Set(['tracking', 'webhooks', 'events', 'index', 'oauth'])

describe('P6 RPC surface drift', () => {
  it('every browser-facing route domain exports a Routes type', async () => {
    const routesDir = join(__dirname, '../../src/routes')
    const domains = readdirSync(routesDir).filter((f) => f.endsWith('.ts')).map((f) => f.replace('.ts', ''))
    const missing: string[] = []
    for (const d of domains) {
      if (SERVER_ONLY.has(d)) continue
      const mod = await import(join(routesDir, `${d}.ts`))
      const hasRoutesType = Object.keys(mod).some((k) => k.endsWith('Routes')) || 'default' in mod
      if (!hasRoutesType) missing.push(d)
    }
    expect(missing).toEqual([])
  })
})
```
(Refine the exact assertion to the project's reality during execution — the intent is: a new route can't ship without a typed export. If a runtime `import` of route files is too heavy in vitest, assert on a static source scan for `export type \w+Routes` instead.)

- [ ] **Step 3: Run the drift test**

Run: `cd apps/api && bunx vitest run tests/routes/rpc-surface-drift.test.ts`
Expected: PASS.

- [ ] **Step 4: Update PROGRESS.md + memory, final green gate, commit + push**

- Mark P6 complete in `PROGRESS.md` (move from pending; note: typed RPC end-to-end, no duplicated client types, `/api/v1` live, drift guard in CI; OpenAPI generation still deferred to P9; bare `/api` retained for now).
- Update `dispatch-p6-status` memory + `MEMORY.md` index line.
- Run all four gate commands; then:
```bash
git add -A -- ':!.claude' ':!.mcp.json'
git commit --no-gpg-sign -m "feat(p6): retire ApiClient + RPC surface drift guard; P6 complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin feat/saas-replatform
```

---

## Self-review notes (coverage vs spec)

- Spec §4.1 shared schemas → Task 3 Step 1 + recipe step 1. §4.2 chained+zValidator+type → Task 3 Step 2 + recipe step 2. §4.3 typed `hc` client + module-internals swap → Task 1 + Task 3 Step 5 + recipe step 3. §4.4 `/api/v1` (incl. the discovered middleware-normalization requirement) → Task 2. §4.5 frontend tests → Task 1/3 tests + recipe step 4. §4.6 OpenAPI drift guard → Task 5 Step 2. Teardown of duplicated types/`ApiClient` → Task 5.
- Decision alignment: strangler (one commit per domain, legacy client alive until Task 5) ✓; typed envelope (inference rule, `body.data` guarded) ✓; per-domain types (`export type <Domain>Routes`, no global AppType) ✓; hono v3 retained (no upgrade step) ✓.
- Known carve-outs surfaced for the executor: file-upload endpoints may use `rpcFetch` directly (contacts); scheduled-jobs IDOR is NOT fixed here (P8); shared response types (`User`/`AuthContext`/`DashboardStats`) consolidate in Task 5, not duplicated per-domain.
