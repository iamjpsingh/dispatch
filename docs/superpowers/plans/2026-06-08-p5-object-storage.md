# P5 — Object Storage (R2/S3) + Full Statelessness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API process fully stateless (no local-disk user state) by parsing uploads in memory, moving send-logs to org-scoped Postgres, and adding an S3-compatible `storageService` whose first consumer persists imported files with signed-URL download.

**Architecture:** Four green, independently-committed increments. P5.1 adds `storageService` (`@aws-sdk/client-s3`, lazy client, MinIO/R2 compatible). P5.2 replaces the `./uploads` disk round-trip with in-memory buffer parsing. P5.3 moves `logService` from `./logs/email-logs.json` to an org-scoped `email_logs` Postgres table (async) and **deletes** the dead pre-BullMQ sender that the signature change would otherwise break. P5.4 persists the original import file to object storage and exposes an owner-scoped signed-URL download.

**Tech Stack:** TypeScript, Hono, Drizzle ORM + Postgres (bun-sql prod / PGlite tests), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, MinIO (dev) → Cloudflare R2 (prod), `xlsx` (SheetJS), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-p5-object-storage-statelessness-design.md`

**Conventions (verified in repo):**
- R4: schema changes ONLY in `src/db/pg/schema/*` then `bunx drizzle-kit generate` from `apps/api/`; apply with `bun run src/db/pg/migrate.ts`. NEVER hand-write migration SQL. Latest migration is `0008` → the next will be `0009`.
- R5: after each increment, `bun typecheck` must stay at the **49** pre-existing-error baseline and `bun lint` clean before claiming done.
- Service tests inject PGlite: `db = await freshDbMigrated(); __setTestDb(db)` in `beforeEach` (timeout `30_000`), `__setTestDb(null)` in `afterEach`. Mock the logger: `vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))`.
- Gated integration nets follow `RUN_QUEUE_IT`: `const RUN = !!process.env.RUN_STORAGE_IT; describe.skipIf(!RUN)(...)`. Default `bunx vitest run` skips them.
- All commits this branch are unsigned: `git commit --no-gpg-sign` (GPG agent times out). Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run a single test file: `bunx vitest run tests/services/<file>.test.ts` (from `apps/api/`). Full suite: `bunx vitest run`.

---

## File Structure

**P5.1**
- Create: `apps/api/src/services/storageService.ts` — lazy S3 client + put/get/getSignedDownloadUrl/delete/ensureBucket.
- Modify: `apps/api/src/config/index.ts` — add `STORAGE` config block.
- Modify: `apps/api/package.json` — add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- Test: `apps/api/tests/services/storageService.test.ts` — gated MinIO round-trip (`RUN_STORAGE_IT`).

**P5.2**
- Modify: `apps/api/src/services/fileService.ts` — add `parseExcelBuffer` + `readHtmlTemplateBuffer`; remove `saveUploadedFile`, `parseExcelFile`, `readHTMLTemplate`.
- Modify call sites: `apps/api/src/routes/contacts.ts` (import route ~292-301), `apps/api/src/routes/send.ts` (parse-excel ~332-335), `apps/api/src/services/sendHelpers.ts` (`processExcelFile` ~179-182, `processHtmlTemplate` ~238-241).
- Test: `apps/api/tests/services/fileService.test.ts` — add buffer-parse tests (existing `replacePlaceholders` block stays).

**P5.3**
- Create: `apps/api/src/db/pg/schema/logs.ts` — `email_logs` table + `EmailLogRow`.
- Modify: `apps/api/src/db/pg/schema/index.ts` — `export * from './logs'`.
- Create: migration `0009_*.sql` (generated).
- Rewrite: `apps/api/src/services/logService.ts` — async, org-scoped, PG-backed.
- Delete (dead code): `apps/api/src/services/batchService.ts`; `emailService` send methods; `notificationService.getCampaignStats`; orphaned types `BatchJob`/`BatchStatusInfo`.
- Modify: `apps/api/src/routes/send.ts` (drop `batchService` import), `apps/api/src/services/emailService.ts`, `apps/api/src/services/notificationService.ts`, `apps/api/src/types/index.ts`, `apps/api/tests/services/emailService.test.ts`, `apps/api/tests/services/notificationService.test.ts`.
- Ripple consumers: `apps/api/src/services/queue/processor.ts`, `apps/api/src/routes/report.ts`, `apps/api/src/routes/dashboard.ts`.
- Test: `apps/api/tests/services/logService.test.ts` — org-scoped CRUD + cross-tenant isolation.

**P5.4**
- Modify: `apps/api/src/db/pg/schema/contacts.ts` — `import_history.file_key` (nullable text).
- Create: migration `0010_*.sql` (generated).
- Modify: `apps/api/src/services/contactService.ts` — `recordImport` accepts `fileKey`; add `getImport(orgId, id)`.
- Modify: `apps/api/src/routes/contacts.ts` — store original to storage on import; add `GET /contacts/imports/:id/file`.
- Test: `apps/api/tests/services/importFile.test.ts` — PGlite `file_key` recording + org-scoped download authz (storageService mocked).

---

## P5.1 — storageService + STORAGE config

### Task 1: Add the AWS S3 SDK dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install the two packages (writes them into `apps/api/package.json`)**

Run from `apps/api/`:
```bash
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```
Expected: both appear under `dependencies` in `apps/api/package.json`; `bun.lock` updates.

- [ ] **Step 2: Verify the install resolves**

Run: `bun typecheck`
Expected: still at the 49-error baseline (no new errors from the added deps).

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json ../../bun.lock
git commit --no-gpg-sign -m "build(p5.1): add @aws-sdk/client-s3 + s3-request-presigner"
```

### Task 2: Add the STORAGE config block

**Files:**
- Modify: `apps/api/src/config/index.ts` (mirror the `REDIS` block at lines 24-27)

- [ ] **Step 1: Add the config block**

After the existing `REDIS` block in `apps/api/src/config/index.ts`, add:
```typescript
// Object storage (S3 / MinIO dev → Cloudflare R2 prod). Env names match docker-compose.
export const STORAGE = {
  ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
  ACCESS_KEY: process.env.S3_ACCESS_KEY || 'dispatch',
  SECRET_KEY: process.env.S3_SECRET_KEY || 'dispatch-secret',
  BUCKET: process.env.S3_BUCKET || 'dispatch',
  REGION: process.env.S3_REGION || 'auto',
} as const
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun typecheck`
Expected: 49-error baseline unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/config/index.ts
git commit --no-gpg-sign -m "feat(p5.1): STORAGE config block (S3/MinIO/R2)"
```

### Task 3: Implement storageService

**Files:**
- Create: `apps/api/src/services/storageService.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/services/storageService.ts`:
```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { STORAGE } from '../config'
import { logger } from '../utils/logger'

// Lazy singleton — the client is built on first use (never at import), so the API
// process boots without an S3 round-trip and tests can run without MinIO.
let _client: S3Client | null = null

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: STORAGE.ENDPOINT,
      region: STORAGE.REGION,
      credentials: { accessKeyId: STORAGE.ACCESS_KEY, secretAccessKey: STORAGE.SECRET_KEY },
      forcePathStyle: true, // required for MinIO; harmless for R2
    })
  }
  return _client
}

export const storageService = {
  /** Upload bytes under `key`. Overwrites any existing object at that key. */
  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await client().send(
      new PutObjectCommand({ Bucket: STORAGE.BUCKET, Key: key, Body: body, ContentType: contentType })
    )
  },

  /** Fetch bytes at `key`, or null if the object does not exist. */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await client().send(new GetObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }))
      if (!res.Body) return null
      return await res.Body.transformToByteArray()
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'NoSuchKey' || name === 'NotFound') return null
      throw err
    }
  },

  /** A time-limited GET URL for `key` (default 15 min). */
  async getSignedDownloadUrl(key: string, expiresInSec = 900): Promise<string> {
    return getSignedUrl(client(), new GetObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }), {
      expiresIn: expiresInSec,
    })
  },

  /** Delete the object at `key` (no error if it was already absent). */
  async delete(key: string): Promise<void> {
    await client().send(new DeleteObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }))
  },

  /** Idempotently ensure the configured bucket exists (MinIO starts empty). */
  async ensureBucket(): Promise<void> {
    try {
      await client().send(new HeadBucketCommand({ Bucket: STORAGE.BUCKET }))
    } catch {
      try {
        await client().send(new CreateBucketCommand({ Bucket: STORAGE.BUCKET }))
      } catch (err) {
        const name = (err as { name?: string }).name
        // Concurrent creation / already-owned is fine.
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
          logger.error('ensureBucket failed:', err)
          throw err
        }
      }
    }
  },
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun typecheck`
Expected: 49-error baseline unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/storageService.ts
git commit --no-gpg-sign -m "feat(p5.1): storageService (lazy S3 client, put/get/signed-url/delete/ensureBucket)"
```

