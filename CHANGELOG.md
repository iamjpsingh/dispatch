# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-07-12

The SaaS re-platform: a ground-up move from the single-process SQLite app to a horizontally
scalable, multi-tenant, Postgres-backed monorepo.

### Added

- **Monorepo & build (P1):** Bun workspaces + Turborepo (`apps/api`, `apps/web`,
  `apps/tracking-worker`, `packages/shared`).
- **Object storage (P5):** S3-compatible storage (Cloudflare R2 / AWS S3 / MinIO) for uploads and
  exports.
- **Typed RPC API surface (P6):** end-to-end typed Hono RPC client for the web app, with
  `/api/v1` mounted alongside the legacy `/api` during the transition.
- **Admin, audit & compliance (P7):** platform/organization admin, an append-only audit log +
  activity feed wired across every mutating route, GDPR DSAR export and right-to-erasure
  (anonymize + cascade + hash-based suppression), scheduled data-retention purge, sender identity,
  and a hard CAN-SPAM gate (postal address required to launch).
- **Governance & docs (P9):** self-contained Swagger UI at `/docs` (spec at `/openapi.yaml`),
  self-hosting and deliverability guides, and project governance files (LICENSE, CONTRIBUTING,
  SECURITY, CODE_OF_CONDUCT, this CHANGELOG).

### Changed

- **Data layer (P2):** migrated from SQLite to **PostgreSQL + Drizzle ORM** with generated
  migrations.
- **Auth & secrets (P3):** session auth hardened; all provider/API secrets encrypted at rest with
  **AES-256-GCM** (with key-rotation support), never returned to the browser.
- **Queue & deliverability (P4):** sending moved to a **BullMQ + Valkey** queue with a separate
  worker process; send-time compliance gates; scheduler on BullMQ.

### Security

- **Audit gate (P8):** fixed cross-tenant IDORs, privilege-escalation paths, plaintext-secret
  exposure, and outbound-webhook SSRF (including redirect-follow SSRF); added advisory CI security
  scans (gitleaks, CodeQL, dependency CVE audit).
- **Hardening (P9):** function-level authorization on sending-infra mutations; rate limiting keyed
  on a trusted-proxy client IP (spoof-resistant) plus throttling on password-reset routes; and
  DNS-rebinding mitigation that pins the validated public IP for `http` webhook delivery.

### Removed

- Retired SQLite entirely; removed dead code (a dormant RSS-feed service, decorative built-in
  plugin providers, and an unused segment query-builder).
