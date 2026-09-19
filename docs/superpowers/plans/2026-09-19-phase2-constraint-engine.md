# ShiftSync Phase 2: Shifts, Availability & the Constraint Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scheduling data model and the constraint engine that decides whether a staff member may be assigned to a shift — the single highest-weighted piece of this assessment — with exhaustive tests and concurrency-safe writes.

**Architecture:** Three new Prisma models (`Availability`, `Shift`, `ShiftAssignment`). A layer of pure time utilities (no I/O, trivially testable) underneath a constraint engine that returns structured violations plus ranked alternative-staff suggestions. Assignment writes run inside a `SERIALIZABLE` transaction that re-validates before committing, so two managers racing on the same person cannot both win.

**Tech Stack:** TypeScript strict, Prisma 6.19.3 + Supabase Postgres, Luxon for IANA timezone arithmetic, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-19-shiftsync-design.md](../specs/2026-09-19-shiftsync-design.md)

**Scope note:** this phase is deliberately headless — schema, engine, and tests, no UI. Phase 3 builds the scheduling screens on top (shift CRUD, assignment with violation feedback, publish/unpublish with the 48-hour cutoff). The engine is where the marks are and it is provable without a single React component; keeping the UI out keeps this phase reviewable.

## Global Constraints

- TypeScript only, `strict: true`, no `any` without an explicit inline justification comment.
- **Every Prisma `DateTime` field MUST carry `@db.Timestamptz(3)`.** Prisma's default maps to zone-less `timestamp`, violating spec §3. Two prior phases each needed a corrective migration for this — check the generated SQL before committing.
- All instants are stored and compared as UTC. Local-time reasoning happens only at the edges, via an explicit IANA zone.
- TDD (red → green → refactor); tests committed with the code.
- Conventional Commits; never commit to `main`.
- Files stay small and single-responsibility (~150–200 lines is the split signal). The engine in particular must be decomposed into individually-testable rules, not one long function.
- Do NOT use `prisma migrate reset` — it drops the schema on the live shared database.
- CI is manual-trigger only (the account cannot run Actions); the same checks run locally: `npm run lint && npm test && npm run build && npx tsc --noEmit`, in that order — `tsc` must follow `build` because Next generates route types it depends on.

## Carried-forward context

- Models: `User` (id, name, email, passwordHash, role, homeTimezone), `Role` = ADMIN|MANAGER|STAFF, `Location` (name, timezone, address?), `Skill` (name @unique), `ManagerLocation`, `StaffSkill`, `StaffLocationCertification` (staffId, locationId, certifiedAt, `endedAt` nullable — **certification is modelled as PERIODS**, multiple rows per pair over time; "currently certified" means a row with `endedAt IS NULL`).
- `src/lib/authz.ts`: `requireUser`, `requireRole`, `visibleLocationScope` → `{scope:"all"}|{scope:"ids";ids}`, `canSeeLocation`, `assertCanManageLocation`, `ForbiddenError`, `SessionUser`.
- `src/lib/prisma.ts` (singleton), `src/lib/locations.ts`, `src/lib/skills.ts`, `src/lib/staff-assignments.ts`.
- Seed: 4 locations across 2 timezones (Harbor Point + Bayside in `America/New_York`; Pier 39 + Sunset Grill in `America/Los_Angeles`), 4 skills, 1 admin, 2 managers, 7 staff. **"Jordan Tangle" is certified at Harbor Point (ET) and Pier 39 (PT)** — the brief's "Timezone Tangle" case. "Riley Bartender" has one ended certification at Harbor Point.
- Test pattern: stub ONLY the Prisma boundary; keep real logic real. Assert on query *shape* (`where`/`include`), not just returned values — a value-only assertion cannot catch a dropped filter.

## Design decisions this phase locks in

These resolve ambiguities the brief leaves open. Document them in the README as part of Task 9.

