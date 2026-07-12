# P8 Discovery Sweep — Confirmed Findings (Task 4)

Adversarial security sweep across 6 attack surfaces (tenant-isolation/IDOR, auth/RBAC,
injection/validation, secret exposure, SSRF/redirect/path, mass-assignment/abuse), each raw
finding routed to an independent adversarial verifier that defaulted to *refuted* unless it
could trace a concrete, reachable exploit in the real code. Scope: `apps/api/src`. The T1–T3
already-fixed items and the recon-cleared items (oauth open-redirect, secret-compare timing)
were excluded up front.

**Result: 20 raw findings → 10 confirmed (High 4 / Medium 5 / Low 1), 8 refuted, plus the
2 already-verified-safe carried from recon.** All 10 confirmed were re-verified directly by the
controller against source (route + service sink).

Fix bar (chosen for P8): **fix Critical/High with a regression test each; document Medium/Low.**
The **Disposition** column records the *recommended* T5 action — several Mediums are direct
violations of the project's hard R9 rule (cross-tenant scoping; secrets never to the browser)
and are recommended for elevation (see "Scope note" at the end).

---

## Confirmed — High (fix in T5, regression test each)

### H1 — Cross-tenant IDOR: team-member removal ignores caller org
- **Where:** `routes/admin.ts:728` (handler) → `services/teamService.ts:200` (sink)
- **Class:** IDOR / R9 tenant-scope break
- **Detail:** `DELETE /admin/teams/:teamId/members/:userId` calls
  `teamService.removeMember(orgId, teamId, targetId, ...)` with **no** preceding
  `teamService.get(orgId, teamId)` ownership guard — unlike its GET (`:691`) and POST (`:704`)
  siblings which both guard. The service `removeMember(_orgId, teamId, userId, _actorId)`
  **discards `_orgId`** and deletes `WHERE team_members.team_id = teamId AND user_id = userId`.
  Any `TEAMS_MANAGE` holder in org A can evict a member of any team in org B; the audit row is
  written under the attacker's org (misattribution). Team ids are random UUIDs (not
  brute-forceable), so exploitation needs a leaked teamId — but it is still a real tenant-scope
  break per R9.
- **Fix:** add the `teamService.get(orgId, teamId)` guard in the route (mirror siblings); as
  defense-in-depth, scope `removeMember` by joining `teams.org_id` too.
- **Disposition:** **FIX** (High).

### H2 — Privilege escalation: change-member-role assigns an unbounded client role
- **Where:** `routes/admin.ts:594-611` (handler) → `services/orgService.ts:205` (sink); schema `admin.ts:51`
- **Class:** Vertical privilege escalation (BOLA/BFLA)
- **Detail:** `RoleSchema = z.object({ role: z.string().min(1).max(50) })` accepts **any** string
  incl. `"owner"`. `rbacService.canManageUser(actor, target, org)` only compares the actor's
  level against the target's **current** role — it never bounds the **new** role.
  `orgService.updateMemberRole` then `SET role = newRole` unconditionally. An `org_admin`
  (level 3, granted `users.manage` but **not** `org.delete`/`billing.manage` per seed) can set a
  puppet member's role to `"owner"` (level 4), minting capabilities above its own ceiling.
- **Fix:** bound the assignable role to a safe enum (mirror the existing `InviteSchema` enum
  `['admin','manager','member','readonly']`, which deliberately excludes `owner`) **and/or**
  enforce `level(newRole) <= level(actor)`.
- **Disposition:** **FIX** (High).

### H3 — Privilege escalation: add-member accepts an unconstrained role, no `canManageUser` gate
- **Where:** `routes/admin.ts:575-592` (handler) → `services/orgService.ts:180` (sink); schema `admin.ts:48`
- **Class:** Vertical privilege escalation
- **Detail:** `AddMemberSchema.role = z.string().max(50).optional()` — unconstrained (unlike the
  sibling `InviteSchema` enum). The handler calls `orgService.addMember(orgId, target.id, role || 'member', ...)`
  with **no** `canManageUser` and no role bound at all. `org_admin` (holds `users.invite`) can
  add an already-registered puppet account directly as `"owner"`. Even more direct than H2.
