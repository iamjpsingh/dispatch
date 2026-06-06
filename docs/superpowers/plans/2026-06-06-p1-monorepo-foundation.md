# P1 — Monorepo + Turborepo Foundation (Stage 1: Restructure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the flat repo (backend at root, `frontend/`, `tracking-worker/`) into a Bun-workspaces + Turborepo monorepo (`apps/api`, `apps/web`, `apps/tracking-worker`, `packages/shared`) with **zero behavior change** — every existing test still passes, all three apps still typecheck/build/boot.

**Architecture:** Pure relocation via `git mv` (preserves history) + workspace wiring. No source logic, no dependency versions, and no runtime behavior change. The existing app keeps running on `bun:sqlite` exactly as before — Postgres/Drizzle is P2, not here. Turborepo orchestrates per-package `dev/build/typecheck/lint/test`. Because Turbo runs each package's scripts with cwd = the package dir, the backend's 21 cwd-relative `./data` paths keep resolving once `src/` lives under `apps/api/` (api runs with cwd `apps/api`).

**Tech Stack:** Bun (runtime + package manager), Bun workspaces, Turborepo 2.x, TypeScript, Vitest, Vite (web), Wrangler (worker).

**Scope note:** This is **Stage 1 of 3** for P1. Stage 2 (dev infra: docker-compose Postgres/Valkey/MinIO/Caddy, multi-stage Dockerfile, Drizzle scaffold, pino, zod-validated env, `/metrics`) and Stage 3 (CI overhaul: split jobs, coverage gate, CodeQL/Trivy/gitleaks/Renovate, changesets + multi-arch release) get their own plan docs after this lands green.

**Preconditions:** On branch `feat/saas-replatform` (already created). Working tree clean except `.claude/settings*`, `.mcp.json`, `PROGRESS.md` (leave untouched). Confirm with `git status --short` before starting.

---

## File Structure (end state of Stage 1)

```
dispatch/
  package.json              # NEW root: private, workspaces ["apps/*","packages/*"], turbo scripts
  turbo.json                # NEW
  tsconfig.base.json        # NEW shared compiler options
  .eslintrc.json            # stays at root (shared base) — unchanged
  .prettierrc               # stays at root — unchanged
  bun.lock                  # single root lockfile after `bun install`
  docs/ , README.md , CLAUDE.md , .gitignore , .env.example   # stay
  apps/
    api/                    # from repo root backend
      package.json          # NEW (@dispatch/api) — backend deps move here
      tsconfig.json         # MOVED + extends ../../tsconfig.base.json
      vitest.config.ts      # MOVED (unchanged contents)
      index.ts              # MOVED (re-exports ./src/app)
      src/ ...              # MOVED
      tests/ ...           # MOVED
      bin/ , scripts/ , public/   # MOVED (api tooling/assets)
      # data/ uploads/ logs/ created at runtime (gitignored), NOT moved
    web/                    # from frontend/  (git mv)
      package.json          # renamed to @dispatch/web; package-lock.json removed
      vite.config.ts, tsconfig*.json, components.json, index.html, src/, tests/, public/
    tracking-worker/        # from tracking-worker/ (git mv)
      package.json          # package-lock.json removed; stray "wrangler" script-key fixed
      wrangler.toml, schema.sql, src/, tests/, tsconfig.json
  packages/
    shared/                 # NEW — shared zod schemas/types (stub now, filled in P2/P6)
      package.json          # @dispatch/shared
      tsconfig.json
      src/index.ts          # stub
```

**Responsibilities:** `apps/api` = Hono backend + worker (unchanged logic). `apps/web` = Vue SPA. `apps/tracking-worker` = CF edge worker. `packages/shared` = cross-app zod schemas/types (empty stub now). Root = workspace + Turbo orchestration only.

---

## Task 1: Root workspace skeleton + shared package

**Files:**
- Create: `package.json.new` content → replaces root `package.json` (root becomes workspace manager)
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

> Note: there is no unit test for scaffolding; the verification gate is `bun install` succeeding and `bunx turbo --version` resolving. We keep the existing app untouched in this task (backend still at root) so nothing breaks yet — Task 2 moves it.

- [ ] **Step 1: Snapshot current green state (safety baseline)**

Run from repo root:
```bash
bun install
bunx vitest run    # expect the existing backend suite green (≈425 passed / 20 skipped)
```
Expected: tests pass. Record the pass count; Task 5 must match it.

- [ ] **Step 2: Add Turborepo as a root dev dependency**

