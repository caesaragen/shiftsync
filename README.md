# ShiftSync

Multi-location staff scheduling for a fictional restaurant group, "Coastal
Eats" — Admins, Managers, and Staff collaborate on scheduling, swapping, and
covering shifts across locations and time zones.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the stack, data model, and a
module-by-module explanation of how the system is built.

## Status

**Phase 3 — scheduling UI complete**. A manager can now:

- View a location's weekly schedule (scoped to locations they manage)
- Create a shift (date, time, required skill, headcount)
- Assign staff to a shift with real-time constraint feedback from Phase 2's engine
  — the UI shows eligibility verdicts (allowed / warnings / blocked) with the
  engine's violation messages rendered verbatim, and when blocked, suggests
  alternative eligible staff ranked by fairness (fewest hours that week)
- Publish or unpublish a week (with a 48-hour cutoff preventing edits to
  published shifts within 48 hours of start)

Underpinning all of this: Phase 2's constraint engine (`validateAssignment`,
`suggestAlternatives`), which enforces eligibility, double-booking/rest-gap
conflicts, and daily/weekly-hour + consecutive-day rules (see "Constraint
engine" below for the full rule list). Phase 2's concurrency-safe
`assignStaffToShift` (Postgres `Serializable` transactions with retry)
ensures two simultaneous assignments of the same person resolve to exactly one
winner. Phase 1's org model (locations, skills, staff, certifications, availability)
and Phase 0's foundation (Next.js App Router + TypeScript strict, Prisma,
NextAuth v5, Supabase) complete the stack.

**Phase 4 — swap/notification/audit infrastructure (schema + data layer
only, no UI yet)**. `SwapRequest`, `Notification`, and `AuditLog` models
are live, with a tested `writeAuditLog`/`notify`/`listNotifications`/
`markRead` data layer following the same transaction-client pattern as
Phase 2's `assignStaffToShift` — but no swap/drop request can currently be
made through the UI, and no notification is currently triggered by
anything. This was stopped deliberately partway through, ahead of the
deadline, to prioritize documentation and production polish over shipping
a half-built UI. `docs/superpowers/plans/2026-09-20-phase4-swap-workflow.md`
has the full 10-task plan, including the 3 completed tasks and the 7
remaining ones (the staff/manager UI, the swap state machine's edge cases,
and E2E coverage).

Real-time updates and fairness-analytics reporting remain unbuilt.

## Constraint engine

`validateAssignment(ctx)` composes three rule modules and returns every
applicable violation at once (never short-circuits), each tagged with a
severity: **BLOCK** (assignment refused), **WARN** (allowed, surfaced to the
manager), or **OVERRIDE_REQUIRED** (allowed only if a manager supplies a
reason, persisted on `ShiftAssignment.overrideReason`).

| Rule                      | Severity          | Threshold                                                                |
| ------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `SKILL_MISMATCH`          | BLOCK             | Staff member lacks the shift's required skill.                           |
| `NOT_CERTIFIED`           | BLOCK             | No active certification at the shift's location.                         |
| `UNAVAILABLE`             | BLOCK             | Shift isn't fully covered by an availability window (decision 7, below). |
| `DOUBLE_BOOKING`          | BLOCK             | Candidate shift overlaps another assignment.                             |
| `REST_GAP`                | BLOCK             | Less than 10 hours between the ends/starts of two shifts.                |
| `DAILY_HOURS_BLOCK`       | BLOCK             | More than 12 hours worked in one local calendar day.                     |
| `DAILY_HOURS_WARN`        | WARN              | More than 8 hours worked in one local calendar day.                      |
| `WEEKLY_HOURS_WARN`       | WARN              | 35 hours or more worked in the local week (decision 6, below).           |
| `SIXTH_CONSECUTIVE_DAY`   | WARN              | 6th consecutive local calendar day worked.                               |
| `SEVENTH_CONSECUTIVE_DAY` | OVERRIDE_REQUIRED | 7th consecutive local calendar day worked.                               |

`suggestAlternatives(shiftId, excludeStaffId?)` re-runs `validateAssignment`
per candidate and ranks the ones with no BLOCK violation by fewest hours
already scheduled that week — fairness-aware by construction.

## Running locally

