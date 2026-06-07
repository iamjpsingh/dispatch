# P3 — Secret Encryption + Auth Hardening: Design

- **Date:** 2026-06-07 · **Status:** design, pending user review.
- **Parent:** docs/superpowers/specs/2026-06-06-dispatch-saas-replatform.md §P3.

## Scope decision (locked 2026-06-07)

P2 delivered a clean, **tested** custom auth (argon2id password hashing + DB-backed
sessions + rbac with real FKs). So P3 is scoped to the actual security release-blockers,
**not** an auth rewrite:

1. **AES-256-GCM encryption of secrets at rest** (the audit's plaintext-secret blocker).
2. **Auth hardening** (rate-limit login/register, session-cookie review).

**Deferred (explicitly out of P3):**
- **better-auth replacement** — the custom auth is already secure + tested; better-auth's
  value is OAuth social login / email verification / plugins, which is a *feature* add, not
  a security fix. Revisit when social login is a product need.
- **d1UserDatabase SMTP-config secrets** — that store is Cloudflare D1 over HTTP, not local
  Postgres; encrypt when it's migrated (P3-later / P4).
- **CAPTCHA + new-tenant quarantine + per-org quotas** for open registration — needs a
  CAPTCHA provider; rate-limiting lands now, the rest is a follow-up.
- **Valkey-backed rate limiting** — move the in-memory limiter to Valkey in P4, where
  ioredis/Valkey is wired for BullMQ.

## 1. Crypto core — `src/utils/crypto.ts`

AES-256-GCM via WebCrypto (`crypto.subtle`), authenticated encryption.

- **Per-encryption random 12-byte IV**; GCM 16-byte auth tag (appended to ciphertext).
- **Versioned, self-describing envelope (string):** `v1:<keyId>:<base64url iv>:<base64url ciphertext+tag>`.
  - `keyId` = a short stable id for the key used (e.g. first 8 hex of SHA-256 of the raw key),
    so `decrypt()` knows which key to try first.
- **Keys from env:**
  - `ENCRYPTION_KEY` — primary, **required**; 32 raw bytes provided base64 (validated at load).
  - `FALLBACK_ENCRYPTION_KEY` — optional, **decrypt-only**, for zero-downtime rotation.
  - `encrypt()` always uses the primary key. `decrypt()` selects the key whose `keyId`
    matches the envelope; if none match, tries primary then fallback.
- **Boot validation:** in non-test env, throw if `ENCRYPTION_KEY` is missing or not 32 bytes
  (fail fast — never silently run unencrypted). A tiny `bun run src/utils/crypto.ts` (or a
  `gen-key` script) prints a fresh base64 key.
- **API:**
  - `encrypt(plaintext: string): string` → envelope
  - `decrypt(value: string): string` → plaintext (throws on tamper / bad key)
  - `isEncrypted(value: string): boolean` → `value.startsWith('v1:')` and parses — lets
    callers **decrypt-or-passthrough** legacy plaintext (no data migration needed; rows get
    re-encrypted on next write).
- Pure + dependency-free (WebCrypto is built in). Fully unit-testable.

## 2. Encrypt-at-rest — at the service boundary

Columns stay `text`; services **encrypt on write, decrypt on read**. `isEncrypted()`
passthrough means existing plaintext reads keep working and upgrade on next write.

Targets:
- `whatsappService` → `whatsapp_configs.access_token`, `whatsapp_configs.webhook_verify_token`
- `webhookService` → `webhooks.secret`
- `systemSettingsService` → provider secrets via a new **`setSecret(key, value, updatedBy?)`
  / `getSecret(key): string | null`** pair (encrypt on set, decrypt on get). Callers that
  store secrets switch to it:
  - admin OAuth creds: `oauth_<provider>` clientSecret, `cloudflare_oauth`
  - webhook signing keys written by `webhookRegistrationService`
  (Non-secret settings keep plain `set/get`. The cache stores the **encrypted** value; `getSecret`
  decrypts on read — secrets are never held in plaintext in the cache.)

**Not encrypted:** `users.password_hash` (argon2 hash, not reversible), API keys (argon2-hashed
with `dsp_` prefix already), anything in d1UserDatabase (deferred).

## 3. Auth hardening

- Apply the existing in-memory `authRateLimit` to **`POST /auth/login`** and
  **`POST /auth/register`** (IP-based). Add a second **email-keyed** throttle on login
  (slows targeted brute-force across IPs within an instance).
- Review session cookie flags in `COOKIE.OPTIONS` (httpOnly, `secure` in prod via `isHttps`,
  `sameSite`); tighten only if a gap is found.
- Honest limitation: in-memory limiter is per-instance → P4 moves it to Valkey.

## 4. Testing (net-first)

- **crypto.test.ts** (unit): round-trip; **tamper detection** (mutating ciphertext/tag →
  decrypt throws); **unique IV** per call (two encrypts of same plaintext differ); **rotation**
  (encrypt with primary, decrypt after swapping primary↔fallback); `isEncrypted` true/false;
  bad-key boot validation.
- **Service round-trips** (extend whatsapp/webhook PGlite nets + a systemSettings secret test):
  the value persisted in Postgres is ciphertext (`v1:` prefix), and the service returns the
  decrypted plaintext; a legacy plaintext row still reads (passthrough).
- **Rate-limit tests:** Nth login/register beyond the window → 429.

## 5. Env / compose

- Add `ENCRYPTION_KEY` (required) + optional `FALLBACK_ENCRYPTION_KEY` to docker-compose
  `api`/`worker` env and document in the env example. Tests set a fixed `ENCRYPTION_KEY`
  (vitest setup) so crypto is deterministic.

## Success criteria

- No provider/webhook/oauth secret is stored in plaintext in Postgres (verified by a test
  asserting the stored column is `v1:`-prefixed ciphertext).
- Tampered ciphertext fails closed (decrypt throws).
- Key rotation works (fallback decrypts old envelopes).
- login/register are rate-limited.
- `bun typecheck` clean (no net-new tsc errors), full suite green, app boots with
  `ENCRYPTION_KEY` set.