### Task 4: Gated MinIO integration net

**Files:**
- Create: `apps/api/tests/services/storageService.test.ts`

- [ ] **Step 1: Write the gated round-trip test**

Create `apps/api/tests/services/storageService.test.ts`:
```typescript
// P5.1 net — storageService against a real S3 (MinIO). GATED behind RUN_STORAGE_IT=1
// (requires MinIO reachable on S3_ENDPOINT / localhost:9000). Default `bun test` skips it.
// Run with: RUN_STORAGE_IT=1 bunx vitest run tests/services/storageService.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { storageService } from '../../src/services/storageService'

const RUN = !!process.env.RUN_STORAGE_IT

describe.skipIf(!RUN)('P5.1 — storageService (MinIO)', () => {
  beforeAll(async () => {
    await storageService.ensureBucket()
  }, 30_000)

  it('put → get round-trips bytes', async () => {
    const key = `test/p5-${Date.now()}.txt`
    const body = new TextEncoder().encode('hello dispatch')
    await storageService.put(key, body, 'text/plain')

    const got = await storageService.get(key)
    expect(got).not.toBeNull()
    expect(new TextDecoder().decode(got!)).toBe('hello dispatch')

    await storageService.delete(key)
  })

  it('get returns null for a missing key', async () => {
    expect(await storageService.get(`test/missing-${Date.now()}`)).toBeNull()
  })

  it('getSignedDownloadUrl yields a fetchable URL', async () => {
    const key = `test/signed-${Date.now()}.txt`
    await storageService.put(key, new TextEncoder().encode('signed-body'), 'text/plain')

    const url = await storageService.getSignedDownloadUrl(key, 60)
    expect(url).toMatch(/^https?:\/\//)
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('signed-body')

    await storageService.delete(key)
  })

  it('delete removes the object', async () => {
    const key = `test/del-${Date.now()}.txt`
    await storageService.put(key, new TextEncoder().encode('x'))
    await storageService.delete(key)
    expect(await storageService.get(key)).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm it SKIPS by default**

Run: `bunx vitest run tests/services/storageService.test.ts`
Expected: the describe is skipped (0 failures), suite green without MinIO.

- [ ] **Step 3: Run it green against MinIO (requires `docker compose up minio`)**

Run: `RUN_STORAGE_IT=1 bunx vitest run tests/services/storageService.test.ts`
Expected: 4 passing. (If MinIO isn't up, start it: `docker compose up -d minio`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/services/storageService.test.ts
git commit --no-gpg-sign -m "test(p5.1): gated MinIO round-trip for storageService (RUN_STORAGE_IT)"
```

---

## P5.2 — In-memory upload parsing

### Task 5: fileService buffer parsing

**Files:**
- Modify: `apps/api/src/services/fileService.ts`
- Test: `apps/api/tests/services/fileService.test.ts` (existing `replacePlaceholders` block untouched)

- [ ] **Step 1: Write failing buffer-parse tests**