- **Fix:** same bounded-role enum + a `canManageUser`/level check as H2.
- **Disposition:** **FIX** (High).

### H4 — SSRF via outbound webhook delivery URL (+ response-body exfiltration)
- **Where:** `services/webhookService.ts:179` (sendWebhook) & `:293` (testWebhook); read-back via
  `:247` + `getLogs():257` → `routes/webhooks.ts:118` (`GET /webhooks/:id/logs`); weak schema `webhooks.ts:31`
- **Class:** SSRF (server-side request forgery) + info disclosure
- **Detail:** `webhook.url` is only validated by `z.string().url()`, which accepts
  `http://169.254.169.254/...`, `localhost`, and RFC1918 hosts. `sendWebhook`/`testWebhook`
  `fetch(webhook.url)` with **no host allowlist** (the `isAllowedSnsUrl` guard added in T1 is
  applied only to the SNS `SubscribeURL`, never here). `POST /webhooks/:id/test` is an immediate
  blind-SSRF oracle (returns statusCode); event-driven delivery stores the target's
  `response_body.substring(0,2000)` in `webhook_logs`, readable back via `GET /webhooks/:id/logs`
  → full partial-response exfiltration of internal services / cloud-metadata (host IAM creds).
- **Fix:** validate `webhook.url` at the boundary + before every `fetch` — require `https:` (or
  `http:`), reject private/loopback/link-local/metadata IPs and non-public hosts. Apply to
  create/update **and** the two fetch sinks. Add a shared URL-guard helper.
- **Disposition:** **FIX** (High).

---

## Confirmed — Medium

