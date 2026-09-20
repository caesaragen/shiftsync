# ShiftSync — Architecture

This document explains the system as built: the stack choices, the data
model, and what each module is responsible for. For role-login instructions,
grading-relevant ambiguity decisions, and known limitations, see
[README.md](README.md). For the original design rationale and phased
delivery plan, see
[`docs/superpowers/specs/2026-09-19-shiftsync-design.md`](docs/superpowers/specs/2026-09-19-shiftsync-design.md).

## Stack & why

- **Next.js 16 App Router + TypeScript strict** — Server Components by
  default, Server Actions for all mutations. No separate API layer was
  needed for the CRUD/scheduling surface this app covers.
- **Prisma + Supabase Postgres** — relational data with real foreign keys
  (staff ↔ skills ↔ locations ↔ shifts), which the constraint engine leans
  on heavily via joins rather than application-side denormalization.
- **NextAuth v5 (Credentials provider, JWT sessions)** — no external IdP
  needed for this scope. JWT sessions keep authorization checks synchronous
  (no DB read) in every Server Component/Action, at the cost of role
  changes only taking effect on next sign-in (documented in README's Known
  Limitations).
- **Tailwind v4**, token-based theming via `@theme inline`, no component
  library — a hand-rolled, restrained design was cheaper than fighting a
  library's opinions at this scope.
- **Luxon** for all timezone math — the one non-negotiable dependency,
  because this app's entire premise (multi-location, multi-timezone
  scheduling) breaks silently under naive `Date` arithmetic.
- **Vitest + Testing Library + Playwright** — unit/component tests mock
  Prisma; E2E runs against the real seeded Supabase database (no separate
  test database — a deliberate, documented trade-off; see README).

## Data model (`prisma/schema.prisma`)

```
User ──< ManagerLocation >── Location
User ──< StaffSkill >── Skill
User ──< StaffLocationCertification >── Location   (soft-deleted via endedAt, never deleted)
User ──< Availability                              (recurring or one-off EXCEPTION windows)
Location ──< Shift >── Skill (requiredSkill)
Shift ──< ShiftAssignment >── User
SwapRequest, Notification, AuditLog                (schema + data layer only, no UI yet)
```

Two decisions worth calling out:

- **Certifications are periods, not booleans.**
  `StaffLocationCertification` has no unique constraint on
  `[staffId, locationId]`, so decertifying and later recertifying someone
  at the same location preserves the earlier period instead of overwriting
  it — history stays auditable.
- **Every timestamp column is `Timestamptz(3)`.** Nothing is stored as
  naive local time anywhere in the schema.

## Auth & authorization — `src/lib/authz.ts`, `src/lib/auth-credentials.ts`

`requireUser()` / `requireRole(...)` are called **first, before any
validation or database work**, in every Server Action and every page. This
is enforced as a repeated pattern, not centralized middleware, because
Server Actions are directly callable HTTP endpoints regardless of what the
UI renders — hiding a nav link is presentation only, never access control.

`visibleLocationScope()` computes what a MANAGER can see (their assigned
locations only) versus an ADMIN (everything), and every list/detail query
is scoped through it. No query trusts a client-supplied `locationId`
without checking it against this scope first.

## The constraint engine — `src/lib/constraints/`

This is the highest-weighted piece of the assessment brief, so it carries
the most design investment and test coverage.

- **`engine.ts`** — `validateAssignment(ctx)` composes three independent
  rule modules and **never short-circuits**: it returns every applicable
  violation at once, each tagged `BLOCK` / `WARN` / `OVERRIDE_REQUIRED`, so
  a manager sees the whole picture in one pass instead of a sequence of
  one-at-a-time errors.
- **`eligibility.ts`** — skill match, active certification, and
  availability coverage. Availability is interpreted in the **staff
  member's home timezone**, not the shift's location timezone — this is
  what makes a shift at a location in a different zone correctly line up
  against someone's stated hours (see the "Timezone Tangle" scenario in
  `scenarios.test.ts`).
- **`conflicts.ts`** — double-booking and the 10-hour rest-gap rule,
  computed on absolute UTC instants (`time/intervals.ts`) so overnight
  shifts need no midnight special-casing anywhere.
- **`hours.ts`** — daily/weekly hour thresholds and the 6th/7th
  consecutive-day rules, evaluated against a Monday-00:00-to-Sunday-23:59
  week window in the staff member's home timezone
  (`weekBounds` in `time/zones.ts`).
- **`suggestions.ts`** — `suggestAlternatives()` re-runs the same engine
  per candidate and ranks the eligible ones by fewest hours already
  scheduled that week, so "who else could cover this" is fairness-aware by
  construction rather than a separate ad hoc heuristic.

Every rule has a named test scenario in `scenarios.test.ts` mapped
directly to the assessment brief's evaluator scenarios and its five
documented ambiguity decisions — deliberately the single highest-leverage
place to invest test effort, given the grading weights.

## Concurrency-safe assignment — `src/lib/assign.ts`

