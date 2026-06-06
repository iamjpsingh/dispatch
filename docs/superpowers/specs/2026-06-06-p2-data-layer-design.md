# P2 — Postgres + Drizzle Data Layer: Design & Decomposition (north-star)

- **Date:** 2026-06-06 · **Status:** design locked; executed sub-stage by sub-stage (multi-session epic).
- **Parent:** docs/superpowers/specs/2026-06-06-dispatch-saas-replatform.md §P2.

## The problem (verified)
62 `CREATE TABLE`s across **17 separate SQLite files** + a second migration-managed `dispatch.db` (identity/auth via `src/db/connection.ts` + `src/db/migrate.ts` + migrations 001–006), touched by ~30 services. **No cross-DB foreign keys** — which is the structural root of the unsubscribe/suppression key bug and the org/user scoping gaps. Goal: one Postgres database, one Drizzle schema, real FKs, data-driven (R2).

## Locked decisions
1. **Schema:** Drizzle, one file per domain under `apps/api/src/db/pg/schema/*.ts`, barrel `index.ts`. Migrations generated via `bunx drizzle-kit generate` → `src/db/pg/migrations/` (R4: never hand-edit).
2. **Drivers:** prod = **Bun native SQL** (`drizzle-orm/bun-sql`); tests = **PGlite** (`@electric-sql/pglite` + `drizzle-orm/pglite`, embedded WASM Postgres, in-process — no Docker for `vitest`). One `getDb()` picks the driver by env. This **retires the `bun:sqlite` test shim**.
3. **Strangler migration:** one domain at a time. Rewrite each domain's service onto Drizzle behind its **existing exported interface** (callers/routes unchanged), point that service's tests at PGlite, then retire its old SQLite file. App stays green throughout.
4. **Data-driven (R2):** fields currently hardcoded as enums/unions become DB-backed lookup tables read at runtime — preference types, provider types, role/permission catalog, automation step types, campaign statuses, suppression reasons. Program structure (zod, handlers) stays code.
5. **FKs + tenancy (R9):** every domain row carries `org_id` (and `user_id` where owned), FK to `organizations`/`users`, `ON DELETE` chosen per relation. Suppression/preferences unified on **one key** (see P2.4).
6. **Existing-install data migration:** SQLite→PG copy scripts are a *late* sub-stage (P2.8). Greenfield/dev needs none (local DBs are regenerable).

## Decomposition (dependency-ordered sub-stages — each its own plan, green before "done")

- **P2.0 — PG foundation** *(this session)*: `@electric-sql/pglite`, `drizzle-orm`; `src/db/pg/client.ts` (`getDb()` env-switched bun-sql/PGlite); drizzle-kit wired; a PGlite-backed proof-of-life vitest test; documented per-domain migration recipe. **No service migrated → 425/20 stays green on SQLite.**
- **P2.1 — Identity**: users, organizations, org_members, roles, user_permissions, sessions, password_reset_tokens, invitations, teams, team_members → migrate authLocalService, orgService, rbacService, invitationService. Retire dispatch.db identity tables + migrations 001/003/006. (FK root — everything else references these.)
- **P2.2 — Contacts**: contacts, contact_lists, segments, segment_contacts, import_history → contactService, segmentService.
- **P2.3 — Campaigns/Templates**: campaigns, templates, template_sections, ab_variants → campaignService, templateService.
- **P2.4 — Queue + Suppression unification**: jobs, dead_letters, scheduled_jobs, suppression_list, email_preferences, frequency_config/log, graymail_config/tracker → queueDatabase, schedulerService, preferenceCenterService, frequencyCapService, graymailService. **Fix the compliance bug here:** unify suppression + preferences on one key (`org_id`, FK to organizations + contacts) so unsubscribes are honored at send time; thread `org_id` into jobs.
- **P2.5 — Automations**: automations, automation_steps, automation_enrollments → automationService.
- **P2.6 — Analytics/engagement/deliverability**: campaign_analytics, event_analytics, events, engagement_events, links, link_analytics, provider_stats, sending_domains, sending_emails, failover_log → analyticsService, scoringEngine, routingEngine, warmupService.
- **P2.7 — Remaining**: webhooks/webhook_logs, plugins, api_keys, landing_pages, rss_feeds, form_endpoints/submissions, whatsapp_*, system_settings, tracking_configs, audit_logs, activity_logs, import/misc.
- **P2.8 — Cutover**: SQLite→PG data-migration scripts; remove the `bun:sqlite` shim + `src/db/connection.ts`/`migrate.ts` + dead SQLite code; flip CI typecheck/test to required where now-clean.

## Testing strategy
Each migrated service's tests spin up a fresh PGlite instance, run the Drizzle migrations, seed, assert. A shared test helper (`tests/helpers/pg.ts`) provides `freshDb()`. The `bun:sqlite` alias in `vitest.config.ts` is removed in P2.8 once no service uses it.

## Risks
- bun-sql + drizzle is newer; if rough, fall back to `postgres.js` (`drizzle-orm/postgres-js`) for prod — schema unchanged. Verify the adapter API against current drizzle docs at P2.0.
- Identity (P2.1) underpins auth + the whole test suite; migrate carefully, keep the service interface identical.
- This is multi-session; `dispatch-session-status` memory tracks the current sub-stage.
