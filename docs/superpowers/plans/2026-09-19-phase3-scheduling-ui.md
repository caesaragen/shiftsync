# ShiftSync Phase 3: Scheduling UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a manager-facing scheduling interface on top of Phase 2's constraint engine — creating shifts, assigning staff with live constraint feedback, and publishing a week — so the engine's correctness becomes something an evaluator can *see and exercise*, not just read tests about.

**Architecture:** Server Components render the week view and shift detail; Server Actions perform mutations, each authorizing first via `requireRole`. Assignment goes through Phase 2's `assignStaffToShift`, and blocked attempts render the engine's `Violation[]` messages verbatim alongside `suggestAlternatives` output. No client-side rule logic — the server is the only authority.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, Prisma, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-19-shiftsync-design.md](../specs/2026-09-19-shiftsync-design.md)

**Why this phase is worth more than its scope suggests:** the constraint engine is currently invisible to anyone using the deployed app. An evaluator who tests by clicking sees admin CRUD and a dashboard — not the timezone reasoning, the violation messages, or the concurrency safety. This phase converts work already done into work that can be observed, and it is where the separately-graded "user experience and clarity of feedback" criterion is actually won.

## Global Constraints

- TypeScript only, `strict: true`, no `any` without an explicit inline justification comment.
- **Server Components by default**; `'use client'` only where interactivity genuinely requires it.
- **Every Server Action calls its role check FIRST, outside any try/catch.** `redirect()` throws; swallowing it fails open. Server Actions are public HTTP endpoints regardless of what the UI renders.
- Every Prisma `DateTime` is `@db.Timestamptz(3)`; `Availability.date` stays `@db.Date`.
- All instants stored/compared as UTC. **Times are displayed in the shift's location timezone**, labelled, with the label derived (never hardcoded) — reuse `src/lib/time/format.ts`.
- TDD; tests verify real behavior.
- Files small and single-responsibility (~150–200 lines is the split signal).
- Conventional Commits. Never commit to `main` directly.
- `npm run lint` must end at **0 errors and 0 warnings**.
- Verification order: `npm test`, then `npm run build`, then `npx tsc --noEmit` (Next generates route types tsc needs), then `npm run lint`.
- Do NOT run `prisma migrate reset` — it drops the live shared database.
- CI is manual-trigger only (GitHub Actions is billing-locked on this account); local checks are the gate.

## Carried-forward context

- `src/lib/authz.ts` — `requireUser`, `requireRole`, `visibleLocationScope` → `{scope:"all"}|{scope:"ids";ids}`, `canSeeLocation`, `assertCanManageLocation`, `ForbiddenError`, `SessionUser`.
- `src/lib/constraints/engine.ts` — `validateAssignment(ctx)` → `{allowed, requiresOverride, violations}`; `loadContext(staffId, shiftId, tx?)`.
- `src/lib/constraints/suggestions.ts` — `suggestAlternatives(shiftId, excludeStaffId?)`, ranked by fewest hours that week.
- `src/lib/assign.ts` — `assignStaffToShift`, `AssignmentBlockedError` (carries `violations`), `AssignmentConflictError`, SERIALIZABLE + bounded retry.
- `src/lib/constraints/types.ts` — `Severity` (`BLOCK|WARN|OVERRIDE_REQUIRED`), `Violation` (`{rule, severity, message}`), `EngineContext`.
- Rule ids are a stable contract shared with this UI: `SKILL_MISMATCH`, `NOT_CERTIFIED`, `UNAVAILABLE`, `DOUBLE_BOOKING`, `REST_GAP`, `DAILY_HOURS_WARN`, `DAILY_HOURS_BLOCK`, `WEEKLY_HOURS_WARN`, `SIXTH_CONSECUTIVE_DAY`, `SEVENTH_CONSECUTIVE_DAY`.
- Existing UI: `src/app/(app)/layout.tsx` (nav + sign-out), `dashboard/page.tsx` (role-aware), `admin/{locations,skills,staff}`. Match their restrained visual language.
- Seed: 4 locations across 2 timezones, 4 skills, 1 admin, 2 managers, 7 staff, availability, a demo week of shifts (incl. overnight and premium), existing assignments.

## Design decisions this phase locks in

1. **The week view is scoped per location**, with a location picker limited to what `visibleLocationScope` allows. A cross-location "everything" view is a Phase 5 analytics concern, not a scheduling surface.
2. **Publishing is per location per week** — a `DRAFT`→`PUBLISHED` bulk transition over the shifts in that location/week window. There is no separate `Schedule` entity (spec §3).
3. **The 48-hour cutoff blocks editing or unpublishing a PUBLISHED shift** whose `startAt` is less than 48 hours away. Creating and editing DRAFT shifts is always allowed. The cutoff is configurable via a single exported constant, not scattered literals.
4. **Warnings never block.** A `WARN` is shown but the manager may proceed; a `BLOCK` prevents the write; `OVERRIDE_REQUIRED` demands a typed reason. This mirrors the engine and must not be re-decided in the UI.
5. **Validation feedback is server-rendered**, obtained from the same `validateAssignment` the write path uses. The UI never re-implements a rule — if the displayed verdict and the write verdict could ever disagree, that is a defect.