Add to `apps/api/tests/services/fileService.test.ts` (a new `describe`, after the existing `replacePlaceholders` block). It imports `xlsx` to build an in-memory workbook — no filesystem:
```typescript
import * as XLSX from 'xlsx'
// (add to existing imports at top if not present)

describe('FileService.parseExcelBuffer', () => {
  it('parses a CSV buffer into Contact[] with no filesystem access', async () => {
    const csv = 'Email,FirstName,Company\nalice@test.com,Alice,Acme\nbob@test.com,Bob,Corp\n'
    const buf = new TextEncoder().encode(csv)
    const contacts = await FileService.parseExcelBuffer(buf)
    expect(contacts).toHaveLength(2)
    expect(contacts[0].Email).toBe('alice@test.com')
    expect(contacts[0].FirstName).toBe('Alice')
    expect(contacts[1].Company).toBe('Corp')
  })

  it('parses an XLSX buffer into Contact[]', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email', 'FirstName'],
      ['carol@test.com', 'Carol'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    const contacts = await FileService.parseExcelBuffer(buf)
    expect(contacts).toHaveLength(1)
    expect(contacts[0].Email).toBe('carol@test.com')
    expect(contacts[0].FirstName).toBe('Carol')
  })

  it('skips rows with invalid emails', async () => {
    const csv = 'Email,FirstName\nnot-an-email,Bad\ngood@test.com,Good\n'
    const contacts = await FileService.parseExcelBuffer(new TextEncoder().encode(csv))
    expect(contacts).toHaveLength(1)
    expect(contacts[0].Email).toBe('good@test.com')
  })
})

describe('FileService.readHtmlTemplateBuffer', () => {
  it('decodes a UTF-8 buffer to a string', () => {
    const html = '<p>Hello {{FirstName}}</p>'
    expect(FileService.readHtmlTemplateBuffer(new TextEncoder().encode(html))).toBe(html)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `bunx vitest run tests/services/fileService.test.ts`
Expected: FAIL — `parseExcelBuffer`/`readHtmlTemplateBuffer` are not functions yet.

- [ ] **Step 3: Implement buffer parsing; remove the disk methods**

In `apps/api/src/services/fileService.ts`:

(a) Replace the imports at the top:
```typescript
import * as XLSX from 'xlsx'
import { logger } from '../utils/logger'
import { isValidEmail } from '../utils/validation'
import type { Contact } from '../types/index'
```
(removes `writeFile, readFile, mkdir` from `fs/promises` and `existsSync` from `fs` — no longer used).

(b) Replace the `parseExcelFile` method (lines 9-102) with `parseExcelBuffer` — identical logic, but read from the buffer instead of disk (only the first three lines change; the header/email/contact loop is unchanged):
```typescript
  static async parseExcelBuffer(buffer: Uint8Array): Promise<Contact[]> {
    try {
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]

      if (!sheetName) {
        throw new Error('No sheets found in Excel file')
      }

      const worksheet = workbook.Sheets[sheetName]

      // Convert to JSON with header option
      const data = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
      }) as any[][]

      if (data.length < 2) {
        throw new Error('Excel file must have at least a header row and one data row')
      }

      // Get headers from first row
      const headers = data[0]
      logger.debug('Excel headers:', headers)

      // Find Email column (case insensitive)
      const emailColumnIndex = headers.findIndex(
        (header: string) => typeof header === 'string' && header.toLowerCase().includes('email')
      )

      if (emailColumnIndex === -1) {
        throw new Error('No Email column found. Please ensure your Excel file has an "Email" column.')
      }

      // Convert data rows to contact objects
      const contacts: Contact[] = []

      for (let i = 1; i < data.length; i++) {
        const row = data[i]

        if (!row || row.length === 0) {
          continue // Skip empty rows
        }

        const contact: Contact = {
          Email: '',
        }

        // Map each column to contact properties
        headers.forEach((header: string, index: number) => {
          if (typeof header === 'string' && header.trim() !== '') {
            const cleanHeader = header.trim()
            const value = row[index] ? String(row[index]).trim() : ''

            // Store with ORIGINAL column name exactly as in Excel
            contact[cleanHeader] = value

            // Set Email field for validation (find any email-like column)
            if (cleanHeader.toLowerCase().includes('email') && value.includes('@')) {
              contact.Email = value
            }
          }
        })

        // Only include contacts with valid email addresses
        if (contact.Email && isValidEmail(contact.Email)) {
          contacts.push(contact)
        } else {
          logger.debug(`Skipping row ${i + 1}: Invalid or missing email (${contact.Email})`)
        }
      }

      logger.debug(`Successfully parsed ${contacts.length} valid contacts`)

      if (contacts.length === 0) {
        throw new Error('No valid email addresses found in the Excel file')
      }

      return contacts
    } catch (error) {
      logger.error('Excel parsing error:', error)
      if (error instanceof Error) {
        throw new Error(`Failed to parse Excel file: ${error.message}`)
      } else {
        throw new Error('Failed to parse Excel file: Unknown error')
      }
    }
  }
```

(c) Delete the `saveUploadedFile` method (old lines 104-120) entirely.

(d) Replace `readHTMLTemplate` (old lines 122-135) with a synchronous buffer decoder:
```typescript
  static readHtmlTemplateBuffer(buffer: Uint8Array): string {
    return new TextDecoder('utf-8').decode(buffer)
  }
```

(e) Leave `replacePlaceholders`, `processDynamicBlocks`, `evaluateFieldCondition` unchanged.

- [ ] **Step 4: Run to confirm green**

Run: `bunx vitest run tests/services/fileService.test.ts`
Expected: all pass (new buffer tests + existing `replacePlaceholders` tests).

- [ ] **Step 5: Typecheck (expect the 4 call sites to break — that's the next tasks)**

Run: `bun typecheck`
Expected: 4 NEW errors at the call sites referencing `parseExcelFile`/`saveUploadedFile`/`readHTMLTemplate`. (Fixed in Tasks 6-8; do NOT commit until typecheck is back to baseline. Hold this task's `git add` for Step in Task 8.)

### Task 6: Update the contact-import call site

**Files:**
- Modify: `apps/api/src/routes/contacts.ts` (lines ~292-301)

- [ ] **Step 1: Replace the disk round-trip with in-memory parsing**

In `apps/api/src/routes/contacts.ts`, replace lines 292-301:
```typescript
  // Parse file
  const arrayBuffer = await file.arrayBuffer()
  const filename = `import_${Date.now()}_${file.name}`
  const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)

  let rows: Record<string, string>[]
  const ext = file.name.split('.').pop()?.toLowerCase()
  const format = ext === 'csv' ? 'csv' : 'excel'

  try {
    const contacts = await FileService.parseExcelFile(filePath)
```
with:
```typescript
  // Parse file in memory (no disk write)
  const fileBytes = new Uint8Array(await file.arrayBuffer())

  let rows: Record<string, string>[]
  const ext = file.name.split('.').pop()?.toLowerCase()
  const format = ext === 'csv' ? 'csv' : 'excel'

  try {
    const contacts = await FileService.parseExcelBuffer(fileBytes)
```
(The `fileBytes` const is reused by P5.4. Leave the rest of the `try` block and the import logic unchanged.)

- [ ] **Step 2: Typecheck (contacts.ts error clears)**

Run: `bun typecheck`
Expected: 3 NEW errors remaining (send.ts + sendHelpers ×2).

### Task 7: Update the send parse-excel call site

**Files:**
- Modify: `apps/api/src/routes/send.ts` (lines ~332-335)

- [ ] **Step 1: Replace with in-memory parsing**

In `apps/api/src/routes/send.ts`, replace lines 332-335:
```typescript
    const arrayBuffer = await excelFile.arrayBuffer()
    const filename = `temp_${Date.now()}_${excelFile.name}`
    const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)
    const contacts = await FileService.parseExcelFile(filePath)
```
with:
```typescript
    const contacts = await FileService.parseExcelBuffer(new Uint8Array(await excelFile.arrayBuffer()))
```

- [ ] **Step 2: Typecheck**

Run: `bun typecheck`
Expected: 2 NEW errors remaining (sendHelpers ×2).

### Task 8: Update the sendHelpers call sites

**Files:**
- Modify: `apps/api/src/services/sendHelpers.ts` (`processExcelFile` ~179-182, `processHtmlTemplate` ~238-241)

- [ ] **Step 1: Replace `processExcelFile`'s disk round-trip**

In `apps/api/src/services/sendHelpers.ts`, in `processExcelFile`, replace lines 179-182:
```typescript
    const arrayBuffer = await file.arrayBuffer()
    const filename = `${Date.now()}_${file.name}`
    const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)
    const allContacts = await FileService.parseExcelFile(filePath)
