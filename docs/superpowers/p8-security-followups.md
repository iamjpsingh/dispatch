# P8 Security Follow-ups

Stub created by P8 T3 (audit taxonomy + timing-safe hardening). Finalized by T5 after the
T4 discovery sweep — this list will grow with additional Medium/Low findings at that point.

## Verified safe (no fix needed)

- **Open redirect — `apps/api/src/routes/oauth.ts:81,93`: VERIFIED SAFE.** The redirect
  URL's origin is always server-built from `SERVER.FRONTEND_URL` plus a fixed path
  literal; the OAuth `state` parameter carries no `returnTo` / `redirect_uri` value from
  the client. There is no attacker-controlled input that can change the redirect
  destination. No fix required.
- **Secret-compare timing (whole codebase): VERIFIED SAFE.** Swept every secret/token
  comparison in the codebase — all use `timingSafeEqual`, `argon2`
  (`Bun.password.hash`/`.verify`), or a DB `eq()` lookup (constant-shape query, not an
  in-process string compare). No plain `===` comparison of a secret or token was found.
  (T3b additionally added explicit length pre-checks ahead of `timingSafeEqual` in
  `webhookSignature.ts` as defense-in-depth — see below.)

## Accepted / carried from T1

- **Postmark webhook signature (T1): accepted.** Postmark has no signing-secret
  mechanism by design; the endpoint relies on URL secrecy instead. Medium follow-up:
  add an optional shared-secret / basic-auth check ahead of GA.
- **Inbound-reply event routing (T1): unbuilt.** The dead `eventBus.emit` calls removed
  in T1 had no live subscriber — reply-tracking was never wired end-to-end. Candidate
  for P9 if inbound-reply handling is wanted as a feature.

## Other carried items

- **Stale `dist/` artifact (T2):** rebuild before any deploy that serves from `dist/`
  directly, to avoid shipping a pre-fix build.

## Hardening applied in T3

- `apps/api/src/middleware/webhookSignature.ts` — `verifyMailgunSignature` and
  `verifySparkPostSignature` now explicitly check `a.length === b.length` before calling
  `timingSafeEqual`, rather than relying on the enclosing `try`/`catch` to convert
  `timingSafeEqual`'s length-mismatch throw into `false`. Behavior is unchanged; this
  removes reliance on exception control flow for a security-relevant check.

## Deferred from the T4 discovery sweep → P9 hardening (confirmed, not fixed in P8)

Full confirmed/refuted detail is in `p8-sweep-findings.md`. Per the agreed P8 fix bar, the
Highs plus the R9-structural Mediums (cross-tenant IDOR M1, plaintext-secret M2, grant-bound
M3) were fixed in T5; the three below are real but were deferred to P9 because their correct
fix is either larger-surface or deploy-topology-dependent.

- **M4 — sensitive mutating routes gate on `requireAuth` only, not `requirePermission`**
  (`routes/routing.ts`, `plugins.ts`, `oauth.ts`, `warmup.ts`). A `readonly`/`member` role can
  mutate routing config, force provider failover, install plugins, disconnect/test OAuth
  accounts, and manage warmup plans. Every operation is scoped to the acting `user.id` (no
  cross-tenant reach; OAuth disconnect is ownership-checked; plugin install writes only DB
  metadata — no code exec), so it is a function-level authorization gap (OWASP A01), not a
  tenant-isolation or RCE issue. **Fix (P9):** add `requirePermission(PERMISSIONS.*)` to each
  handler (the SMTP/provider/warmup manage permissions already exist and gate `config.ts`).
  ~12 handlers across 4 files.

- **M5 — rate limiter keys on the spoofable leftmost `X-Forwarded-For`**
  (`middleware/rateLimit.ts:39`). An unauthenticated attacker rotates the XFF header to get a
  fresh bucket per request, defeating the login/register/send/upload throttles (the only
  anti-brute-force control; there is no account lockout). **Fix (P9):** derive the client IP
  from a trusted position for the actual deploy topology (rightmost hop behind the known proxy
  count, or a platform header like `cf-connecting-ip`), rather than the client-controlled
  leftmost token. Deferred because the correct source depends on the production proxy chain.

- **L1 — no rate limit on `POST /auth/forgot-password`** (`routes/auth.ts:192`;
  `reset-password`/`change-password` likewise). Enables inbox email-bombing + shared
  system-mailer quota/reputation abuse. Reachable only with a (trivially self-registered)
  session — `forgot-password` sits behind `authMiddleware` — and leaks no data (the reset token
  is never returned), so it is Low. **Fix (P9):** add a per-email cooldown / rate-limit.

## T7 final-review outcomes

The T7 adversarial review of the T5 fixes surfaced two real must-fix defects (both fixed) and
several residuals:

**Fixed in T7** (regression-tested):
- **Redirect-SSRF (was High) — the H4 fix was incomplete.** `fetch` defaults to
  `redirect:'follow'`, so a webhook whose URL is an attacker-controlled *public* endpoint (passes
  the guard) could 302→`http://169.254.169.254/…` and the fetch would follow into cloud metadata,
  with the body exfiltrated via `GET /webhooks/:id/logs`. Fixed: both delivery/test fetches now
  pass `redirect:'manual'` (never follow a 3xx).
- **Invitation privilege-escalation (was Medium) — the H2/H3 fix missed a sibling entrypoint.**
  `POST /admin/invitations` assigned a role with no `canAssignRole` bound, so a manager with a
  `users.invite` override could invite an admin. Fixed: same `canAssignRole` check as
  add-member/change-role.
- IPv6-literal handling in `ssrfGuard` (URL.hostname keeps the brackets → all IPv6 literals were
  rejected and loopback was blocked only by accident); now bracket-stripped + NAT64 (`64:ff9b::/96`)
  and 6to4 (`2002::/16`) blocked on the resolved path.
- Webhook create/update with a non-public URL now returns a clean 400 (was an unhandled 500).
- `MembersPage.vue` change-role dropdown no longer offers `owner` (the server rejects it).

**Deferred to P9** (accepted residual under the P8 bar):
- **DNS-rebinding TOCTOU (Medium)** — `isPublicHttpUrl` resolves the host, then `fetch` re-resolves
  independently, so an attacker controlling authoritative DNS (TTL 0) can pass a public A-record to
  the guard and serve an internal IP to the connect. A check-then-reconnect pattern cannot
  structurally prevent this; the correct fix is resolve-once + pin the vetted IP via a custom undici
  dispatcher (`lookup`), which is runtime/deploy-dependent — same class as M5. The boundary + sink
  re-check still closes the original open-SSRF; this is defense-in-depth hardening.
- IPv6 Teredo (`2001:0::/32`) and other exotic translation ranges on the DNS-resolved path (Low).

## Refuted during the T4 sweep (checked, not vulnerabilities)

Recorded for the audit trail — see `p8-sweep-findings.md` for full rationale. Notable: the
`templateService.renderPreview` dynamic-RegExp is **not** a ReDoS under the deployed Bun/JSC
runtime (would become a real High only if the API were ever moved to Node/V8 — track if that
migration is ever considered); `segmentService.buildQuery` is doubly-dormant (echo-only +
never populated) and fully parameterized; the automation-step and RSS-feed SSRF paths are
unreachable dead code (add a URL allowlist if either feature is ever wired to a route/worker).
