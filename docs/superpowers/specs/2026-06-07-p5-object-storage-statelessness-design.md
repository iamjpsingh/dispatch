# P5 — Object storage (R2/S3) + full statelessness: Design

- **Date:** 2026-06-07 · **Status:** design, pending user review.
- **Parent:** `docs/superpowers/specs/2026-06-06-dispatch-saas-replatform.md` §P5
  ("Uploads/attachments + large recipient payloads off local disk → R2; signed URLs.
  Exit: API containers fully stateless.")

## Goal

Make the API process **fully stateless** (no local-disk user state) and introduce an
S3-compatible **object-storage** layer (MinIO in dev → Cloudflare R2 in prod). Concretely:
parse uploads in memory (no disk), move send-logs to Postgres, and add a `storageService`
whose first consumer persists imported files to object storage with signed-URL download.

## Findings (these reshape the spec)

Inspecting the code changed the plan from "move uploads → R2":

1. **Every uploaded file today is transient.** It's written to disk only so
   `XLSX.readFile(path)` / `readHTMLTemplate(path)` can read it back **within the same
   request**, then it's discarded — contact import (`routes/contacts.ts:294`), send-list +
   HTML template (`services/sendHelpers.ts:181,240`), send upload (`routes/send.ts:334`).
   Nothing is read across requests, and there is **no email-attachment feature**. → The fix
   is **in-memory parsing**, not object storage.
2. **`logService` is the real statefulness blocker.** It persists to `./logs/email-logs.json`,
   is read **synchronously** by ~8 consumers, and is **global — not org-scoped** (every user
   sees global log stats: a pre-existing cross-tenant leak, R9). → move to **Postgres**,
   async, org-scoped.
3. `pluginManager` reads manifests from disk (read-only image content) — left as-is.

## Resolved decisions

1. **SDK = `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`** (NOT `Bun.s3`). Bun.*
   globals are `undefined` under vitest's node env — the same limitation hit in P4.E
   (`Bun.password`) — so `@aws-sdk` keeps the storage layer **net-first testable**. It is
   R2 + MinIO + S3 compatible (`forcePathStyle` for MinIO).
2. **Scope = object storage + logs→PG.** `contacts_json` stays in Postgres
   (large-recipient-payload → R2 is **deferred**, not done here).
3. **First storage consumer = persist import files.** On contact import: parse in memory
   AND store the original CSV/XLSX to S3, record its key on `import_history`, expose a
   signed-URL download.

## Architecture / components

- **`STORAGE` config** (`config/index.ts`): `ENDPOINT` (`S3_ENDPOINT`), `ACCESS_KEY`,
  `SECRET_KEY`, `BUCKET` (`S3_BUCKET`), `REGION` (default `auto` for R2). Already present in
  compose for api+worker.
- **`src/services/storageService.ts`** — lazy `S3Client` (no module singleton built at import;
  constructed on first use from `STORAGE`, `forcePathStyle: true`). API:
  `put(key, body, contentType?): Promise<void>` · `get(key): Promise<Uint8Array | null>` ·
  `getSignedDownloadUrl(key, expiresInSec=900): Promise<string>` · `delete(key): Promise<void>` ·
  `ensureBucket(): Promise<void>` (idempotent create — MinIO starts empty).
- **`fileService`** — `parseExcelBuffer(buf: Uint8Array)` via `XLSX.read(buf, {type:'buffer'})`;
  HTML template read from the buffer (`new TextDecoder().decode(buf)`). **Remove**
  `saveUploadedFile` + the `./uploads` disk write. Update the 4 call sites to pass the buffer.
- **`email_logs` Postgres table** (R4 generated migration): `id`, `org_id` (FK organizations,
  cascade), `email`, `status`, `message` (null), `message_id` (null), `first_name` (null),
  `company` (null), `subject` (null), `created_at`. Indexes `(org_id, created_at)`, `(status)`.
- **`logService` → PG, async, org-scoped:** `addLog(orgId, log)` · `getLogs(orgId, limit?)` ·
  `getStats(orgId)` (PG FILTER counts) · `getLogsAsCSV(orgId)` · `deleteLog(orgId, id)` ·
  `clearLogs(orgId)`. Thread `orgId` from callers: processor (`job.org_id`), batchService/
  emailService send paths, dashboard/report (`getOrgId(c)`), notificationService. `addLog`
  on the send path is fire-and-forget today → make it awaited where cheap, else `void`-safe.
- **`import_history.file_key`** (nullable text, R4 migration) — S3 object key of the stored
  original. Contact import stores under `imports/{orgId}/{importId}/{filename}` and records it.
- **Download route** `GET /contacts/imports/:id/file` → 404 unless the `import_history` row is
  the caller's org; else `storageService.getSignedDownloadUrl(file_key)` → `{ url }`.

## Decomposition (each sub-stage ships green + committed)

- **P5.1** Add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; `STORAGE` config;
  `storageService`. Net: gated integration against MinIO (`RUN_STORAGE_IT=1`, default suite
  skips — mirrors `RUN_QUEUE_IT`): `ensureBucket` → `put` → `get` round-trip →
  `getSignedDownloadUrl` (assert it's a fetchable URL) → `delete`.
- **P5.2** `fileService` in-memory parsing; drop the disk write; update the 4 call sites.
  Nets: parse a CSV buffer + an XLSX buffer → `Contact[]` with no filesystem access.
- **P5.3** `logService` → Postgres. `email_logs` table + migration; async org-scoped service;
  ripple the ~8 consumers async. Nets (PGlite): `addLog`→`getLogs`/`getStats` org-scoped;
  cross-tenant isolation (org A never sees org B's logs/stats); CSV export.
- **P5.4** Import-file persistence: `import_history.file_key` migration; wire `storageService`
  into contact import (parse in-memory + store original + record key); signed-URL download
  route. Nets: PGlite for `file_key` recording + org-scoped download authz (storageService
  mocked); gated MinIO net for the real put+signed-URL.

## Testing strategy (net-first)

- **storageService** needs a real S3 → gated MinIO integration net (`RUN_STORAGE_IT=1`,
  `S3_ENDPOINT=http://localhost:9000`), `ensureBucket` first; default `bun test` skips it.
- **fileService / logService / import authz** → PGlite + in-memory nets, always run (highest
  value, no MinIO needed). `logService` org-scoping is the security-critical coverage.

## Success criteria

- No local-disk **user-state** writes remain (uploads + logs); `grep` for `writeFile`/`./uploads`/
  `./logs` in the request path is clean; the API container is stateless.
- `storageService` put/get/signed-URL/delete work against MinIO; signed URLs are downloadable.
- Send-logs live in Postgres, **org-scoped** (no cross-tenant stats); every log consumer async.
- An imported file is retrievable via a signed URL, owner-scoped.
- `bun typecheck` flat at the 49 baseline; suite green (gated storage nets green with MinIO up);
  app + worker boot on real PG + Valkey + MinIO.

## Out of scope / deferred

- `contacts_json` (large recipient payloads) → R2 — stays in Postgres for now.
- Report/analytics exports → S3 + signed URLs — defer to P6 (changes the client download contract).
- `pluginManager` manifests → object storage (read-only image content, not user state).
- Bucket lifecycle/retention, multi-region, per-tenant buckets.
