# P2.1b — Identity service swap (sync bun:sqlite → async Drizzle): call-site manifest

Generated from a 7-agent exhaustive audit (2026-06-07). Drives the swap so nothing is missed.
**The swap converts all 4 identity services to async. Every call must be `await`ed.** `tsc` catches
property-access misses (`.foo` on a Promise) but NOT bare truthiness (`if (svc.x())`, `a && b`,
ternary, boolean argument) — those are the CRITICAL hand-fix sites below.

## Order of work (net-first TDD)
1. Net: `tests/integration/identity-auth-rbac.test.ts` — real middleware + real services on PGlite. RED before swap.
2. Rewrite 4 services onto `getDb()` (Drizzle), all async, contracts preserved (snake_case, integer bools, JSON-text).
3. Fix every call site below. `tsc` for property-access misses; hand-fix the truthiness traps.
4. Net GREEN → deliberate-break one await → net RED (proves it catches bypass) → restore.
5. Full suite + tsc + boot against real PG + seed roles at boot.

## CRITICAL — truthiness traps tsc will NOT catch (hand-fix every one)

### middleware/rbac.ts (all enclosing fns already async)
- L19 `if (rbacService.isPlatformAdmin(user.id))` → `if (await ...)`  (requirePermission no-org branch)
- L26/L27 `hasAccess = len===1 ? hasPermission(...) : hasAllPermissions(...)` → `await` both arms
- L61 `if (!rbacService.hasAnyPermission(...))` → `if (!(await ...))`
- L83 `if (!rbacService.isPlatformAdmin(user.id))` → `if (!(await ...))`  (requirePlatformAdmin — protects all /admin/platform/*)
- L104 `if (rbacService.isPlatformAdmin(user.id))` → `if (await ...)`  (requireOrgMember no-org branch)
- L110 `if (!isPlatformAdmin(user.id) && !isMember(user.id, orgId))` → extract both to awaited locals (compound, ×2)

### routes/auth.ts
- L77, L118, L174 ternary `rbacService.getUserRole(...)` → `session.orgId ? await ... : null`
- L208 `if (!isMember(...) && !isPlatformAdmin(...))` → extract both awaited locals (org-switch auth gate, ×2)
- validateSession guards (CRITICAL): L166 (/auth/me, SYNC→async), L204 (/switch-org), L256 validateResetToken (/reset GET, SYNC→async), L292 (/change-password), L318 (/profile PUT), L358 (/profile/username PUT), L375 (/username/suggest, SYNC→async)

### routes/admin.ts (canManageUser role-hierarchy gates — all CRITICAL)
- L596 (change member role), L619 (remove member), L767 (grant perm), L786 (revoke perm), L805 (remove override)
  each `if (!rbacService.canManageUser(...))` → `if (!(await ...))`
- L712 `if (!orgMember)` after `orgService.getMember` → await (gates non-member add to team)

## HIGH — data/correctness (tsc catches most via property access, but await anyway)
- routes/auth.ts: L76/L117/L173 listForUser, L229 createPasswordResetToken, L323 updateProfile, L351 checkUsername, L365 setUsername, L378 suggestUsername, L145 logout, L212 switchOrg
- routes/admin.ts: L71 listAllUsers, L79 listAll, L86 cleanupSessions, L430 checkSlugAvailability, L440 updateSlug, L540 get, L543 getMemberCount, L554 update, L565 getMembers, L575 getUserByEmail, L578 getMember, L582 addMember, L601 updateMemberRole, L624 removeMember, L745 listSystemRoles, L754 getUserRole, L755 getEffectivePermissions, L772 grantPermission, L791 revokePermission, L810 removePermissionOverride; invitation handlers L870/L881/L893/L903/L915/L930/L938 (several SYNC→async)
- utils/oauth.ts: L103/L112/L140/L173/L182 isPlatformAdmin ternary (redirect path only — HIGH not CRITICAL)
- app.ts: L187 validateSession in /api/user/info (SYNC→async)

## Internal cascade (inside the 4 services)
- authLocalService: L37 `orgService.create` (register), L71 `orgService.listForUser` (login) → await
- invitationService: ALL public methods become async (db + cross-service). L34 getUserByEmail, L36 getMember,
  L120 getUser (email-match auth on accept — CRITICAL intent), L126 addMember (the privilege grant) → await
- authLocalService.validateSession & logout & all sync helpers → async

## Handlers that must change SYNC → async (Hono awaits handler return — non-cascading, safe)
routes/auth.ts: /auth/logout (L141), /auth/me (L159), GET /auth/reset-password/:token (L254),
/auth/check-username (L346), /auth/profile/username/suggest (L372)
app.ts: /api/user/info (L181)
routes/admin.ts: platform list/cleanup (L68/L76/L84), org get/members (L538/L563), roles/perms reads (L744/L750),
perm-override DELETE (L799), invitation handlers (L868/L889/L899/L913/L926/L936)

## Completeness
- src: complete. All non-listed files import only `PERMISSIONS` value constant (unaffected).
- tests: only tests/routes/auth.test.ts references services (comment-only, describe.skip) — won't break; stale, rewrite later.