```bash
bun add -d turbo@^2.3.0
```
Expected: `turbo` added to devDependencies; `bunx turbo --version` prints a 2.x version.

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: Create `packages/shared/`**

`packages/shared/package.json`:
```json
{
  "name": "@dispatch/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "bunx tsc --noEmit",
    "lint": "bunx eslint src --ext .ts",
    "build": "echo \"@dispatch/shared: no build step\""
  },
  "dependencies": { "zod": "^4.3.6" },
  "devDependencies": { "typescript": "^5.3.3" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

`packages/shared/src/index.ts`:
```ts
// @dispatch/shared — cross-app zod schemas & inferred types.
// Populated in P2 (data schemas) and P6 (RPC types). Intentionally empty for now.
export {}
```

- [ ] **Step 6: Replace root `package.json` with the workspace manager**

Replace the entire file with:
```json
{
  "name": "dispatch",
  "version": "3.0.0",
  "description": "Open-source bulk email campaign platform",
  "private": true,
  "license": "MIT",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "format": "bunx prettier --write ."
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.4.0",
    "turbo": "^2.3.0",
    "typescript": "^5.3.3"
  },
  "engines": { "bun": ">=1.1.0" }
}
```

> The backend's runtime dependencies are intentionally NOT here anymore — Task 2 puts them in `apps/api/package.json`. After this step `bun install` will warn that `apps/*` are missing; that's expected until Task 2–4 create them. Do not run a full install until Task 5.

- [ ] **Step 7: Commit**

```bash
git add package.json turbo.json tsconfig.base.json packages/shared bun.lock
git commit -m "build(p1): add Bun workspace root + Turborepo + packages/shared stub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Move backend → `apps/api`

**Files:**
- Move: `src/` → `apps/api/src/`, `tests/` → `apps/api/tests/`, `index.ts` → `apps/api/index.ts`, `vitest.config.ts` → `apps/api/vitest.config.ts`, `tsconfig.json` → `apps/api/tsconfig.json`, `bin/` → `apps/api/bin/`, `scripts/` → `apps/api/scripts/`, `public/` → `apps/api/public/`
- Create: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json` (extend base)

- [ ] **Step 1: Create the target dir and move backend files (git mv preserves history)**

```bash
mkdir -p apps/api
git mv src apps/api/src
git mv tests apps/api/tests
git mv index.ts apps/api/index.ts
git mv vitest.config.ts apps/api/vitest.config.ts
git mv tsconfig.json apps/api/tsconfig.json
git mv bin apps/api/bin
git mv scripts apps/api/scripts
git mv public apps/api/public
```
Expected: `git status` shows renames `R src/... -> apps/api/src/...` etc.

- [ ] **Step 2: Create `apps/api/package.json`** (backend deps moved here verbatim from the old root)

```json
{
  "name": "@dispatch/api",
  "version": "3.0.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "dev": "bun run --watch index.ts",
    "start": "bun run index.ts",
    "build": "bun build index.ts --outdir=dist --target=bun",
    "typecheck": "bunx tsc --noEmit",
    "lint": "bunx eslint src --ext .ts",
    "test": "bunx vitest run",
    "test:coverage": "bunx vitest run --coverage",
    "create-admin": "bun run scripts/create-admin.ts",
    "dispatch": "bun run bin/dispatch.ts",
    "reset-all": "rm -f data/dispatch.db data/logs.db data/queue.db data/contacts.db data/campaigns.db data/templates.db data/segments.db data/webhooks.db data/automations.db data/apikeys.db data/analytics.db data/routing.db data/warmup.db data/plugins.db"
  },
  "dependencies": {
    "argon2": "^0.31.2",
    "csv-stringify": "^6.4.4",
    "dotenv": "^16.3.1",
    "hono": "^3.12.0",
    "mjml": "^4.18.0",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^6.9.8",
    "xlsx": "^0.18.5",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/multer": "^1.4.11",
    "@types/nodemailer": "^6.4.14",
    "@vitest/coverage-v8": "^4.0.18",
    "better-sqlite3": "^12.6.2",
    "bun-types": "^1.3.5",
    "typescript": "^5.3.3",
    "vitest": "^3.0.0"
  }
}
```

> `hono` stays at `^3.12.0` here (surgical — no version bumps). The hono v4 upgrade for RPC happens in P6, not now. `shadcn`/`shadcn-vue` are intentionally NOT here (they belong to `apps/web`).

- [ ] **Step 3: Update `apps/api/tsconfig.json` to extend the base**

Replace its contents with:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun-types"],
    "paths": { "@dispatch/shared": ["../../packages/shared/src/index.ts"] }
  },
  "include": ["src/**/*", "index.ts", "scripts/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Verify `apps/api/vitest.config.ts` paths still resolve**

