# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Dispatch

Open-source bulk email campaign platform with tracking, multi-provider support, and batch processing.

R1 — TypeScript only
Write TypeScript, never plain JavaScript. Every source file is .ts / .tsx. No untyped escape hatches — any only as a last resort, with a stated reason.

R2 — Everything is data-driven; no hardcoded values
All user-facing categories, labels, options, and configuration come from the database and are read at runtime — never hardcoded as constants, enums, unions, or fixed object shapes. Render whatever the data contains. (This governs the user's content; program structure — types, schemas, handlers — is of course code.)

R3 — Use shadcn primitives; never build your own
Build UI only from shadcn primitives. Never hand-roll an element styled to mimic one. If a primitive you need isn't installed yet, install it via the shadcn CLI and use it — never recreate it. If shadcn has no such primitive, compose a feature component entirely from existing shadcn primitives; never write raw styled HTML and css from scratch. Plain layout <div>s (flex / grid / spacing) are fine.

R4 — Schema changes via generated migrations only
Change the schema only in the Drizzle schema file, then generate the migration with bunx drizzle-kit generate from apps/api/. Never hand-write or hand-edit a migration.

R5 — Prove it before "done"
After any non-trivial change, run AT LEAST:

bun typecheck (all packages clean)
bun lint (clean — 200-LOC cap on enforced)
Only after all pass may you claim a task complete.

R6 — No fabrication
When the user says "yesterday we built X" and you can't find X via git log + grep, say so plainly and ask. Don't invent a backstory or a fake apology.

R7 — Simplicity first
Minimum code that solves the task. No speculative abstractions, no configurability that wasn't asked for, no error handling for impossible states. If a senior engineer would call it overcomplicated, simplify. One-use logic stays inline.

R8 — Surgical changes
Touch only what the task requires. Don't refactor, reformat, or "improve" adjacent code that isn't broken; match existing style even if you'd do it differently. Remove only the imports/vars YOUR change orphaned; flag pre-existing dead code — don't delete it unprompted.

R9 — Security is structural and server-side
Scope every data read/write to its owner / tenant. Never trust a client-supplied identity (owner, tenant, or role) — derive it server-side from the authenticated session or the persisted row.
Secrets (provider / API keys, tokens, signing keys) live server-side only, encrypted at rest, never returned to the browser.
Validate inputs at every boundary (Zod).
Follow the platform's multi-tenant isolation model (tenant scoping, roles, super-admin) in the design docs (see Orientation) for any tenant-scoped or platform work.