1. **Week boundary for overtime and fairness: Monday 00:00 through Sunday 23:59**, evaluated in the staff member's `homeTimezone`. The brief doesn't specify; Monday-start matches ISO 8601.
2. **Availability is interpreted in the staff member's `homeTimezone`** (spec §5). A shift at a location in another zone is converted into that zone before being compared to availability windows. This is what makes "9am–5pm" mean one thing for a person certified in two zones.
3. **Consecutive-day counting: a day counts as worked if any assignment *starts* on that calendar date in the staff member's `homeTimezone`, regardless of shift length** (spec §5 decision 3). A 1-hour shift and an 11-hour shift count identically; duration is governed separately by the hour rules.
4. **Overnight shifts are a single row** with `endAt` on the following calendar date. No special-casing: every comparison is between absolute UTC instants.
5. **Premium shifts** are those starting Friday or Saturday at or after 17:00 **in the location's timezone** (not the staff member's) — it is a property of the shift, used by Phase 5's fairness analytics.

---

## File Structure

```
prisma/
  schema.prisma                        # + Availability, Shift, ShiftAssignment
  seed.ts                              # + availability windows, shifts incl. deliberate conflicts
src/lib/
  time/
    zones.ts        zones.test.ts      # UTC <-> zoned conversion, week bounds, calendar days
    intervals.ts    intervals.test.ts  # overlap, gap-between, duration — pure interval math
  availability.ts   availability.test.ts   # recurring + exception matching, DST-safe
  shifts.ts         shifts.test.ts         # shift queries/creation, premium computation
  constraints/
    types.ts                           # Violation, Severity, ValidationResult, EngineContext
    eligibility.ts  eligibility.test.ts    # skill, certification, availability
    conflicts.ts    conflicts.test.ts      # double-booking, 10-hour rest gap
    hours.ts        hours.test.ts          # daily/weekly hours, consecutive days
    engine.ts       engine.test.ts         # composes the rules; validateAssignment
    suggestions.ts  suggestions.test.ts    # ranked alternative staff
  assign.ts         assign.test.ts     # SERIALIZABLE transaction + retry + conflict error
src/lib/constraints/
  scenarios.test.ts                    # the brief's 6 evaluation scenarios, end to end
```

---

### Task 1: Scheduling schema + migration

**Files:** Modify `prisma/schema.prisma`; generated migration directory.

**Interfaces produced** — every later task and all of Phase 3 depends on these exact names:

- `Availability`: `id, staffId, kind (RECURRING|EXCEPTION), dayOfWeek Int?, date DateTime?, startMinutes Int, endMinutes Int, isAvailable Boolean, createdAt, updatedAt`
- `Shift`: `id, locationId, startAt, endAt, requiredSkillId, headcount Int, status (DRAFT|PUBLISHED), notes String?, createdById, createdAt, updatedAt`
- `ShiftAssignment`: `id, shiftId, staffId, assignedById, assignedAt, overrideReason String?, createdAt, updatedAt`

- [ ] **Step 1: Add the enums and models**

