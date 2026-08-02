# Dispatch

Self-hosted email marketing and automation platform. Send campaigns, manage contacts, automate sequences, track engagement — all on your own infrastructure with full data ownership.

Built with **Bun**, **Hono**, **Vue 3**, **Tailwind CSS**, and **TypeScript**.

![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)
![Vue.js](https://img.shields.io/badge/Vue%203-%234FC08D.svg?style=for-the-badge&logo=vuedotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-%2306B6D4.svg?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-%23E36002.svg?style=for-the-badge&logo=hono&logoColor=white)

---

## What Dispatch Does

**For teams that need to send email at scale without giving their data to a SaaS.**

- **Campaign sending** — Compose with a rich editor, import contacts from Excel/CSV, send personalized bulk emails with placeholders (`{{FirstName}}`, `{{Company}}`, etc.)
- **8 email providers** — SMTP, Amazon SES, SendGrid, Mailgun, Postmark, SparkPost, Gmail OAuth, Outlook OAuth. Connect with just an API key.
- **Contact management** — Import, tag, segment, and manage contacts across lists. Engagement scoring tracks who's active.
- **Batch processing** — Configurable batch sizes, delays, and rate limits per provider. Pause, resume, cancel jobs mid-send.
- **Scheduled campaigns** — Queue emails for future delivery with SQLite-backed job persistence.
- **Real-time tracking** — Open tracking (pixel), click tracking (link rewriting), unsubscribe handling. Deploy as Cloudflare Workers on your own domain for first-party tracking that bypasses ad blockers.
- **Bounce & complaint handling** — Automatic webhook processing for SES, SendGrid, Mailgun, Postmark, SparkPost. Hard bounces suppress permanently, complaints auto-unsubscribe.
- **Multi-org & RBAC** — Full SaaS-level organization system. Roles (owner, admin, manager, member, readonly), teams, 50+ granular permissions, invitation system with email delivery.
- **Platform admin** — Invisible super-admin configures system mailer, OAuth credentials, and tracking infrastructure via a setup wizard. Organizations never know it exists.
- **SSE real-time updates** — Live progress streaming for active campaigns via Server-Sent Events.
- **Audit logs** — Every admin action is logged with actor, action, entity, and timestamp.

---

## Architecture

Three applications in one repo:

```
dispatch/
├── src/                    # Backend — Bun + Hono API server
│   ├── routes/             # API endpoints (auth, send, config, admin, oauth, webhooks)
│   ├── services/           # Business logic (email, batch, queue, bounce, mailer)
│   ├── middleware/          # Auth, RBAC, CSRF, security headers
│   └── db/                 # SQLite migrations
├── frontend/               # Frontend — Vue 3 SPA
│   ├── src/views/          # Pages (Dashboard, Compose, Reports, Settings, Admin)
│   ├── src/lib/api/        # Typed API client
│   └── src/stores/         # TanStack Vue Query composables
└── tracking-worker/        # Cloudflare Worker — open/click/unsubscribe tracking
    └── src/                # D1-backed event storage
```

**Stack**:
- **Runtime**: Bun (built-in SQLite, fast startup)
- **Backend**: Hono (lightweight, SSE support, middleware)
- **Frontend**: Vue 3, Vue Router, TanStack Vue Query, Tailwind CSS, Lucide icons
- **Database**: SQLite (users, sessions, configs, queue, scheduler)
- **Tracking**: Cloudflare Workers + D1 (edge-deployed, first-party domains)
- **Email**: Nodemailer (SMTP/SES) + native fetch (SendGrid, Mailgun, Postmark, SparkPost, Gmail API, Outlook Graph API)

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/your-org/dispatch.git
cd dispatch
bun install
cd frontend && npm install && cd ..
```

### 2. Configure

Create `.env` in the project root:

```env
PORT=5500
SESSION_SECRET=generate-a-random-secret-here
FRONTEND_URL=http://localhost:5173
BASE_URL=http://localhost:5500
```

That's it. Everything else (email provider, OAuth, tracking) is configured through the Platform Admin UI after first login.

### 3. Run

```bash
# Terminal 1 — Backend
bun run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Backend runs on `http://localhost:5500`, frontend on `http://localhost:5173`.

### 4. Create Platform Admin

```bash
bun scripts/create-admin.ts
```

This creates the invisible platform admin account. Log in and configure the system through **Admin > Platform Settings**.

---

## Documentation

- **[Self-Hosting Guide](docs/SELF-HOSTING.md)** — Docker deploy, environment variables, migrations, backup/restore, and network egress hardening.
- **[Deliverability Guide](docs/DELIVERABILITY.md)** — SPF/DKIM/DMARC, domain verification, IP/domain warmup, suppression, CAN-SPAM, and one-click unsubscribe.
- **API reference** — a running instance serves interactive Swagger UI at **`/docs`** and the raw OpenAPI spec at **`/openapi.yaml`** (source: [`docs/openapi.yaml`](docs/openapi.yaml)).

---

## Email Providers

Dispatch supports 8 email providers. Platform admin configures the system mailer (for transactional emails like password resets and invitations). Users configure their own sending accounts for campaigns.

| Provider | Auth Method | What You Need |
|----------|-------------|---------------|
| **SMTP** | Username/Password | Host, port, credentials |
| **Amazon SES** | IAM API Keys | Access Key ID, Secret Access Key, Region |
| **SendGrid** | API Key | API Key |
| **Mailgun** | API Key | API Key, Domain, Region (US/EU) |
| **Postmark** | Server Token | Server Token |
| **SparkPost** | API Key | API Key |
| **Gmail** | OAuth 2.0 | One-click connect (requires OAuth credentials in platform settings) |
| **Outlook/365** | OAuth 2.0 | One-click connect (requires OAuth credentials in platform settings) |

All API-based providers (SES, SendGrid, Mailgun, Postmark, SparkPost) support domain-level sending — send from any address on your verified domain.

---

## Multi-Organization & Roles

Dispatch is multi-tenant. Each organization has isolated data, members, and settings.

**Roles** (highest to lowest):
- **Owner** — Full control, can transfer ownership
- **Admin** — Manage members, settings, billing
- **Manager** — Manage campaigns, contacts, templates
- **Member** — Send campaigns, view reports
- **Readonly** — View-only access

**Platform Admin** is a separate system-level role, invisible to all organizations. It manages global infrastructure (system mailer, OAuth credentials, tracking setup).

---

## Tracking

Email tracking uses Cloudflare Workers deployed on the sender's own domain:

- **Open tracking** — 1x1 pixel served from `yourdomain.com/o/{id}`
- **Click tracking** — Redirect via `yourdomain.com/c/{id}`
- **Unsubscribe** — Hosted page at `yourdomain.com/u/{id}`

Because tracking runs on the same domain as the sender, it's first-party — not blocked by Brave, Firefox, uBlock Origin, or Outlook's privacy features.

---

## Bounce Handling

Automatic webhook processing for all supported providers. When you save a provider config, Dispatch registers bounce/complaint webhooks with the provider's API automatically.

- **Hard bounces** — Email suppressed permanently
- **Soft bounces** — Tracked, suppressed after 3 failures
- **Spam complaints** — Email suppressed permanently, marked as unsubscribed
- **Unsubscribes** — Processed and respected

---

## Development

```bash
# Backend dev server (hot reload)
bun run dev

# Frontend dev server
cd frontend && npm run dev

# Type check frontend
cd frontend && npx vue-tsc --noEmit

# Build frontend for production
cd frontend && npm run build

# Reset local databases
bun run reset-db

# Deploy tracking worker
cd tracking-worker && npx wrangler deploy
```

---

## Project Structure

```
src/
├── app.ts                          # Entry point
├── config/index.ts                 # Centralized config
├── routes/
│   ├── auth.ts                     # Login, register, password reset
│   ├── send.ts                     # Campaign sending
│   ├── config.ts                   # SMTP/provider config CRUD
│   ├── dashboard.ts                # Stats and overview
│   ├── report.ts                   # Campaign reports
│   ├── oauth.ts                    # Google/Microsoft OAuth flows
│   ├── admin.ts                    # Org management, platform settings
│   ├── webhooks.ts                 # Webhook CRUD + bounce endpoints
│   └── tracking.ts                 # Tracking proxy
├── services/
│   ├── emailService.ts             # Send emails via any provider
│   ├── batchService.ts             # Batch processor (in-memory)
│   ├── schedulerService.ts         # Scheduled job persistence
│   ├── systemMailerService.ts      # Platform-level transactional mailer
│   ├── systemSettingsService.ts    # Key-value settings store
│   ├── oauthService.ts             # OAuth token management
│   ├── bounceProcessor.ts          # Parse bounce webhooks (5 providers)
│   ├── rbacService.ts              # Role-based access control
│   ├── invitationService.ts        # Org invitations with email
│   └── ...
├── middleware/
│   ├── auth.ts                     # Session validation
│   ├── rbac.ts                     # Permission checks
│   ├── csrf.ts                     # CSRF protection
│   └── security.ts                 # Security headers
└── db/
    └── migrations/                 # SQLite schema migrations
```

---

## License

MIT License. See [LICENSE](LICENSE).
