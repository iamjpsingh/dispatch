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