No edit expected — its paths (`tests/**/*.test.ts`, `./tests/helpers/bun-sqlite.ts`, `src/**/*.ts`) are relative to the config file, which moved together with `tests/` and `src/`. Confirm the file is unchanged:
```bash
grep -n "tests/helpers/bun-sqlite.ts" apps/api/vitest.config.ts
```
Expected: the alias line is present.

- [ ] **Step 5: Install workspaces and verify the api in isolation**

```bash
bun install
cd apps/api && bunx tsc --noEmit
```
Expected: typecheck result identical to the pre-move baseline (same count of pre-existing errors, if any — Stage 1 must not ADD errors; pre-existing tsc debt is tracked separately and untouched).

- [ ] **Step 6: Run the api test suite from its new home**

```bash
cd apps/api && bunx vitest run
```
Expected: same pass/skip count as Task 1 Step 1 (≈425 passed / 20 skipped). The `bun:sqlite`→better-sqlite3 alias and `./data` runtime dirs resolve because cwd is now `apps/api`.

- [ ] **Step 7: Boot the api to confirm runtime works**

```bash
cd apps/api && (bun run start &) ; sleep 4 ; curl -fsS http://localhost:5500/health ; pkill -f "bun run index.ts" || true
```
Expected: `/health` returns 200 JSON. (Runtime creates `apps/api/data`, `apps/api/uploads`, `apps/api/logs`.)

- [ ] **Step 8: Commit**

```bash
git add -A apps/api package.json bun.lock
git commit -m "build(p1): move backend to apps/api (git mv, no logic change)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Move frontend → `apps/web`

**Files:**
- Move: `frontend/` → `apps/web/`
- Modify: `apps/web/package.json` (name → `@dispatch/web`, add `typecheck` script, drop npm lockfile)
- Delete: `apps/web/package-lock.json`

- [ ] **Step 1: Move the directory**

```bash
git mv frontend apps/web
git rm --cached apps/web/package-lock.json 2>/dev/null || true
rm -f apps/web/package-lock.json
```
Expected: `apps/web/` exists with `src/`, `vite.config.ts`, `components.json`, etc.; no `package-lock.json`.

- [ ] **Step 2: Update `apps/web/package.json` name + scripts**

Read the existing `apps/web/package.json`, then change ONLY:
- `"name"` → `"@dispatch/web"`
- ensure a `"typecheck"` script exists: `"typecheck": "vue-tsc --noEmit"` (if `build` already runs `vue-tsc`, mirror its invocation)
- ensure `"lint"` and `"test"` scripts exist (keep existing if present)

Do not change dependency versions. Leave `vite.config.ts` proxy targets as-is (they point at `localhost:5500`, still correct).

- [ ] **Step 3: Verify web builds and tests**

```bash
cd apps/web && bun install && bun run build
cd apps/web && bun run test 2>/dev/null || echo "web tests: review (pre-existing frontend test debt is tracked separately, not introduced here)"
```
Expected: `bun run build` produces `dist/`. Frontend test status must equal the pre-move baseline (do not fix pre-existing frontend test debt here — that's tracked).

- [ ] **Step 4: Commit**

```bash
git add -A apps/web
git commit -m "build(p1): move frontend to apps/web (@dispatch/web); drop npm lockfile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Move tracking-worker → `apps/tracking-worker`

**Files:**
- Move: `tracking-worker/` → `apps/tracking-worker/`
- Modify: `apps/tracking-worker/package.json` (fix the stray `"wrangler": "^3.22.1"` that sits inside `scripts` — move it to `devDependencies`; add `typecheck`)
- Delete: `apps/tracking-worker/package-lock.json`

- [ ] **Step 1: Move the directory**

```bash
git mv tracking-worker apps/tracking-worker
git rm --cached apps/tracking-worker/package-lock.json 2>/dev/null || true
rm -f apps/tracking-worker/package-lock.json
```

- [ ] **Step 2: Fix `apps/tracking-worker/package.json`**