---

## File Structure

```
src/lib/
  shifts.ts            shifts.test.ts       # create/list/update, publish/unpublish, cutoff
  constraints/
    suggestions.ts                          # MODIFIED: N+1 fix
    engine.ts                               # MODIFIED: bounded history window
src/app/(app)/schedule/
  page.tsx                                  # week view: location + week picker
  actions.ts                                # create shift, publish/unpublish week
  [shiftId]/page.tsx                        # shift detail: roster + assignment panel
  [shiftId]/actions.ts                      # assign / unassign / override
  _components/
    WeekGrid.tsx                            # day columns, shift cards
    ShiftCard.tsx
    AssignmentPanel.tsx                     # eligible staff, violations, suggestions
    ViolationList.tsx  ViolationList.test.tsx
e2e/
  scheduling.spec.ts                        # create -> assign -> blocked -> publish
```

---

### Task 1: Performance fixes from the Phase 2 review

Do this first: Phase 3 makes both paths user-facing, and an interactive screen is where the cost becomes visible.

**Files:** Modify `src/lib/constraints/suggestions.ts`, `src/lib/constraints/engine.ts`, and their tests.

- [ ] **Step 1: Fix the N+1 in `suggestAlternatives`**

It currently bulk-fetches candidate staff, skills and assignments, then loops calling `await loadContext(staffId, shiftId)` per candidate — re-querying shift, user, location, skill, staffSkill, certification and assignment rows for each, almost all duplicating data already in memory. On a location with dozens of certified staff that is hundreds of sequential round trips to answer one "who can cover this?" request — which is the brief's own "Sunday Night Chaos" scenario, the one an evaluator is most likely to time.

Build each candidate's `EngineContext` from the already-fetched bulk data instead of re-querying. Keep the rule evaluation identical — reuse `validateAssignment`; do not fork the rule logic.

- [ ] **Step 2: Add a regression test that would catch it coming back**

Assert the number of Prisma calls does not scale with candidate count: with N candidates the query count must stay constant. No existing test asserts call counts, which is why this was invisible. Use `toHaveBeenCalledTimes` against the mocked client.

- [ ] **Step 3: Bound the assignment-history query**

`loadContext` loads a staff member's *entire* assignment history on every validation, but the rules only need a trailing window: the 10-hour rest gap, daily and weekly totals, and the 7-day consecutive streak all fall inside roughly 9 days either side of the candidate shift. Add a date-range filter around the candidate shift's `startAt`.

Choose the window deliberately and comment *why* — it must be wide enough that the 7-consecutive-day rule and the Monday-start week window are both fully covered even when the shift sits at a week boundary. Being too narrow silently under-reports violations, which is far worse than being slightly wide.

- [ ] **Step 4: Prove the window is wide enough**

Add a test where a relevant assignment sits at the far edge of the window (e.g. the 7th consecutive day, or the first day of the week when the shift is on the last) and confirm the rule still fires. A test that only checks the happy path would not catch a too-narrow window.

- [ ] **Step 5: Verify and commit**

Full suite green, then `git commit -m "perf: remove N+1 in suggestions and bound assignment history window"`.

---

### Task 2: Shift data layer

**Files:** Create `src/lib/shifts.ts` + test.

**Interfaces produced** — the UI tasks depend on these exact names:

```ts
export const EDIT_CUTOFF_HOURS = 48;

export type ShiftWithDetail = Shift & {
  location: Location; requiredSkill: Skill;
  assignments: (ShiftAssignment & { staff: User })[];
};

export function isPremiumShift(startAt: Date, locationTimeZone: string): boolean;
export function isWithinEditCutoff(shift: {status: ShiftStatus; startAt: Date}, now: Date): boolean;

export async function listWeekShifts(user: SessionUser, locationId: string, weekOf: Date): Promise<ShiftWithDetail[]>;
export async function getShift(user: SessionUser, shiftId: string): Promise<ShiftWithDetail>;
export async function createShift(user: SessionUser, input: {
  locationId: string; startAt: Date; endAt: Date; requiredSkillId: string; headcount: number; notes?: string;
}): Promise<Shift>;
export async function publishWeek(user: SessionUser, locationId: string, weekOf: Date): Promise<{count: number}>;
export async function unpublishWeek(user: SessionUser, locationId: string, weekOf: Date): Promise<{count: number}>;
```

Behavior that matters:
- Every function calls `assertCanManageLocation` (or filters by `visibleLocationScope`) — a manager must not read or mutate another location's schedule. Authorization lives here as well as in the actions; the data layer is not a trusted caller.
- `createShift` rejects `endAt <= startAt`, a headcount below 1, and a skill or location that doesn't exist — before any write.
- **An overnight shift is valid**: `endAt` on the following calendar date is normal, not an error. Do not "helpfully" reject it.
- `isPremiumShift` = Friday or Saturday, starting at or after 17:00, **in the location's timezone** (the locked Phase 2 decision) — reuse `src/lib/time/zones.ts`, don't re-derive.
- `unpublishWeek` and any edit path refuse when `isWithinEditCutoff` is true, with a clear error naming the cutoff.