```
with:
```typescript
    const allContacts = await FileService.parseExcelBuffer(new Uint8Array(await file.arrayBuffer()))
```

- [ ] **Step 2: Replace `processHtmlTemplate`'s disk round-trip**

In `processHtmlTemplate`, replace lines 238-241:
```typescript
      const arrayBuffer = await templateFile.arrayBuffer()
      const filename = `${Date.now()}_${templateFile.name}`
      const filePath = await FileService.saveUploadedFile(new Uint8Array(arrayBuffer), filename)
      const content = await FileService.readHTMLTemplate(filePath)
```
with:
```typescript
      const content = FileService.readHtmlTemplateBuffer(new Uint8Array(await templateFile.arrayBuffer()))
```

- [ ] **Step 3: Typecheck back to baseline**

Run: `bun typecheck`
Expected: back to 49 (all 4 call-site errors cleared).

- [ ] **Step 4: Full suite + lint**

Run: `bunx vitest run tests/services/fileService.test.ts && bun lint`
Expected: fileService tests green; lint clean.

- [ ] **Step 5: Confirm no upload disk paths remain**

Run: `grep -rn "saveUploadedFile\|parseExcelFile\|readHTMLTemplate\|./uploads" apps/api/src`
Expected: no matches (the `./uploads` directory write is fully gone).

- [ ] **Step 6: Commit P5.2 as one green change**

```bash
git add apps/api/src/services/fileService.ts apps/api/src/routes/contacts.ts apps/api/src/routes/send.ts apps/api/src/services/sendHelpers.ts apps/api/tests/services/fileService.test.ts
git commit --no-gpg-sign -m "feat(p5.2): parse uploads in memory; drop ./uploads disk round-trip"
```

---

## P5.3 — logService → Postgres (org-scoped) + delete dead sender

### Task 9: email_logs schema + migration

**Files:**
- Create: `apps/api/src/db/pg/schema/logs.ts`
- Modify: `apps/api/src/db/pg/schema/index.ts`
- Create (generated): `apps/api/src/db/pg/migrations/0009_*.sql`

- [ ] **Step 1: Create the schema file**

Create `apps/api/src/db/pg/schema/logs.ts` (follows the per-file `ts` helper + `organizations` FK convention used across the schema dir):
```typescript
// Send-log domain (P5.3). Replaces the global ./logs/email-logs.json file store with
// an org-scoped Postgres table — every read/write is keyed by org_id (R9). Column keys
// snake_case; created_at is an ISO string (mode:'string') to match the rest of the schema.
import { pgTable, text, index } from 'drizzle-orm/pg-core'
import { timestamp } from 'drizzle-orm/pg-core'
import { organizations } from './identity'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const email_logs = pgTable(
  'email_logs',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    status: text('status').notNull(),
    message: text('message'),
    message_id: text('message_id'),
    first_name: text('first_name'),
    company: text('company'),
    subject: text('subject'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_el_org_created').on(t.org_id, t.created_at), index('idx_el_status').on(t.status)]
)

export type EmailLogRow = typeof email_logs.$inferSelect
```

- [ ] **Step 2: Export it from the schema barrel**

In `apps/api/src/db/pg/schema/index.ts`, add alongside the other `export *` lines:
```typescript
export * from './logs'
```

- [ ] **Step 3: Generate the migration (R4 — never hand-write)**

Run from `apps/api/`: `bunx drizzle-kit generate`
Expected: a new `src/db/pg/migrations/0009_*.sql` creating `email_logs` with the two indexes, plus an updated `meta/0009_snapshot.json`.

- [ ] **Step 4: Inspect + apply the migration to dev Postgres**

Run: `grep -A2 "email_logs" src/db/pg/migrations/0009_*.sql` (confirm it's `CREATE TABLE "email_logs"` + indexes only — no unrelated drift).
Then apply: `bun run src/db/pg/migrate.ts`
Expected: migration applies cleanly (Postgres up on localhost:5432).

- [ ] **Step 5: Typecheck + commit the schema/migration**

Run: `bun typecheck` (49 baseline).
```bash
git add apps/api/src/db/pg/schema/logs.ts apps/api/src/db/pg/schema/index.ts apps/api/src/db/pg/migrations/
git commit --no-gpg-sign -m "feat(p5.3): email_logs Postgres table + migration 0009 (org-scoped)"
```

### Task 10: Rewrite logService (async, org-scoped, PG-backed)

**Files:**
- Rewrite: `apps/api/src/services/logService.ts`
- Test: `apps/api/tests/services/logService.test.ts`

- [ ] **Step 1: Write the failing org-scoped test**

Create `apps/api/tests/services/logService.test.ts`:
```typescript
// P5.3 net — logService on Postgres (async, org-scoped). The old ./logs JSON file is gone;
// every read/write is keyed by org_id (R9). Cross-tenant isolation is the security-critical case.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb } from '../../src/db/pg/client'
import { getDb } from '../../src/db/pg/client'
import { organizations } from '../../src/db/pg/schema'
import { logService } from '../../src/services/logService'
import type { EmailLog } from '../../src/types/index'

const makeLog = (over: Partial<EmailLog> = {}): EmailLog => ({
  id: `log_${Math.random().toString(36).slice(2)}`,
  email: 'a@test.com',
  status: 'Sent',
  timestamp: '2026-06-08T00:00:00.000Z',
  ...over,
})

async function seedOrg(id: string) {
  // email_logs.org_id is a FK → organizations. Insert the parent rows the test needs.
  await getDb().insert(organizations).values({ id, name: id }).onConflictDoNothing()
}

describe('P5.3 — logService (Postgres, org-scoped)', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seedOrg('org-a')
    await seedOrg('org-b')
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('addLog then getLogs returns the org’s logs', async () => {
    await logService.addLog('org-a', makeLog({ email: 'x@a.com', status: 'Sent' }))
    const logs = await logService.getLogs('org-a')
    expect(logs).toHaveLength(1)
    expect(logs[0].email).toBe('x@a.com')
    expect(logs[0].status).toBe('Sent')
  })

  it('getStats counts by status for the org', async () => {
    await logService.addLog('org-a', makeLog({ status: 'Sent' }))
    await logService.addLog('org-a', makeLog({ status: 'Failed' }))
    await logService.addLog('org-a', makeLog({ status: 'Error' }))
    const stats = await logService.getStats('org-a')
    expect(stats).toEqual({ total: 3, sent: 1, failed: 1, errors: 1 })
  })

  it('isolates tenants — org A never sees org B logs or stats', async () => {
    await logService.addLog('org-a', makeLog({ email: 'a@a.com' }))
    await logService.addLog('org-b', makeLog({ email: 'b@b.com' }))

    const aLogs = await logService.getLogs('org-a')
    expect(aLogs).toHaveLength(1)
    expect(aLogs[0].email).toBe('a@a.com')

    expect((await logService.getStats('org-b')).total).toBe(1)
  })

  it('deleteLog only deletes within the org', async () => {
    await logService.addLog('org-a', makeLog({ id: 'shared-id' }))
    await logService.addLog('org-b', makeLog({ id: 'shared-id' }))
    await logService.deleteLog('org-a', 'shared-id')
    expect(await logService.getLogs('org-a')).toHaveLength(0)
    expect(await logService.getLogs('org-b')).toHaveLength(1) // org B untouched
  })

  it('getLogsAsCSV returns a header + the org’s rows', async () => {
    await logService.addLog('org-a', makeLog({ email: 'csv@a.com', status: 'Sent' }))
    const csv = await logService.getLogsAsCSV('org-a')
    expect(csv).toContain('email')
    expect(csv).toContain('csv@a.com')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `bunx vitest run tests/services/logService.test.ts`
Expected: FAIL — `logService.addLog` is sync/global and rejects the `(orgId, log)` shape.

- [ ] **Step 3: Rewrite the service**

Replace the entire contents of `apps/api/src/services/logService.ts`:
```typescript
import { eq, and, desc, sql } from 'drizzle-orm'
import { stringify } from 'csv-stringify/sync'
import { getDb } from '../db/pg/client'
import { email_logs, type EmailLogRow } from '../db/pg/schema'
import { logger } from '../utils/logger'
import type { EmailLog } from '../types/index'

function toEmailLog(r: EmailLogRow): EmailLog {
  return {
    id: r.id,
    email: r.email,
    status: r.status as EmailLog['status'],
    message: r.message ?? undefined,
    timestamp: r.created_at,
    messageId: r.message_id ?? undefined,
    firstName: r.first_name ?? undefined,
    company: r.company ?? undefined,
    subject: r.subject ?? undefined,
  }
}

class LogService {
  /** Append a send-log row, scoped to an org (R9). */
  async addLog(orgId: string, log: EmailLog): Promise<void> {
    try {
      await getDb().insert(email_logs).values({
        id: log.id,
        org_id: orgId,
        email: log.email,
        status: log.status,
        message: log.message ?? null,
        message_id: log.messageId ?? null,
        first_name: log.firstName ?? null,
        company: log.company ?? null,
        subject: log.subject ?? null,
        ...(log.timestamp ? { created_at: log.timestamp } : {}),
      })
    } catch (error) {
      logger.error('Error writing email log:', error)
    }
  }

  async getLogs(orgId: string, limit = 1000): Promise<EmailLog[]> {
    const rows = await getDb()
      .select()
      .from(email_logs)
      .where(eq(email_logs.org_id, orgId))
      .orderBy(desc(email_logs.created_at))
      .limit(limit)
    return rows.map(toEmailLog)
  }

  async getStats(orgId: string): Promise<{ total: number; sent: number; failed: number; errors: number }> {
    const [row] = await getDb()
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`(count(*) filter (where ${email_logs.status} = 'Sent'))::int`,
        failed: sql<number>`(count(*) filter (where ${email_logs.status} = 'Failed'))::int`,
        errors: sql<number>`(count(*) filter (where ${email_logs.status} = 'Error'))::int`,
      })
      .from(email_logs)
      .where(eq(email_logs.org_id, orgId))
    return row ?? { total: 0, sent: 0, failed: 0, errors: 0 }
  }

  async getLogsAsCSV(orgId: string): Promise<string> {
    const logs = await this.getLogs(orgId)
    return stringify(logs, {
      header: true,
      columns: ['id', 'email', 'status', 'message', 'timestamp', 'messageId', 'firstName', 'company', 'subject'],
    })
  }

  async deleteLog(orgId: string, id: string): Promise<void> {
    await getDb().delete(email_logs).where(and(eq(email_logs.org_id, orgId), eq(email_logs.id, id)))
  }

  async clearLogs(orgId: string): Promise<void> {
    await getDb().delete(email_logs).where(eq(email_logs.org_id, orgId))
  }
}

export const logService = new LogService()
```
(Note: `getLogsAsJSON` is dropped — grep confirms it has no callers. Verify in Step 4.)

- [ ] **Step 4: Confirm getLogsAsJSON had no callers**

Run: `grep -rn "getLogsAsJSON" apps/api/src`
Expected: no matches (safe to drop).

- [ ] **Step 5: Run the net green**

Run: `bunx vitest run tests/services/logService.test.ts`
Expected: all 5 pass.

- [ ] **Step 6: Typecheck (consumers + dead callers now break — handled in Tasks 11-13)**

Run: `bun typecheck`
Expected: NEW errors in `processor.ts`, `report.ts`, `dashboard.ts` (live consumers) and `batchService.ts`, `emailService.ts`, `notificationService.ts` (dead callers). Do NOT commit yet — Tasks 11-13 bring it to baseline.

### Task 11: Delete the dead pre-BullMQ sender

> These three consumers have **zero callers** (verified) — superseded by the BullMQ `processor.ts` in P4. The logService signature change forces the issue; per the user's decision we delete them rather than thread a fake orgId.

**Files:**
- Delete: `apps/api/src/services/batchService.ts`
- Modify: `apps/api/src/routes/send.ts`, `apps/api/src/services/emailService.ts`, `apps/api/src/services/notificationService.ts`, `apps/api/src/types/index.ts`
- Modify tests: `apps/api/tests/services/emailService.test.ts`, `apps/api/tests/services/notificationService.test.ts`

- [ ] **Step 1: Delete batchService + its orphaned import**

```bash
git rm apps/api/src/services/batchService.ts
```
In `apps/api/src/routes/send.ts`, remove line 7: `import { batchService } from '../services/batchService'` (no method of it is called — only enqueue is used).

- [ ] **Step 2: Strip emailService to just `testConnection`**

Replace the entire contents of `apps/api/src/services/emailService.ts`:
```typescript
import nodemailer from 'nodemailer'
import { logger } from '../utils/logger'
import type { EmailConfig } from '../types/index'

export class EmailService {
  async testConnection(config: EmailConfig): Promise<boolean> {
    try {
      const testTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
      })

      await testTransporter.verify()
      return true
    } catch (error) {
      logger.error('SMTP connection test failed:', error)
      return false
    }
  }
}

export const emailService = new EmailService()
```
(Removes `createTransport`, `sendSingleEmail`, `sendBulkEmails`, `sendBulkCompletionNotification`, the `transporter` field, and the now-unused imports `logService`/`FileService`/`d1Service`/`TRACKING`/`htmlToText`/`Contact`/`EmailJob`. `testConnection` stays live for `config.ts` + `sendHelpers.ts`.)

- [ ] **Step 3: Reduce emailService.test.ts to the testConnection block**

Replace the entire contents of `apps/api/tests/services/emailService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('nodemailer', () => {
  const verifyMock = vi.fn().mockResolvedValue(true)
  return {
    default: {
      createTransport: vi.fn(() => ({ sendMail: vi.fn(), verify: verifyMock })),
    },
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), startup: vi.fn() },
}))

import nodemailer from 'nodemailer'
import { EmailService } from '../../src/services/emailService'
import type { EmailConfig } from '../../src/types/index'

describe('EmailService', () => {
  let emailService: EmailService

  const testConfig: EmailConfig = {
    host: 'smtp.test.com',
    port: 587,
    secure: false,
    auth: { user: 'user@test.com', pass: 'password' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    emailService = new EmailService()
  })

  describe('testConnection', () => {
    it('returns true on successful verification', async () => {
      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(true)
    })

    it('returns false on verification failure', async () => {
      ;(nodemailer.createTransport as any).mockReturnValueOnce({
        sendMail: vi.fn(),
        verify: vi.fn().mockRejectedValue(new Error('Connection refused')),
      })

      const result = await emailService.testConnection(testConfig)
      expect(result).toBe(false)
    })
  })
})
```

- [ ] **Step 4: Delete notificationService.getCampaignStats + its orphaned import**

In `apps/api/src/services/notificationService.ts`:
- Remove the `getCampaignStats(jobId: string): JobStats { ... }` method (the `/** Get campaign statistics from logs */` block, ~lines 253-274 — the only thing using `logService`).
- Remove the now-unused import on line 4: `import { logService } from './logService'`.
- Keep `JobStats` (heavily used by `notificationTemplates.ts` + the notification methods).

- [ ] **Step 5: Remove the getCampaignStats tests + their logService mock**

In `apps/api/tests/services/notificationService.test.ts`:
- Remove the two `it('getCampaignStats ...')` tests (~lines 154-176).
- Remove the `vi.mock('../../src/services/logService', ...)` (line 23), the `vi.doMock('../../src/services/logService', ...)` (line 102), and the `import { logService } from '../../src/services/logService'` (line 48) — verify with `grep -n "logService" tests/services/notificationService.test.ts` that nothing else references it after removing the two tests; remove only what's now unused.

- [ ] **Step 6: Remove the orphaned types**

In `apps/api/src/types/index.ts`, remove `interface BatchJob` (line 79) and `interface BatchStatusInfo` (line 96). **Keep** `EmailJob` (29) and `BatchConfig` (72) — both still live (`send.ts`, `schedulerService.ts`, `schedulerProcessor.ts`).

- [ ] **Step 7: Verify no dangling references**

Run:
```bash
grep -rn "batchService\|sendBulkEmails\|createTransport\b\|sendSingleEmail\|getCampaignStats\|BatchJob\|BatchStatusInfo" apps/api/src apps/api/tests | grep -v "transports" | grep -v "nodemailer.createTransport"
```
Expected: no matches (all dead references gone; the remaining `createTransport` hits are the unrelated `../services/transports` + `nodemailer.createTransport`, which are filtered out).

- [ ] **Step 8: Typecheck (dead-caller errors clear; live-consumer errors remain for Task 12-13)**

Run: `bun typecheck`
Expected: only the `processor.ts` / `report.ts` / `dashboard.ts` errors remain.

### Task 12: Ripple the live writer — processor.ts

**Files:**
- Modify: `apps/api/src/services/queue/processor.ts` (log writes at ~156 and ~179)

- [ ] **Step 1: Thread org_id + await on both addLog calls**

In `apps/api/src/services/queue/processor.ts`, wrap each `logService.addLog({...})` so it passes `job.org_id` and is awaited, guarding on org_id like the existing gate code at line 66 (`if (job.org_id)`):

For the 'Sent' write (~line 156):
```typescript
        if (job.org_id) {
          await logService.addLog(job.org_id, {
            id: `q_${job.id}_${Date.now()}`,
            email,
            status: 'Sent',
            timestamp: new Date().toISOString(),
            messageId,
            firstName,
            company,
            subject: job.subject || '',
          })
        }
```
For the 'Failed' write (~line 179):
```typescript
        if (job.org_id) {
          await logService.addLog(job.org_id, {
            id: `q_${job.id}_${Date.now()}`,
            email,
            status: 'Failed',
            message: `${retryEngine.describeError(errorType)} (${errorMessage})`,
            timestamp: new Date().toISOString(),
            firstName,
            company,
            subject: job.subject || '',
          })
        }
```
(Preserve the exact field values currently passed at each site — only add the `job.org_id` first arg, the `if (job.org_id)` guard, and `await`. Match the existing local variable names in scope at each call site.)

- [ ] **Step 2: Typecheck**

Run: `bun typecheck`
Expected: processor.ts error clears; report.ts + dashboard.ts remain.

### Task 13: Ripple the live readers — report.ts + dashboard.ts

**Files:**
- Modify: `apps/api/src/routes/report.ts`
- Modify: `apps/api/src/routes/dashboard.ts`

- [ ] **Step 1: report.ts — import getOrgId and org-scope the fallback calls**

In `apps/api/src/routes/report.ts`:
- Add `getOrgId` to the auth import (line 9): `import { requireAuth, getOrgId } from '../middleware/auth'`.
- In each handler that falls back to `logService`, derive `const orgId = getOrgId(c)` and await the org-scoped calls. Concretely:
  - `GET /report/logs` fallback (lines 82-85):
    ```typescript
      const orgId = getOrgId(c)
      return success(c, {
        logs: await logService.getLogs(orgId),
        stats: await logService.getStats(orgId),
      })
    ```
  - `GET /report/stats` fallback (line 106):
    ```typescript
      return success(c, await logService.getStats(getOrgId(c)))
    ```
  - `GET /report` (legacy) fallback (lines 127-130):
    ```typescript
      const orgId = getOrgId(c)
      return success(c, {
        logs: await logService.getLogs(orgId),
        stats: await logService.getStats(orgId),
      })
    ```
  - `DELETE /report/logs/:id` local fallback (line 200):
    ```typescript
      await logService.deleteLog(getOrgId(c), logId)
    ```
  - `POST /report/logs/delete-bulk` local fallback (line 228):
    ```typescript
      const orgId = getOrgId(c)
      for (const id of ids) await logService.deleteLog(orgId, id)
    ```
  - `fetchLogsForExport` helper (line 273): change its signature to accept `c` (already does) and return `await logService.getLogs(getOrgId(c))`. The `EmailLog[]` it returns is assignable to the `EmailLogRecord[]` the CSV/JSON generators consume (the generators read optional fields defensively).

- [ ] **Step 2: dashboard.ts — import getOrgId and org-scope**

In `apps/api/src/routes/dashboard.ts`:
- Add the import: `import { requireAuth, getOrgId } from '../middleware/auth'` (currently only `requireAuth`).
- In `GET /dashboard/stats` (lines 42-66), after `const user = requireAuth(c)` add `const orgId = getOrgId(c)`, then:
  - line 47: `const allLogs = (await logService.getLogs(orgId)) ?? []`
  - line 56: hoist stats above the return — `const logStats = await logService.getStats(orgId)` — and use `stats: logStats` in the returned object.

- [ ] **Step 3: Typecheck back to baseline**

Run: `bun typecheck`
Expected: back to 49.

- [ ] **Step 4: Full suite + lint**

Run: `bunx vitest run && bun lint`
Expected: suite green (logService net included; gated storage net skipped); lint clean.

- [ ] **Step 5: Confirm no local-disk log path remains**

Run: `grep -rn "email-logs.json\|./logs" apps/api/src`
Expected: no matches in the request/service path (logService no longer touches disk).

- [ ] **Step 6: Commit P5.3 (service rewrite + dead-code deletion + ripple) as one green change**

```bash
git add -A apps/api/src apps/api/tests
git commit --no-gpg-sign -m "feat(p5.3): logService→Postgres (org-scoped, async); delete dead pre-BullMQ sender"
```

---

## P5.4 — Persist import files to object storage

### Task 14: import_history.file_key column + migration

**Files:**
- Modify: `apps/api/src/db/pg/schema/contacts.ts` (the `import_history` table, ~lines 57-75)
- Create (generated): `apps/api/src/db/pg/migrations/0010_*.sql`

- [ ] **Step 1: Add the column to the schema**

In `apps/api/src/db/pg/schema/contacts.ts`, add to the `import_history` table definition (after `field_mapping`):
```typescript
    file_key: text('file_key'),
```

- [ ] **Step 2: Generate + apply the migration (R4)**

Run from `apps/api/`: `bunx drizzle-kit generate`
Expected: `0010_*.sql` with `ALTER TABLE "import_history" ADD COLUMN "file_key" text;`
Inspect: `cat src/db/pg/migrations/0010_*.sql` (confirm it's the single ADD COLUMN, no drift).
Apply: `bun run src/db/pg/migrate.ts`

- [ ] **Step 3: Typecheck + commit**

Run: `bun typecheck` (49 baseline).
```bash
git add apps/api/src/db/pg/schema/contacts.ts apps/api/src/db/pg/migrations/
git commit --no-gpg-sign -m "feat(p5.4): import_history.file_key column + migration 0010"
```

### Task 15: contactService — record + read the file key

**Files:**
- Modify: `apps/api/src/services/contactService.ts` (`recordImport` ~line 363; add `getImport`)
- Test: `apps/api/tests/services/importFile.test.ts`

- [ ] **Step 1: Write failing tests for recording + org-scoped read**

Create `apps/api/tests/services/importFile.test.ts`:
```typescript
// P5.4 net — import_history.file_key recording + org-scoped read (PGlite, no storage).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { freshDbMigrated, type TestDb } from '../helpers/pg'
import { __setTestDb, getDb } from '../../src/db/pg/client'
import { organizations, users } from '../../src/db/pg/schema'
import { contactService } from '../../src/services/contactService'

async function seed(orgId: string, userId: string) {
  await getDb().insert(organizations).values({ id: orgId, name: orgId }).onConflictDoNothing()
  await getDb().insert(users).values({ id: userId, org_id: orgId, email: `${userId}@t.com`, name: userId }).onConflictDoNothing()
}

const result = { total: 2, imported: 2, duplicates: 0, invalid: 0 }

describe('P5.4 — import file_key recording', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await freshDbMigrated()
    __setTestDb(db)
    await seed('org-a', 'user-a')
    await seed('org-b', 'user-b')
  }, 30_000)
  afterEach(() => {
    __setTestDb(null)
    vi.clearAllMocks()
  })

  it('recordImport stores file_key and getImport returns it for the owning org', async () => {
    await contactService.recordImport('org-a', 'user-a', 'list-1', 'c.csv', 'csv', result, {}, 'imports/org-a/123_c.csv')
    const rows = await contactService.listImports?.('org-a') // if a lister exists; else query directly below
    // Fetch the row id via a direct query (listImports may not exist):
    const all = await getDb().query?.import_history?.findMany?.({ where: (h: any, { eq }: any) => eq(h.org_id, 'org-a') })
    const id = (all?.[0] ?? rows?.[0])?.id as string
    expect(id).toBeTruthy()
    const row = await contactService.getImport('org-a', id)
    expect(row?.file_key).toBe('imports/org-a/123_c.csv')
  })

  it('getImport is org-scoped — org B cannot read org A’s import', async () => {
    await contactService.recordImport('org-a', 'user-a', 'list-1', 'c.csv', 'csv', result, {}, 'imports/org-a/k')
    const all = await getDb().query?.import_history?.findMany?.({ where: (h: any, { eq }: any) => eq(h.org_id, 'org-a') })
    const id = all?.[0]?.id as string
    expect(await contactService.getImport('org-b', id)).toBeNull()
  })
})
```
> Note for the implementer: if the repo's drizzle `query` API or a `listImports` helper isn't wired, replace the id-fetch lines with a direct `getDb().select().from(import_history).where(eq(import_history.org_id, 'org-a'))` (import `import_history` + `eq`). The assertions on `getImport` are the point.

- [ ] **Step 2: Run to confirm it fails**

Run: `bunx vitest run tests/services/importFile.test.ts`
Expected: FAIL — `recordImport` rejects the 8th arg; `getImport` is not a function.

- [ ] **Step 3: Extend recordImport + add getImport**

In `apps/api/src/services/contactService.ts`:

(a) Change `recordImport` to accept an optional `fileKey` and store it:
```typescript
  async recordImport(orgId: string, userId: string, listId: string, filename: string, format: string, result: ImportResult, fieldMapping: Record<string, string>, fileKey: string | null = null): Promise<void> {
    await getDb().insert(import_history).values({
      id: generateId('imp'),
      org_id: orgId,
      user_id: userId,
      list_id: listId,
      filename,
      format,
      total_rows: result.total,
      imported: result.imported,
      duplicates: result.duplicates,
      invalid: result.invalid,
      field_mapping: JSON.stringify(fieldMapping),
      file_key: fileKey,
    })
  }
```

(b) Add an org-scoped reader (place it near `recordImport`; ensure `eq`/`and` are imported from `drizzle-orm` and `import_history` from the schema — both already imported in this file):
```typescript
  async getImport(orgId: string, id: string): Promise<ImportHistoryRow | null> {
    const [row] = await getDb()
      .select()
      .from(import_history)
      .where(and(eq(import_history.id, id), eq(import_history.org_id, orgId)))
      .limit(1)
    return row ?? null
  }
```
(Import `ImportHistoryRow` from the schema if not already; add `and` to the `drizzle-orm` import if missing.)

- [ ] **Step 4: Run the net green**

Run: `bunx vitest run tests/services/importFile.test.ts`
Expected: both pass.

- [ ] **Step 5: Typecheck + commit**

Run: `bun typecheck` (49 baseline).
```bash
git add apps/api/src/services/contactService.ts apps/api/tests/services/importFile.test.ts
git commit --no-gpg-sign -m "feat(p5.4): contactService.recordImport stores file_key; org-scoped getImport"
```

### Task 16: Store the original on import + signed-URL download route

**Files:**
- Modify: `apps/api/src/routes/contacts.ts` (import route + new download route)

- [ ] **Step 1: Persist the original file on import**

In `apps/api/src/routes/contacts.ts`:
- Add the import at the top: `import { storageService } from '../services/storageService'`.
- In the import handler, after the parse/import logic and before `recordImport` (line 326), store the original buffer (best-effort — a storage hiccup must not fail an otherwise-successful import) and pass the key:
```typescript
  // Persist the original upload to object storage (best-effort).
  let fileKey: string | null = null
  try {
    fileKey = `imports/${orgId}/${Date.now()}_${file.name}`
    await storageService.put(fileKey, fileBytes, file.type || 'application/octet-stream')
  } catch (err) {
    logger.error('Failed to persist import file:', err)
    fileKey = null
  }

  // Record history
  await contactService.recordImport(orgId, user.id, listId, file.name, format, result, fieldMapping, fileKey)
```
(`fileBytes` is the `Uint8Array` introduced in Task 6. Confirm `logger` is imported in this file; if not, add `import { logger } from '../utils/logger'`.)

- [ ] **Step 2: Add the owner-scoped download route**

Add a new route in `apps/api/src/routes/contacts.ts` (near the other `/contacts/...` routes):
```typescript
/** Signed-URL download of a stored import file (owner-scoped). */
app.get('/contacts/imports/:id/file', requirePermission(PERMISSIONS.CONTACTS_VIEW), async (c) => {
  const orgId = getOrgId(c)
  const id = c.req.param('id')

  const row = await contactService.getImport(orgId, id)
  if (!row || !row.file_key) return error(c, 'Import file not found', 404)

  const url = await storageService.getSignedDownloadUrl(row.file_key)
  return success(c, { url })
})
```
(`getOrgId`, `error`, `success`, `requirePermission`, `PERMISSIONS` are already imported in this file.)

- [ ] **Step 3: Typecheck + suite + lint**

Run: `bun typecheck && bunx vitest run && bun lint`
Expected: 49 baseline; suite green; lint clean.

- [ ] **Step 4: (Optional) gated MinIO end-to-end for import persistence**

If desired, add a `RUN_STORAGE_IT`-gated test that puts a buffer via the real `storageService` and fetches the signed URL — but the always-run PGlite net (Task 15, storageService mocked) already covers the authz + recording logic. Skip if not adding value.

- [ ] **Step 5: Commit P5.4**

```bash
git add apps/api/src/routes/contacts.ts
git commit --no-gpg-sign -m "feat(p5.4): store original import to object storage + signed-URL download route"
```

---

## Final verification (after all four increments)

- [ ] **Statelessness grep is clean:**
```bash
grep -rn "writeFile\|saveUploadedFile\|./uploads\|email-logs.json\|mkdir('./logs'" apps/api/src
```
Expected: no user-state disk writes in the request/service path. (`pluginManager` reading read-only manifests from disk is out of scope — acceptable.)

- [ ] **Typecheck flat:** `bun typecheck` → 49.
- [ ] **Lint clean:** `bun lint`.
- [ ] **Default suite green (storage nets skipped):** `bunx vitest run`.
- [ ] **Gated storage nets green with MinIO up:** `docker compose up -d minio && RUN_STORAGE_IT=1 bunx vitest run tests/services/storageService.test.ts`.
- [ ] **App + worker boot** on real Postgres + Valkey + MinIO (compose).
- [ ] Update `PROGRESS.md` (add a P5 section) and the `dispatch-p5-status.md` memory (mark DONE).

---

## Self-review notes (against the spec)

- **Spec §"in-memory parsing"** → P5.2 (Tasks 5-8): all 4 call sites + `saveUploadedFile` removal. ✓
- **Spec §"logService → Postgres, async, org-scoped"** → P5.3 (Tasks 9-13). The spec said "thread orgId from callers (processor, batchService/emailService, dashboard/report, notificationService)"; recon proved `batchService`/`emailService.sendBulkEmails`/`getCampaignStats` are **dead** — so per the user's decision they're **deleted** (Task 11), and only the live consumers (`processor`, `report`, `dashboard`) are threaded. This is a deliberate, documented deviation that still satisfies the success criterion ("send-logs org-scoped; every log consumer async"). ✓
- **Spec §"storageService (@aws-sdk, lazy, put/get/signed-url/delete/ensureBucket; gated MinIO net)"** → P5.1 (Tasks 1-4). ✓
- **Spec §"import_history.file_key + signed-URL download, owner-scoped"** → P5.4 (Tasks 14-16). ✓
- **Spec §"contacts_json / exports / pluginManager manifests deferred"** → not touched. ✓
- **R4** (generated migrations only) honored in Tasks 9 & 14. **R9** (org-scoping, server-derived orgId) is the core of P5.3/P5.4. **R5** gates every increment on `bun typecheck`@49 + `bun lint`.