Read it, then:
- Remove the bogus `"wrangler": "^3.22.1"` key from `"scripts"` (it's a dependency, not a script).
- Ensure `"wrangler": "^3.22.1"` is in `"devDependencies"`.
- Add `"typecheck": "bunx tsc --noEmit"` to `"scripts"`.
- Confirm `"name": "dispatch-tracker"` stays.

- [ ] **Step 3: Verify worker typechecks and tests**

```bash
cd apps/tracking-worker && bun install && bunx tsc --noEmit
cd apps/tracking-worker && bunx vitest run 2>/dev/null || echo "worker tests: confirm baseline"
```
Expected: typecheck matches baseline; worker tests at baseline. `wrangler.toml` and `schema.sql` are unchanged and still valid.

- [ ] **Step 4: Commit**

```bash
git add -A apps/tracking-worker
git commit -m "build(p1): move tracking-worker to apps/tracking-worker; fix wrangler dep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Root wiring + whole-monorepo green gate

**Files:**
- Modify: `.gitignore` (ensure `data/`, `uploads/`, `logs/`, `dist/`, `.turbo/` ignored at any depth)
- Verify: root `turbo run` orchestrates all packages

- [ ] **Step 1: Update `.gitignore`**

Read `.gitignore`; ensure these patterns exist (add any missing — leading-slash-free patterns match at any depth, so they cover `apps/api/data` etc.):
```
node_modules/
dist/
.turbo/
data/
uploads/
logs/
*.db
*.db-shm
*.db-wal
.env
```

- [ ] **Step 2: Single clean install at root**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install
```
Expected: one root `bun.lock`, workspaces linked, no per-app lockfiles.

- [ ] **Step 3: Turbo typecheck across all packages**

```bash
bunx turbo run typecheck
```
Expected: api + shared + worker typecheck at baseline (no NEW errors vs the pre-restructure snapshot). `web` typecheck (vue-tsc) at baseline.

- [ ] **Step 4: Turbo lint across all packages**

```bash
bunx turbo run lint
```
Expected: matches baseline lint status (pre-existing lint debt unchanged — not introduced by the move).

- [ ] **Step 5: Turbo test across all packages**

```bash
bunx turbo run test
```
Expected: api suite pass/skip count == Task 1 Step 1 baseline (≈425/20). This is the load-bearing assertion that the restructure changed nothing.

- [ ] **Step 6: Turbo build across all packages**

```bash
bunx turbo run build
```
Expected: api `dist/`, web `dist/` produced; shared no-op; worker build (if defined) succeeds.

- [ ] **Step 7: Boot all runnable apps once more**

```bash
(cd apps/api && bun run start &) ; sleep 4 ; curl -fsS http://localhost:5500/health && echo " API OK" ; pkill -f "bun run index.ts" || true
```
Expected: 200 + "API OK".

- [ ] **Step 8: Commit the root wiring**

```bash
git add .gitignore bun.lock
git commit -m "build(p1): finalize monorepo wiring; .gitignore for nested data/dist/.turbo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Update CLAUDE.md command references if needed**

Verify `R5` commands (`bun typecheck`, `bun lint`) work from root (they now proxy to `turbo run`). If `bun typecheck`/`bun lint` aren't defined as root scripts, they already are (Task 1 Step 6). No change expected; confirm:
```bash
bun run typecheck && bun run lint
```

---

## Self-Review (completed by planner)

- **Spec coverage (spec §P1, Stage 1 subset):** monorepo `apps/api|web|tracking-worker` + `packages/shared` ✓ (Tasks 2–4, 1); Bun workspaces + Turborepo ✓ (Task 1); shared tsconfig ✓ (Task 1). **Deferred to P1 Stage 2/3 (explicitly out of scope here):** docker-compose + Dockerfile, Drizzle scaffold, pino, zod-env, `/metrics`, shadcn/Pinia/VueUse additions, CI split + coverage gate + scanners + release. These are listed in the spec and will each get a plan.
- **No-placeholder scan:** all config files have full contents; all commands are concrete with expected output. The only "read then change X/Y" steps (Tasks 3–4 package.json edits) are because those files pre-exist and must be edited surgically — the exact keys to change are enumerated.
- **Behavior-change guard:** no source file contents change; no dependency versions change; the green-suite count is captured in Task 1 and re-asserted in Task 5 as the pass/fail gate.
- **Path-resolution risk addressed:** the 21 cwd-relative `./data` paths keep working because Turbo runs api scripts with cwd `apps/api`; `.gitignore` updated for nested `data/`.

## Risks & rollback
- If `turbo run` cwd assumptions differ, fall back to running per-app scripts directly (`cd apps/api && bun run test`) — already used in Tasks 2–4 as the authoritative checks.
- Every task ends in its own commit; any task can be reverted independently with `git revert`.
- Existing local `data/*.db` at the OLD repo root become orphaned (the api now reads `apps/api/data`). That's fine — they're regenerable dev state, and P2 replaces SQLite entirely. Note for the operator: re-seed via `apps/api` `create-admin` if needed.