```prisma
enum AvailabilityKind {
  RECURRING
  EXCEPTION
}

enum ShiftStatus {
  DRAFT
  PUBLISHED
}

model Availability {
  id           String           @id @default(cuid())
  staffId      String
  kind         AvailabilityKind
  dayOfWeek    Int?             // 1=Monday .. 7=Sunday, RECURRING only
  date         DateTime?        @db.Date   // EXCEPTION only; a calendar date in the staff member's homeTimezone
  startMinutes Int              // minutes from local midnight, 0..1440
  endMinutes   Int              // exclusive; may exceed 1440 to express a window crossing midnight
  isAvailable  Boolean          @default(true)
  createdAt    DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime         @updatedAt @db.Timestamptz(3)

  staff User @relation(fields: [staffId], references: [id], onDelete: Cascade)

  @@index([staffId, kind])
}

model Shift {
  id              String      @id @default(cuid())
  locationId      String
  startAt         DateTime    @db.Timestamptz(3)
  endAt           DateTime    @db.Timestamptz(3)
  requiredSkillId String
  headcount       Int         @default(1)
  status          ShiftStatus @default(DRAFT)
  notes           String?
  createdById     String
  createdAt       DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime    @updatedAt @db.Timestamptz(3)

  location      Location          @relation(fields: [locationId], references: [id], onDelete: Cascade)
  requiredSkill Skill             @relation(fields: [requiredSkillId], references: [id])
  createdBy     User              @relation("ShiftCreatedBy", fields: [createdById], references: [id])
  assignments   ShiftAssignment[]

  @@index([locationId, startAt])
  @@index([startAt])
}

model ShiftAssignment {
  id             String   @id @default(cuid())
  shiftId        String
  staffId        String
  assignedById   String
  assignedAt     DateTime @default(now()) @db.Timestamptz(3)
  overrideReason String?
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt @db.Timestamptz(3)

  shift      Shift @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  staff      User  @relation("AssignmentStaff", fields: [staffId], references: [id], onDelete: Cascade)
  assignedBy User  @relation("AssignmentAssignedBy", fields: [assignedById], references: [id])

  @@unique([shiftId, staffId])
  @@index([staffId, shiftId])
}
```

`@@unique([shiftId, staffId])` is deliberate and load-bearing: it is the database-level backstop that makes assigning the same person to the same shift twice impossible even under a race. It is NOT the same as the double-booking rule (which spans *different* shifts) — both are needed.

`Availability.endMinutes` may exceed 1440 so a window like 22:00–02:00 is one row rather than two. Task 3's matcher must handle that.

- [ ] **Step 2: Add back-relations to `User`, `Location`, `Skill`**

On `User`: `availability Availability[]`, `shiftsCreated Shift[] @relation("ShiftCreatedBy")`, `assignments ShiftAssignment[] @relation("AssignmentStaff")`, `assignmentsMade ShiftAssignment[] @relation("AssignmentAssignedBy")`.
On `Location`: `shifts Shift[]`. On `Skill`: `shifts Shift[]`.

- [ ] **Step 3: Migrate**

```bash
npx prisma migrate dev --name scheduling_model
```

- [ ] **Step 4: Verify timestamptz**

```bash
grep -i "TIMESTAMP" prisma/migrations/*_scheduling_model/migration.sql
```
Every instant column must read `TIMESTAMPTZ(3)`. `Availability.date` is the one deliberate exception — it is `DATE` (a calendar date, not an instant). Paste the output in your report.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add availability, shift and assignment models"
```

---

### Task 2: Pure time utilities

Everything downstream depends on these being right. They are pure functions — no database, no clock reads except what is passed in — so they can be tested exhaustively and fast.

**Files:** Create `src/lib/time/zones.ts` + test, `src/lib/time/intervals.ts` + test.

**Interfaces produced:**

```ts
// zones.ts
export function toZoned(instant: Date, timeZone: string): DateTime;       // Luxon DateTime
export function localDateKey(instant: Date, timeZone: string): string;    // "2026-03-08"
export function minutesSinceLocalMidnight(instant: Date, timeZone: string): number;
export function weekBounds(instant: Date, timeZone: string): { start: Date; end: Date };  // Mon 00:00 .. Sun 24:00, as UTC instants
export function addLocalDays(instant: Date, timeZone: string, days: number): Date;