### M1 — Cross-tenant IDOR: `POST /campaigns/:id/ab/winner` mutates another org's A/B variants
- **Where:** `routes/campaigns.ts:360` (handler) → `services/campaignService.ts:335` (sink)
- **Class:** IDOR / R9 tenant-scope break
- **Detail:** The **only** A/B endpoint that omits the `campaignService.get(orgId, campaignId)`
  ownership guard its four siblings (`:333/:350/:390/:407`) all perform. `declareWinner(campaignId, variantId)`
  has **no `org_id` predicate**: the first `UPDATE ab_variants SET is_winner=0 WHERE campaign_id=?`
  always runs (clears org B's winner using only a target campaign_id), then flips the winner with
  a valid variant_id. Any `CAMPAIGNS_MANAGE` holder in org A can corrupt org B's A/B winner.
- **Fix:** add the `get(orgId, campaignId)` guard in the route (mirror siblings); optionally scope
  `declareWinner` by org.
- **Disposition:** **RECOMMEND FIX** — same R9 cross-tenant class as the Highs and the T2
  scheduled-jobs IDOR; one-line guard. (Verifier severity Medium only due to limited blast
  radius = A/B winner-flag integrity.)

### M2 — Provider-plugin secrets stored plaintext at rest AND returned to the browser
- **Where:** `services/pluginManager.ts:136` (store) → `routes/plugins.ts:41,68,81,101` (leak)
- **Class:** Secret exposure — **direct R9 violation** ("secrets encrypted at rest, never returned to the browser")
- **Detail:** Built-in provider plugin settings (`aws_secret_access_key`, `api_key`,
  `server_token`) are persisted via `JSON.stringify(input.settings)` into `plugins.settings_json`
  with **no `encrypt()`** (every other secret store uses `encrypt()`/`setSecret`). `GET /plugins`
  and `GET /plugins/:id` return the raw row verbatim, shipping the (never-encrypted) credentials
  back to the browser; the install responses echo them too. Contrast the whatsapp route, which
  encrypts `access_token` at rest and masks it to `***`.
- **Fix:** encrypt provider-secret settings at rest (mirror whatsapp/systemSettings) and mask/omit
  them on read. Self-scoped (per `user.id`), and provider settings appear unwired to any send path
  (largely decorative) — hence Medium — but it is a categorical R9 breach.
- **Disposition:** **RECOMMEND FIX** — R9 is a hard rule; plaintext cloud creds at rest + to the
  browser should not ship behind a security gate.

### M3 — Permission-override grant is not bounded by the actor's own permissions (confused deputy)
- **Where:** `routes/admin.ts:766` → `services/rbacService.ts:243` (`upsertOverride`); schema `admin.ts:63`
- **Class:** Privilege escalation via delegation
- **Detail:** `POST /admin/permissions/:userId/grant` accepts any free-string `permission`
  (`z.string().min(1)`); the only gate is `canManageUser(actor, target)`. There is **no check that
  the actor holds the permission being granted**, so a `permissions.manage` holder can grant a
  lower-ranked puppet `billing.manage` / `org.delete` (which the actor is explicitly denied) and
  exercise it through the puppet.
- **Fix:** restrict grantable permissions to those the actor effectively holds (and/or an
  allow-list); reject escalation beyond the actor's own set.
- **Disposition:** **RECOMMEND FIX** — the third vector of the same escalation class as H2/H3;
  fixing two and leaving this open is incoherent for the gate. Folds into the same RBAC pass.

### M4 — Sensitive mutating routes enforce only `requireAuth`, not `requirePermission`
- **Where:** `routes/routing.ts` (`:74,:83,:92,:107`), `routes/plugins.ts` (`:71,:90,:104,:116,:128,:141`),
  `routes/oauth.ts` (`:99,:128`), `routes/warmup.ts` (`:56,:97,:109`)
- **Class:** Broken function-level authorization (OWASP A01)
- **Detail:** Every handler in these four files gates only on `requireAuth(c)` (any authenticated
  member, incl. a `readonly` role with zero `*.manage` permissions) — no `requirePermission`.
  A readonly/member user can mutate email-routing config, force provider failover, install
  plugins, disconnect/test OAuth sending accounts, and create/cancel/delete warmup plans. Every
  op is scoped to the acting `user.id` (no cross-tenant reach; OAuth disconnect is
  ownership-checked; plugin install writes only DB metadata — no code exec), hence Medium.
- **Fix:** add the appropriate `requirePermission(PERMISSIONS.*)` to each handler (SMTP/provider,
  plugins, warmup manage permissions already exist and are used by `config.ts`).
- **Disposition:** **DOCUMENT** (self-scoped authz gap; larger surface, no cross-tenant/secret
  impact) — fix a strong candidate for P9 hardening. *(Elevate if the gate should enforce the
  full RBAC model.)*

### M5 — Rate limiter keys on spoofable `X-Forwarded-For` (auth/send throttle bypass)
- **Where:** `middleware/rateLimit.ts:39` (applied at `app.ts:104-111`)
- **Class:** Trusted-header rate-limit bypass (CWE-290)
- **Detail:** The limiter keys on `x-forwarded-for`.split(',')[0] — the **leftmost**, client-controlled
  XFF token — with no `trustProxy` config. An unauthenticated attacker rotates the header per
  request to get a fresh 10/15-min bucket, fully defeating the login/register/send/upload
  throttles; this is the **only** anti-brute-force control (no account lockout). Absent XFF, all
  callers share one `'unknown'` bucket (collateral lockout).
- **Fix:** derive the client IP from a trusted position (rightmost XFF hop behind the known proxy
  count, or a platform-provided `cf-connecting-ip`/socket IP); do not trust the leftmost token.
- **Disposition:** **DOCUMENT** (defense-in-depth; correct fix depends on the deploy topology /
  proxy trust, so document with the recommended approach rather than guess).

---

## Confirmed — Low

### L1 — No rate limit on `POST /auth/forgot-password` (email-bomb / mailer-quota abuse)
- **Where:** `routes/auth.ts:192`; rate-limit wiring `app.ts:104-111`
- **Class:** Missing anti-abuse control
- **Detail:** `forgot-password` (and `reset-password`/`change-password`) are covered by **no**
  rate-limiter, and `createPasswordResetToken` has no per-email cooldown. Downgraded Medium→Low by
  the verifier: `forgot-password` is **not** in `PUBLIC_PATHS`, so it sits behind `authMiddleware`
  and requires a (trivially self-registered) session; impact is inbox spam + shared system-mailer
  quota/reputation, not data disclosure (the reset token is never returned).
- **Disposition:** **DOCUMENT** (Low) — add a per-email cooldown / rate-limit as GA hardening.

---

## Verified safe (no fix — carried from recon, re-confirmed)

- **oauth open redirect (`routes/oauth.ts:81,93`):** redirect origin is always server-built from
  `SERVER.FRONTEND_URL` + a fixed path literal; the OAuth `state` carries no client `returnTo`.
- **secret-compare timing (whole codebase):** every secret/token comparison uses `timingSafeEqual`
  / argon2 (`Bun.password`) / a DB `eq()` lookup. (T3 added explicit length pre-checks as
  defense-in-depth.)

## Refuted (checked, not real / not reachable)

| # | Location | Claim | Why refuted |
|---|----------|-------|-------------|
| R1 | `auth.ts:31` register | No CAPTCHA/org-quota/quarantine | Intended self-service SaaS registration; rate-limited; no boundary crossed. Informational hardening only. |
| R2 | `templateService.ts:267` | ReDoS via dynamic RegExp from data keys | Sink real, but the catastrophic-backtracking payload **does not reproduce under Bun** (JSC/YARR); production is unambiguously Bun (`oven/bun` image). Residual = a per-request 500 on a RegExp `SyntaxError` → Low robustness, not a DoS. (Would become real High if ever migrated to Node/V8.) |
| R3 | `segmentService.ts:216` `buildQuery` | SQLi-shaped fragment | Doubly dormant: echo-only (never passed to an executor), and `rules_json` is never populated (schema exposes only `rules_json`, service reads `input.rules` → always null → preview short-circuits 400). All values are `?`-parameterized. |
| R4 | `whatsapp.ts:90` | `webhook_verify_token` returned unmasked | Intended (admin copies it into Meta's dashboard); org-scoped; a handshake nonce, not a secret-at-rest; confers zero exploit capability. |
| R5 | `automationService.ts:531` | SSRF via automation http_request/webhook step | Unreachable: `flow`/`flow_json` are not in the route schema (zod strips them), so no step URL is ever persisted; the worker branch never executes. Latent — real only if a flow-editing endpoint is added. |
| R6 | `rssService.ts:125` | SSRF via RSS feed URL | Dead/unwired code — no route mounts RSS CRUD, no worker invokes the fetcher. Add an allowlist if ever wired. |
| R7 | `contacts.ts:370` | Path traversal via upload filename in storage key | `orgId`-prefixed (server-derived); R2/S3 store `..` literally (no traversal); MinIO rejects; write is best-effort in a swallowed try/catch. Not exploitable. |
| R8 | `forms.ts:193` | Stored open redirect on public form-submit | `redirect_url` is tenant-configured, not request-controlled; POST-only (not a clickable phishing primitive); intended form-builder feature. |

---

## Scope note (feeds T5)

Holding strictly to "fix High only" would ship the gate with a known **cross-tenant IDOR** (M1)
and a **plaintext-cloud-credential** exposure (M2) documented-but-unfixed — both categorical R9
violations — plus leave one of three identical privilege-escalation vectors (M3) open while
fixing the other two (H2/H3). Recommendation for T5: **fix H1–H4 + M1 + M2 + M3** (M1/M3 fold
into the same route-guard / RBAC passes as the Highs; M2 is a contained encrypt-at-rest + mask
change), and **document M4, M5, L1** with the recommended remediation (their correct fixes are
either larger-surface or deploy-topology-dependent, appropriate for P9 hardening).