- [ ] **Steps:** write failing tests (cover the cutoff boundary at exactly 48 hours on both sides, the overnight case, the authorization refusal, and premium detection in both timezones) → run → implement → green → commit.

---

### Task 3: Week schedule view

**Files:** Create `src/app/(app)/schedule/page.tsx`, `actions.ts`, `_components/WeekGrid.tsx`, `_components/ShiftCard.tsx`.

- Location picker limited to `visibleLocationScope`; week picker defaulting to the current week (Monday-start, per Phase 2).
- Seven day columns. Each shift card shows time **in the location's timezone with a derived label**, the required skill, and filled-vs-required headcount (e.g. "2/3 assigned"), visually distinguishing understaffed shifts and `DRAFT` from `PUBLISHED`.
- A "Create shift" form (Server Action) and a "Publish week" / "Unpublish week" control that surfaces the cutoff error when refused.
- Premium shifts are marked — it's a Phase 5 fairness input and cheap to surface now.
- An overnight shift must render sensibly (it belongs to the day it starts; say that it ends next day rather than drawing it twice).

Restrained styling per CLAUDE.md: hierarchy through type and spacing, real `<label>`s, visible focus states, no gradients or animation.

- [ ] **Steps:** build → verify manually against seeded data in both an Eastern and a Pacific location → commit.

---

### Task 4: Shift detail and the assignment panel — the heart of this phase

**Files:** Create `src/app/(app)/schedule/[shiftId]/page.tsx`, `actions.ts`, `_components/AssignmentPanel.tsx`, `_components/ViolationList.tsx` + test.

This is where the engine becomes visible. Get it right.

- The page shows the shift, its current roster, and a panel of candidate staff.
- For each candidate, run `validateAssignment` server-side and show the verdict **before** the manager commits: assignable / assignable-with-warnings / blocked, with the engine's own `message` text rendered verbatim. Do not paraphrase the messages — they were written to be actionable and were graded on that.
- `ViolationList` renders violations grouped by severity with distinct, accessible treatment (not colour alone — pair it with text or an icon, and give warnings and blocks different roles/labels so a screen reader distinguishes them).
- Assigning calls `assignStaffToShift`. On `AssignmentBlockedError`, render the carried violations **and** `suggestAlternatives` output — "Sarah is unavailable, but John and Maria have the required skill and availability" is the brief's own example of the behavior being graded.
- On `AssignmentConflictError` (someone else won the race), show a clear "this changed while you were looking — refresh" message rather than a generic failure. This is the visible half of the concurrency work.
- `OVERRIDE_REQUIRED` (7th consecutive day) presents a required free-text reason field; submitting without it must fail server-side, not just be disabled in the DOM.
- Unassign is available subject to the same cutoff rule.

- [ ] **Steps:** component test for `ViolationList` (severity grouping, verbatim message text, accessible distinction) → build the page and actions → manual verification of all four outcomes (clean, warning, blocked-with-suggestions, override) → commit.

---

### Task 5: End-to-end coverage

**Files:** Create `e2e/scheduling.spec.ts`.

Cover the manager's real path: sign in as a seeded manager → open the week for a location they manage → create a shift → attempt an assignment that is **blocked** and see the violation message and suggestions → make a valid assignment → publish the week.

Also assert a manager **cannot** open the schedule for a location they don't manage.

**Operational constraint:** E2E runs against the live shared database and there is still no test-database isolation. Anything this spec creates it must clean up afterward, keyed on a unique per-run identifier, in a hook that runs even when assertions fail (the pattern already established in `e2e/admin-crud.spec.ts`). Do not mutate seeded users, locations, skills or certifications.

- [ ] **Steps:** write → run → iterate until genuinely green → confirm the database is left as found → commit.

---

### Task 6: Documentation

**Files:** Modify `README.md`.

- Update status: scheduling UI exists; say plainly what a reviewer can now do in the deployed app and which seeded accounts to use for it.
- Add the three design decisions this phase locked in (per-location week view, per-location-per-week publishing, the 48-hour cutoff semantics).
- Update Known limitations: swaps, notifications, real-time and analytics remain unbuilt; E2E still shares the production database.

- [ ] **Steps:** write → verify every claim is actually true in the deployed app → commit.

---

## Self-Review Notes

- **Spec coverage:** implements spec §"Shift Scheduling" (create, assign, publish, unpublish with cutoff) and the constraint-feedback requirements ("clearly explain which rule was broken and why", "suggest alternatives when possible"). Swaps, notifications, real-time, fairness analytics and the audit trail remain later phases.
- **Deliberately not built:** staff self-service availability editing (staff currently have availability only via seed), and the overtime cost dashboard — both are better placed with their own phases.
- **Risk to watch:** the UI must never re-implement a rule. Every verdict shown must come from `validateAssignment`, so the preview and the write can never disagree.