// intervals.ts
export type Interval = { start: Date; end: Date };
export function overlaps(a: Interval, b: Interval): boolean;   // half-open: touching ends do NOT overlap
export function gapMinutes(a: Interval, b: Interval): number;  // 0 if they overlap; else minutes between nearest edges
export function durationHours(i: Interval): number;
```

- [ ] **Step 1: Install Luxon**

```bash
npm install luxon
npm install --save-dev @types/luxon
```

- [ ] **Step 2: Write the failing tests**

Cover at minimum:
- `overlaps`: identical intervals; partial overlap; containment; **abutting intervals (a.end === b.start) must be FALSE** — a shift ending at 17:00 and another starting at 17:00 are not a double-booking; back-to-back is legal, and getting this wrong makes every contiguous schedule unassignable.
- `gapMinutes`: 10 hours exactly; 9h59m; overlapping returns 0; order-independent (b before a gives the same answer).
- `durationHours`: a 4-hour shift; an overnight 23:00→03:00 shift is 4 hours, not −20.
- `weekBounds`: a Wednesday resolves to that Monday 00:00 local → the following Monday 00:00 local, expressed as UTC instants; a Monday resolves to itself; a Sunday resolves to the *preceding* Monday.
- `localDateKey` / `minutesSinceLocalMidnight`: the same UTC instant yields different dates/minutes in `America/New_York` vs `America/Los_Angeles`.
- **DST, which is where this class of code actually breaks.** Use real transitions: 2026-03-08 (US spring forward, 02:00→03:00) and 2026-11-01 (fall back). Assert that a week containing a transition still spans 7 local days; that `minutesSinceLocalMidnight` is correct on both sides; and that `addLocalDays` across a transition lands on the same local wall-clock time, not shifted by an hour.

- [ ] **Step 3: Run and watch them FAIL**

- [ ] **Step 4: Implement both modules using Luxon**

Use `DateTime.fromJSDate(instant, { zone })`. Never hand-roll offset arithmetic; never use `setHours` on a `Date` for zoned logic.

- [ ] **Step 5: Run green, then commit**

```bash
git commit -m "feat: add timezone-aware time and interval utilities"
```

---

### Task 3: Availability matching

**Files:** Create `src/lib/availability.ts` + test.

**Interfaces produced:**

```ts
export type AvailabilityWindow = { startMinutes: number; endMinutes: number; isAvailable: boolean };
export function isStaffAvailable(
  rows: Availability[],      // the staff member's rows, both kinds
  shift: { startAt: Date; endAt: Date },
  homeTimeZone: string,
): { available: boolean; reason?: string };
```

**Semantics to implement:**
- The shift is converted into `homeTimeZone`, then compared to windows expressed in local minutes.
- An EXCEPTION row for the shift's local date **overrides** all RECURRING rows for that date — whether it grants (`isAvailable: true`) or denies (`isAvailable: false`) availability. This is what makes one-off changes work.
- The staff member must be available for the **entire** shift, not merely its start. A shift 16:00–22:00 against a 09:00–17:00 window is NOT available.
- A shift spanning local midnight must be checked against both days' windows, honouring `endMinutes > 1440` windows.
- No matching window at all means unavailable (fail closed).

- [ ] **Step 1: Write the failing tests**

Include: fully inside a window; starting before a window; ending after a window; exactly matching a window's bounds (must be available); an EXCEPTION granting availability on a day with no recurring window; an EXCEPTION denying availability on a day that has a recurring window; an overnight shift against a `22:00–02:00` (endMinutes 1560) window; **the Timezone Tangle** — a staff member with `homeTimezone: America/New_York` and a 09:00–17:00 window, assigned to a shift at a Pacific location that runs 09:00–17:00 *Pacific* (= 12:00–20:00 Eastern), must be UNAVAILABLE, and the returned `reason` must say so intelligibly.

- [ ] **Step 2: Run and watch FAIL. Step 3: Implement. Step 4: Run green.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add timezone-aware availability matching"
```

---

### Task 4: Constraint types + eligibility rules

**Files:** Create `src/lib/constraints/types.ts`, `src/lib/constraints/eligibility.ts` + test.

**Interfaces produced — every later task and all of Phase 3's UI depends on these:**

