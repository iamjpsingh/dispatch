# UI/UX Fixes — Progress Tracker

## COMPLETED

### 1. Modal Close Logic
- **File**: `src/components/ui/Modal.vue`
- Pass `showCloseButton` to DialogContent based on `closable` prop
- Added `@escape-key-down` handler that respects `closable`
- Header now only shows for title (close X button is in DialogContent itself)

### 2. Breadcrumbs Visible on Mobile
- **File**: `src/components/layout/MainLayout.vue`
- Removed `hidden md:block` from home breadcrumb and separators
- Breadcrumbs now show on all screen sizes

### 3. Yellow → Amber Color Unification
All `text-yellow-*` / `bg-yellow-*` replaced with `text-amber-*` / `bg-amber-*`:
- **`src/components/contacts/ContactsTable.vue`** — unsubscribed status badge
- **`src/components/ui/badge/index.ts`** — warning variant
- **`src/views/settings/DeliveryServers.vue`** — Postmark provider color
- **`src/components/contacts/ContactTimeline.vue`** — score_changed event color (`#eab308` → `#f59e0b`)
- Zero `text-yellow-*` / `bg-yellow-*` remaining in codebase

### 4. brightness-110 Hover → Proper bg-accent/90
- **`src/views/ResetPasswordView.vue`** — sign-in link
- **`src/views/AcceptInviteView.vue`** — dashboard button + accept button

### 5. Responsive Forms (Mobile)
- **`src/views/settings/DeliveryServers.vue`** — ALL `grid-cols-2` changed to `grid-cols-1 sm:grid-cols-2`
  - SMTP host/port/user/pass
  - SMTP from email/name
  - SES IAM keys
  - API provider from email/name
  - Sending limits (hourly/daily)
- Added SSL/TLS help text: "(enable for port 465, disable for STARTTLS on 587)"

### 6. Contact Detail — Full Page (NEW)
- **Created**: `src/views/ContactDetailView.vue` — full-page contact detail with:
  - Breadcrumb navigation (Dispatch > Contacts > Contact Detail)
  - Header with avatar, name, email, company, status badge, engagement score
  - 4 stat cards: Emails Sent, Open Rate, Click Rate, Campaigns
  - 3 tabs: Overview, Activity, Preferences
  - Overview: contact details card, tags, top clicked links, engagement score circle, best open times chart, recent activity
  - Activity: full ContactTimeline component
  - Preferences: ContactPreferences component
- **Route added** in `src/router/index.ts`:
  - `/contacts/:id` (org users)
  - `/platform/contacts/:id` (platform admin)
- **`src/components/contacts/ContactsTable.vue`** updated:
  - Rows are now clickable (navigates to detail page)
  - Checkbox and action columns have `@click.stop` to prevent navigation
  - Clock icon replaced with Eye icon ("View Details")
- **`src/views/ContactsView.vue`** updated:
  - Removed old timeline modal (RecipientProfile/ContactTimeline/ContactPreferences imports)
  - `openTimeline()` now navigates to `/contacts/:id` instead of opening modal

### 7. ContactTimeline "Load More" Button
- **`src/components/contacts/ContactTimeline.vue`** — replaced plain `<button>` with proper `<Button>` component

---

## REMAINING — Phase 2 (Polish)

### Color/Contrast
- [ ] `src/components/ui/AppTabs.vue` — `bg-white/20 text-white` low contrast on underline variant
- [ ] Audit all `text-white` on light/transparent backgrounds across components
- [ ] Status badge colors: some use `text-amber-500`, some use `text-warning` — unify to one pattern

### Spacing Standardization
- [ ] Inconsistent badge padding (`px-2.5 py-0.5` vs `px-3 py-1` vs `px-2 py-0.5`)
- [ ] Inconsistent gap values (`gap-1.5` vs `gap-2.5` vs `gap-3.5`) across 78+ files
- [ ] Card padding mix (`p-3`, `p-4`, `p-5`) — establish a standard
- [ ] `MainLayout.vue` mobile bottom padding: `pb-20 md:pb-6` (80px→24px jump)

### Dark Mode Gaps
- [ ] Input/Select opacity mismatch: Input uses `dark:bg-input/30`, Select hover uses `dark:bg-input/50`
- [ ] `AppTabs.vue` underline variant doesn't work on dark backgrounds
- [ ] Status badges missing explicit dark mode variants in some files

### Form UX
- [ ] No inline field validation — errors only show as toasts
- [ ] No required field indicators (*) on mandatory fields
- [ ] WhatsApp form missing help text for `phone_number_id` and technical fields

### Button Consistency
- [ ] `AppSidebar.vue` — sidebar buttons use custom classes instead of Button component
- [ ] Missing `focus-visible` states on pagination buttons, tabs, dropdown items
- [ ] Ghost vs secondary button variants used inconsistently for similar actions

---

## REMAINING — Phase 3 (Enhancement)

### Contact Page
- [ ] Add contact filtering (status, tags, score range, list)
- [ ] Add contact export (CSV/Excel)
- [ ] Add inline edit from detail page

### Campaign UX
- [ ] Add date range and type filters to campaign list
- [ ] Add bulk actions (delete, archive) to campaign list

### Navigation
- [ ] Sidebar collapse animation (currently instant width jump, no smooth transition)

### Hardcoded Colors
- [ ] `src/views/CalendarView.vue` — status colors in JS object
- [ ] `src/components/analytics/CampaignBreakdown.vue` — `barColor()` returns hardcoded colors
- [ ] `src/components/contacts/RecipientProfile.vue` — `#6366f1` for best_open_hour
- [ ] `src/components/automation/nodes/BaseNode.vue` — `!bg-green-500` / `!bg-red-500` with important flags

---

## Build Status

Pre-existing TS errors (not from our changes):
- `NodeConfigPanel.vue`, `nodes/index.ts` — unused imports
- `CommandPalette.vue` — unused Clock, type mismatch
- `BottomNav.vue` — unused computed
- `DateRangeSelector.vue` — type mismatch
- `useKeyboardShortcuts.ts` — possibly undefined
- `useUnsavedChanges.ts` — unused watch
- `WhatsAppView.vue` — unused imports, `window` access issue

From our changes (minor, to fix):
- `ContactDetailView.vue` — remove unused imports (Loader2, Pencil, User) ← PARTIALLY FIXED, verify
- `ContactTimeline.vue` — Loader2 unused after removing inline usage