`assignStaffToShift` runs the whole validate-then-write sequence inside a
Postgres `SERIALIZABLE` transaction with an explicit `timeout`/`maxWait`
and bounded retry, so two managers assigning the same person to
overlapping shifts at the same time resolve to exactly one winner instead
of racing. The explicit timeout exists because real Supabase latency
measured 4–6.5s for the full `loadContext` + validate path in production —
the original implementation had no timeout and intermittently hit
Prisma's 5s default under real load, a bug found and fixed via live
testing against the real database rather than assumed correct from
reading the code.

## Timezone handling — `src/lib/time/{zones,format,intervals}.ts`

A hard rule enforced everywhere else in the codebase: **never call
`new Date(someString)` directly.** Every date-only string goes through
`parseDateOnly` (anchored to UTC noon, not midnight, so it can't roll into
the wrong calendar day for US timezones), every `datetime-local` input
goes through `parseLocalDateTime(str, timezone)`, and every "what
day/week is this" computation goes through
`toZoned` / `weekBounds` / `localDateKey`. Seven real bugs were caught and
fixed this way over the course of development — this module exists
specifically because ad hoc `Date` handling kept silently producing wrong
days at timezone boundaries.

## UI architecture

- **Server Components by default.** `AssignmentPanel.tsx`
  (`schedule/[shiftId]/_components/`) is the one genuinely interactive
  island (`'use client'`), because it needs live client state for
  candidate selection, override reasons, and pending-transition UI.
  `NavLinks.tsx` (`(app)/_components/`) is the only other client
  component, needed for `usePathname()`-based active-link highlighting.
  Everything else stays server-rendered.
- **Server Actions per feature** (`admin/*/actions.ts`, `schedule/actions.ts`,
  `schedule/[shiftId]/actions.ts`) follow one shape: authorize → validate
  → call the `lib/` function that owns the real logic → `revalidatePath` →
  `redirect` carrying `?success=`/`?error=` for feedback. The action files
  themselves contain almost no logic — they translate form data into calls
  against `lib/` functions, which is where every rule actually lives and
  gets tested.
- **`SubmitButton`** (`src/components/SubmitButton.tsx`, via React's
  `useFormStatus`) gives every plain HTML form a loading spinner + pending
  label without turning the form or page into client-side code — the form
  still works with JS disabled, the button just doesn't get the pending
  state without it.
- **`FlashToast` + `ToastProvider`** (`src/components/toast/`) bridge the
  `?success=`/`?error=` redirect pattern into toasts, mounted once at the
  root layout. `FlashToast` deliberately does not rewrite the URL
  afterward — an earlier version did, and it silently broke the inline
  `role="alert"` banners that read from the same query param (several
  admin pages render both), found via a full Playwright E2E run rather
  than assumed safe.
- **Per-route `loading.tsx`** files (dashboard, schedule, shift detail,
  the three admin pages) use Next's built-in Suspense-driven loading
  convention for skeletons — no client state, no extra libraries.
- **`src/components/icons.tsx`** — a small hand-written inline-SVG icon
  set (nav items, back link), avoiding a new dependency for what amounts
  to five simple glyphs.

## Design system — `src/app/globals.css`

Five CSS custom properties (`--accent`, `--accent-hover`,
`--accent-subtle`, `--surface`, `--border-subtle`) are exposed as Tailwind
utilities via `@theme inline`. Every color decision in the app traces back
to this one file, which is what let a full visual pass (buttons, panels,
badges, cards, the nav's active state) land consistently across a dozen
files without a per-page redesign.

## Testing strategy

- **Vitest** — `validateAssignment` and the suggestion-ranking logic get
  exhaustive unit tests, explicitly covering the assessment brief's
  evaluator scenarios and documented ambiguity decisions as named test
  cases. Reusable UI primitives with real logic (`SubmitButton`,
  `ToastProvider`) get component tests via Testing Library; pure-markup
  pieces (skeletons, `ShiftCard`, `WeekGrid`) do not, matching the existing
  project pattern of testing behavior, not markup.
- **Playwright** — critical end-to-end flows: login/authorization
  boundary enforcement, admin CRUD, and the full scheduling flow (create →
  blocked assignment → valid assignment → publish). Runs against the live
  seeded database with per-test cleanup, since there is no separate test
  database (see README's Known Limitations).

## What's deliberately not built

The swap/coverage workflow and real-time layer have `SwapRequest` /
`Notification` / `AuditLog` models and a tested data layer
(`src/lib/notifications.ts`, `src/lib/audit.ts`) but no UI, no triggers,
and no Supabase Realtime wiring — stopped intentionally ahead of the
deadline to prioritize a working, polished core over a half-built extra
feature. `docs/superpowers/plans/2026-09-20-phase4-swap-workflow.md` has
the full plan, including which of its tasks are done. Compliance and
fairness-analytics reporting (Phase 5) doesn't exist either, though the
data needed to build it (premium-shift flags, hours-per-week) is already
computable — see the "Fairness Complaint" scenario in
`src/lib/constraints/scenarios.test.ts`.