```ts
export type Severity = "BLOCK" | "WARN" | "OVERRIDE_REQUIRED";

export type Violation = {
  rule: string;        // stable machine-readable id, e.g. "DOUBLE_BOOKING"
  severity: Severity;
  message: string;     // human explanation naming the SPECIFIC conflict, not a generic phrase
};

export type EngineContext = {
  staff: { id: string; name: string; homeTimezone: string };
  shift: { id: string; locationId: string; startAt: Date; endAt: Date; requiredSkillId: string };
  skillIds: string[];                 // staff's skills
  activeCertificationLocationIds: string[];   // endedAt IS NULL only
  availability: Availability[];
  existingAssignments: { shiftId: string; startAt: Date; endAt: Date; locationId: string }[]; // other shifts, excluding this one
};

export function checkEligibility(ctx: EngineContext): Violation[];
```

`checkEligibility` emits, all `BLOCK`:
- `SKILL_MISMATCH` — the staff member lacks `shift.requiredSkillId`
- `NOT_CERTIFIED` — `shift.locationId` is not among active certifications
- `UNAVAILABLE` — Task 3's matcher says no

**Message quality is graded** (15% is UX and clarity of feedback). "Not available" is a failing message. "Jordan is available 9:00 AM–5:00 PM Eastern, but this shift runs 12:00 PM–8:00 PM Eastern (9:00 AM–5:00 PM Pacific at Pier 39)" is the standard. Each message must name the person, the rule, and the specific conflicting values.

- [ ] **Steps: failing tests → run → implement → green → commit**

```bash
git commit -m "feat: add constraint types and eligibility rules"
```

---

### Task 5: Conflict rules — double-booking and rest gap

**Files:** Create `src/lib/constraints/conflicts.ts` + test.

**Interfaces produced:** `export function checkConflicts(ctx: EngineContext): Violation[];`

Emits, both `BLOCK`:
- `DOUBLE_BOOKING` — the candidate shift overlaps an existing assignment, **including at a different location**. Message must name the conflicting shift's location and times.
- `REST_GAP` — fewer than 10 hours between the end of one shift and the start of the next, in either direction. Message must state the actual gap.

- [ ] **Step 1: Write the failing tests**

Include: exact overlap; partial overlap; a conflicting shift at a *different* location (the brief calls this out explicitly); **back-to-back shifts (one ends exactly when the next starts) must NOT be a double-booking** but WILL violate the rest gap; a gap of exactly 10 hours is allowed (boundary — assert this precisely, both directions); 9h59m is blocked; an overnight shift followed by a next-day shift.

- [ ] **Steps: run → implement → green → commit**

```bash
git commit -m "feat: add double-booking and rest-gap constraint rules"
```

---

### Task 6: Hours rules — daily, weekly, consecutive days

**Files:** Create `src/lib/constraints/hours.ts` + test.

**Interfaces produced:** `export function checkHours(ctx: EngineContext): Violation[];`