```bash
npm install
cp .env.example .env       # fill in DATABASE_URL, DIRECT_URL, AUTH_SECRET
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to
`/dashboard`, which redirects unauthenticated visitors to `/login`.

## Tests

```bash
npm test          # Vitest unit tests
npm run test:e2e  # Playwright end-to-end tests
```

## Demo logins

Coastal Eats operates 4 locations across 2 timezones: Harbor Point and
Bayside (`America/New_York`), Pier 39 and Sunset Grill
(`America/Los_Angeles`). Sign in as any of the seeded accounts below to see
the app from that role's perspective: ADMIN gets an org summary and full
CRUD under Locations/Skills/Staff; MANAGER's dashboard lists the locations
they manage; STAFF's dashboard lists the locations they're actively
certified for and their skills.

| Role    | Name            | Email                     | Password       | Notes                                                                                  |
| ------- | --------------- | ------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| ADMIN   | Alex Admin      | admin@coastaleats.test    | `admin123!`    | Sees and manages everything.                                                           |
| MANAGER | Morgan Manager  | manager1@coastaleats.test | `manager1123!` | Assigned to Harbor Point + Bayside (`America/New_York`).                               |
| MANAGER | Jamie Manager   | manager2@coastaleats.test | `manager2123!` | Assigned to Pier 39 + Sunset Grill (`America/Los_Angeles`).                            |
| STAFF   | Sam Server      | staff1@coastaleats.test   | `staff1123!`   | Certified at Harbor Point.                                                             |
| STAFF   | Riley Bartender | staff2@coastaleats.test   | `staff2123!`   | Certified at Bayside; **also has an ended certification at Harbor Point** — see below. |
| STAFF   | Casey Cook      | staff3@coastaleats.test   | `staff3123!`   | Certified at Harbor Point + Bayside.                                                   |
| STAFF   | Drew Host       | staff4@coastaleats.test   | `staff4123!`   | Certified at Pier 39.                                                                  |
| STAFF   | Taylor Tender   | staff5@coastaleats.test   | `staff5123!`   | Certified at Sunset Grill.                                                             |
| STAFF   | Morgan Cook     | staff6@coastaleats.test   | `staff6123!`   | Certified at Pier 39 + Sunset Grill.                                                   |
| STAFF   | Jordan Tangle   | staff7@coastaleats.test   | `staff7123!`   | **Timezone Tangle**: certified at Harbor Point (ET) _and_ Pier 39 (PT).                |

These credentials are intentionally public for evaluation purposes.

Riley Bartender's ended Harbor Point certification is seeded specifically
so the admin Staff page's soft-delete UI (the muted "ended {date}" row) has
demo data — see decision 1 below.

The seed also creates recurring (and one EXCEPTION) availability for every
staff member, deliberately varied — not everyone 9-5 — plus a demo week
(Mon Sep 21 - Sun Sep 27, 2026) of `Shift`/`ShiftAssignment` rows across all
4 locations, in both `DRAFT` and `PUBLISHED` status, covering a normal day
shift, an overnight shift (Bayside, Fri 23:00-Sat 03:00 ET), a
Friday-evening premium shift (Pier 39), and a Saturday-evening premium
shift (Sunset Grill). Casey Cook is deliberately assigned a clean 5-day
streak (Mon-Fri, alternating Harbor Point/Bayside, 40 hours) so the
weekly-hours and consecutive-day rules both already have something to warn
about.

## Design spec ambiguity decisions

The assessment brief intentionally leaves five things unspecified and asks
for documented decisions. Full detail lives in
`docs/superpowers/specs/2026-09-19-shiftsync-design.md` §5; summarized here
for grading:

1. **Historical data on de-certification** — de-certifying a staff member
   from a location is a soft state change, not a delete: the certification
   row gets an `endedAt` timestamp and is preserved, so past shifts/history
   at that location stay intact and auditable, and only future assignment
   eligibility is affected. **Implemented in this phase**: certification is
   modeled as periods (`StaffLocationCertification` has no
   `@@unique([staffId, locationId])`), so a staff member can be certified,
   de-certified, and later re-certified at the same location without
   overwriting or losing the earlier period.
2. **"Desired hours" vs. availability** — availability defines the feasible
   region (when a staff member _can_ work); desired hours is a target
   within that region used only for the fairness dashboard's
   under/over-scheduled signal, and never overrides availability. (Phase 2.)
3. **Consecutive-day counting** — a day counts as "worked" if the staff
   member has any assignment starting on that calendar date in their
   `homeTimezone`, regardless of shift length. **Implemented in this
   phase** — see decision 8 below.
4. **Editing after swap approval** — once a swap is approved, the resulting
   assignment is edited like any other assigned shift (notify affected
   staff, no swap-specific handling); this differs only from editing a
   shift with a _pending_ swap, which auto-cancels that swap. (Phase 2/3.)
5. **Timezone-spanning locations** — out of scope: every `Location` has
   exactly one IANA timezone, chosen by whoever creates the location record.

Phase 2 (the constraint engine) locks in five more, all **implemented in
this phase**:

6. **Week boundary for overtime and fairness** — Monday 00:00 through Sunday
   23:59, evaluated in the staff member's `homeTimezone`. The brief doesn't
   specify; Monday-start matches ISO 8601. Implemented as `weekBounds()`
   (`src/lib/time/zones.ts`), via Luxon calendar-day arithmetic so a week
   containing a DST transition still spans exactly 7 local days.
7. **Availability is interpreted in the staff member's `homeTimezone`**, not
   the shift's location timezone. A shift at a location in another zone is
   converted into the staff member's zone before being compared against
   their availability windows — this is what makes "9am-5pm" mean one thing
   for someone certified in two zones. See Jordan Tangle above, and the
   "Timezone Tangle" scenario in `scenarios.test.ts`.
8. **Consecutive-day counting** — a day counts as worked if any assignment
   _starts_ on that calendar date in the staff member's `homeTimezone`,
   regardless of shift length. A 1-hour shift and an 11-hour shift count
   identically; duration is governed separately by the daily/weekly hour
   rules.
9. **Overnight shifts are a single row**, with `endAt` on the following
   calendar date. No midnight special-casing anywhere in the engine — every
   comparison is between absolute UTC instants (`src/lib/time/intervals.ts`).
10. **Premium shifts** are those starting Friday or Saturday at or after
    17:00 **in the location's timezone** (not the staff member's) — a
    property of the shift itself, used by Phase 5's fairness analytics. The
    "Fairness Complaint" scenario in `scenarios.test.ts` proves hours and
    premium-shift counts per staff member are already computable from
    today's data, ahead of that report.

Phase 3 (the scheduling UI) locks in three more:

1. **The week view is scoped per location** — a manager sees only one
   location's week at a time, with a location picker limited to locations
   they manage. A cross-location "everything" view is a Phase 5 analytics
   concern, not a real-time scheduling surface.
2. **Publishing is per location per week** — a bulk `DRAFT` → `PUBLISHED`
   transition over all shifts in that location/week window. There is no
   separate `Schedule` entity; the week-level action is computed from shifts
   themselves. Unpublishing, likewise, works on the same scoped set.
3. **The 48-hour cutoff blocks editing or unpublishing a `PUBLISHED` shift**
   whose `startAt` is less than 48 hours away. Creating and editing `DRAFT`
   shifts is always allowed. The cutoff is enforced in the data layer
   (`src/lib/shifts.ts`, exported constant `EDIT_CUTOFF_HOURS`) and all UI
   attempts that violate it surface a clear, specific error. A manager's
   preview of who can be assigned always reflects the same constraint rules
   the write path enforces, so the verdict shown and the verdict written can
   never disagree.

## Known limitations

- **Login rate limiting** — not yet implemented. The demo accounts' passwords
  being public is an acceptable risk for this take-home evaluation.
- **Role revalidation** — Role is read once into the JWT at sign-in and not
  revalidated on every request; a role change (e.g. an admin demoting a
  manager) only takes effect the next time that user signs in, not
  immediately. Revalidating on every request would mean a DB read per
  request under the current session strategy — deferred as a deliberate
  trade-off.
- **No separate test database** — `npm run test:e2e` runs Playwright against
  the same live demo database, using the seeded accounts and self-cleaning
  after each test. Unit tests (`npm test`) mock Prisma and never touch the
  database. E2E now covers real scheduling workflows (create shift, assign
  staff with constraint feedback, publish) end-to-end.
- **Timezone derivation** — `User.homeTimezone` is set from a column default
  (`America/New_York`) at creation rather than derived from the user's first
  certification's location timezone. The seed data sets it explicitly per
  user, so demo data is correct; a real signup/admin "create staff" flow
  would need to derive it.
- **CI configuration** — the build step (`npm run build`) needs `DATABASE_URL`,
  `DIRECT_URL`, and `AUTH_SECRET` to complete. Manual trigger only due to
  GitHub Actions billing lock on this account.
- **Features not yet built** — the swap/drop/coverage workflow has its
  schema and data layer (`SwapRequest`, `Notification`, `AuditLog`,
  `src/lib/swaps.ts`'s planned state machine) but no UI, no notification
  triggers, and no real-time delivery yet; overtime-cost dashboards and
  fairness-analytics reporting UI (Phase 5) also don't exist. The
  constraint engine enforces all the rules and the data supports both,
  but neither has a report/interaction screen yet.
- **No background job runner** — the plan for drop-request expiry (24
  hours before the shift, unclaimed) is lazy/read-time evaluation rather
  than a cron job, since this project has no scheduled-task infrastructure.
  Not yet implemented (Phase 4 stopped before the swap state machine).