Rules, evaluated **including** the candidate shift, in the staff member's `homeTimezone`:
- `DAILY_HOURS_WARN` — WARN — total for that local day exceeds 8h
- `DAILY_HOURS_BLOCK` — BLOCK — total for that local day exceeds 12h
- `WEEKLY_HOURS_WARN` — WARN — total for the Mon–Sun week reaches 35h (the brief's "approaching 40" threshold)
- `SIXTH_CONSECUTIVE_DAY` — WARN — this assignment makes a 6th consecutive worked day
- `SEVENTH_CONSECUTIVE_DAY` — OVERRIDE_REQUIRED — a 7th; permitted only with a documented reason (the caller supplies `overrideReason`; the engine only reports that one is required)

- [ ] **Step 1: Write the failing tests**

Boundaries are the whole game here — assert each precisely: exactly 8h does not warn, 8h01m does; exactly 12h does not block, 12h01m does; exactly 35h warns; 34h59m does not. Consecutive days: 5 days then a 6th warns; a gap day resets the streak; 7 consecutive requires override. Include a case where the candidate shift is what tips the total over, and one where prior assignments alone already exceed it. Include the brief's **Overtime Trap**: a schedule that would reach 52 weekly hours must surface both the weekly warning and whatever daily rules apply — the point is that the manager is told *before* confirming.

Use `weekBounds` and `localDateKey` from Task 2 — do not re-derive day/week logic here.

- [ ] **Steps: run → implement → green → commit**

```bash
git commit -m "feat: add daily, weekly and consecutive-day hour rules"
```

---

### Task 7: The engine + fairness-aware suggestions

**Files:** Create `src/lib/constraints/engine.ts` + test, `src/lib/constraints/suggestions.ts` + test.

**Interfaces produced:**

```ts
export type ValidationResult = {
  allowed: boolean;               // false if ANY violation has severity BLOCK
  requiresOverride: boolean;      // true if any OVERRIDE_REQUIRED and no BLOCK
  violations: Violation[];
  suggestions: Suggestion[];
};
export type Suggestion = { staffId: string; name: string; reason: string };

export function validateAssignment(ctx: EngineContext): Omit<ValidationResult, "suggestions">;
export async function loadContext(staffId: string, shiftId: string): Promise<EngineContext>;  // the only DB-touching function here
export async function suggestAlternatives(shiftId: string, excludeStaffId?: string): Promise<Suggestion[]>;
```

- `validateAssignment` composes `checkEligibility`, `checkConflicts`, `checkHours` and derives `allowed` / `requiresOverride`. Keep it a thin composition — the rules stay in their own modules.
- `suggestAlternatives` finds staff who are certified at the location, hold the required skill, are available, and have no conflict; ranks them by **fewest hours already scheduled that week** so suggestions are fairness-aware by construction (this is also what Phase 5's analytics will reward); and explains each pick in `reason` ("has bartender, certified at Pier 39, 18h scheduled this week").

- [ ] **Step 1: Write the failing tests**

For the engine: a clean assignment returns `allowed: true` with no violations; a single BLOCK makes `allowed` false; a WARN alone leaves `allowed` true; an OVERRIDE_REQUIRED with no BLOCK sets `requiresOverride` true and `allowed` true; **multiple simultaneous violations are ALL returned**, not just the first — a manager needs the whole picture, and a short-circuiting engine is a real defect here.

For suggestions: ineligible staff are excluded; the excluded staff member (the one who just failed) never appears; ranking puts the least-scheduled person first; an empty result is returned gracefully when nobody qualifies (the UI must be able to say "no one is eligible" rather than crash).

- [ ] **Steps: run → implement → green → commit**

```bash
git commit -m "feat: add constraint engine and fairness-aware suggestions"
```

---

### Task 8: Concurrency-safe assignment

This is the brief's **Simultaneous Assignment** scenario and the 15%-weighted data-integrity criterion.

**Files:** Create `src/lib/assign.ts` + test.

**Interfaces produced:**

```ts
export class AssignmentConflictError extends Error {}   // lost a race; safe to retry/refresh
export class AssignmentBlockedError extends Error {     // violated a constraint
  constructor(public violations: Violation[]) { super(...); }
}
export async function assignStaffToShift(input: {
  staffId: string;
  shiftId: string;
  assignedById: string;
  overrideReason?: string;
}): Promise<{ assignmentId: string }>;
```

**Required behavior:**
- The whole operation runs in ONE `prisma.$transaction` with `isolationLevel: "Serializable"`.
- Context is loaded and `validateAssignment` re-run **inside** the transaction — validating outside and writing inside is exactly the race this must prevent.
- A BLOCK throws `AssignmentBlockedError` carrying the violations (so the UI can show them).
- `OVERRIDE_REQUIRED` without an `overrideReason` throws `AssignmentBlockedError`; with one, the assignment proceeds and the reason is persisted on the row.
- Postgres serialization failures (code `P2034`, or `40001`) are caught and retried a bounded number of times (2 retries); if still failing, throw `AssignmentConflictError`.
- A unique-constraint violation on `@@unique([shiftId, staffId])` (`P2002`) means someone else assigned this exact pair first — throw `AssignmentConflictError`, never a raw Prisma error.

- [ ] **Step 1: Write the failing tests**

Mock the Prisma boundary. Cover: the happy path writes and returns an id; a BLOCK throws `AssignmentBlockedError` with violations attached and **no write occurs** (assert `create` was not called); OVERRIDE_REQUIRED without a reason throws and does not write; with a reason it writes and persists `overrideReason`; a `P2034` on the first attempt succeeds on retry; exhausting retries throws `AssignmentConflictError`; a `P2002` maps to `AssignmentConflictError` rather than leaking the Prisma error.

Also assert the transaction is actually opened with `isolationLevel: "Serializable"` — a test that only checks the happy path would not notice if someone dropped the isolation level, which is the entire point of this task.

- [ ] **Steps: run → implement → green → commit**

```bash
git commit -m "feat: add concurrency-safe shift assignment"
```

---

### Task 9: Evaluation-scenario tests, seed data, and documentation

**Files:** Create `src/lib/constraints/scenarios.test.ts`; modify `prisma/seed.ts`, `README.md`.

- [ ] **Step 1: Seed availability and shifts**

Idempotent as always. Add:
- Recurring availability for every staff member (varied — not all 9–5, so the constraint engine has something to bite on), plus at least one EXCEPTION row.
- A week of shifts across all 4 locations, in `DRAFT` and `PUBLISHED` states, covering: a normal day shift, an **overnight shift** (23:00–03:00), a Friday-evening **premium** shift, and a Saturday-evening premium shift.
- Enough existing assignments that the brief's scenarios are reachable — in particular someone close to the weekly-hours threshold and someone on a 5-day streak.

State in the report exactly which scenario each seeded fixture enables.

- [ ] **Step 2: Write the scenario tests**

One named test per brief scenario, asserting the engine's actual output — these are what an evaluator will look for:
1. **Sunday Night Chaos** — a staff member drops out of a 19:00 shift; `suggestAlternatives` returns qualified, available replacements, ranked.
2. **The Overtime Trap** — an assignment pushing someone to 52 weekly hours surfaces the weekly warning *before* the write.
3. **The Timezone Tangle** — Jordan Tangle, 09:00–17:00 availability in ET, is correctly UNAVAILABLE for a 09:00–17:00 *Pacific* shift at Pier 39, with an intelligible message.
4. **Simultaneous Assignment** — two concurrent assignments of the same person resolve to exactly one winner; the loser gets `AssignmentConflictError`.
5. **Fairness Complaint** — hours and premium-shift counts per staff member over a period are computable from the data (the full report is Phase 5; here, prove the data supports it).
6. **The Regret Swap** — out of scope this phase (swaps are Phase 4); assert nothing, but note it in the report so the gap is explicit rather than silently missing.

- [ ] **Step 3: Update the README**

Add the five design decisions from this plan's "Design decisions this phase locks in" section to the existing ambiguity-decisions section, and update the status line to reflect that the constraint engine exists.

- [ ] **Step 4: Full verification**

`npm test`, then `npm run build`, then `npx tsc --noEmit`, then `npm run lint`. Report real output.

- [ ] **Step 5: Commit**

```bash
git commit -m "test: cover the brief's evaluation scenarios end to end"
```

---

## Self-Review Notes

- **Spec coverage:** implements spec §3's `Availability`/`Shift`/`ShiftAssignment`, §4's entire constraint list and the concurrency approach, and §5's timezone/consecutive-day/overnight decisions. Publish/unpublish with the 48-hour cutoff, swap workflows, realtime, and analytics are explicitly later phases.
- **Deliberately deferred:** all UI (Phase 3), `AuditLog` (Phase 5) — note that Task 8 persists `overrideReason` so the audit trail has something to record when it arrives.
- **Type consistency:** `EngineContext` is constructed only by `loadContext` and consumed by every rule module unchanged; `Violation.rule` ids are stable strings shared between the engine and Phase 3's UI copy.
