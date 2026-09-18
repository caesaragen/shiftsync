# ShiftSync — Architecture & Design Spec

**Date**: 2026-09-19
**Status**: Approved for implementation planning
**Source brief**: [Priority Soft — Full-Stack Developer Assessment](https://priority-soft.notion.site/Priority-Soft-Full-Stack-Developer-Assessment-30b871b13a9180b2bef4c1f89b220f46)
**Time limit**: 72 hours from receipt of the brief

## 1. Problem summary

Build a web-based shift scheduling platform for a fictional restaurant group,
"Coastal Eats," which operates 4 locations across 2 time zones. Three roles
(Admin, Manager, Staff) collaborate on scheduling, swapping, and covering
shifts, subject to labor-law and fairness constraints, with real-time
visibility and a full audit trail.

Full functional requirements, the 6 evaluator test scenarios, the 5
intentionally-unspecified ambiguities, and the weighted evaluation criteria
are captured verbatim in the source brief linked above and are treated as
the authoritative spec for *what* to build. This document defines *how*.

## 2. Stack decision

Constraint from stakeholder: everything must run on free tiers.

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Mandated by `CLAUDE.md`; Server Components by default, Server Actions for mutations |
| Styling | Tailwind v4 | Mandated by `CLAUDE.md`; paired with Apple-HIG-inspired restraint (hierarchy via type/spacing, not decoration) |
| Database | Postgres, hosted on Supabase (free tier) | Free, includes a connection pooler (pgbouncer) required for Prisma from Vercel's serverless functions |
| ORM | Prisma | Full control over transactions/isolation level — needed for constraint enforcement (25% of grade) and concurrency safety (15% of grade); avoids depending on DB-level RLS for authorization logic that's easier to unit-test in TypeScript |
| Auth | NextAuth.js (Auth.js v5), Credentials provider, Prisma adapter, JWT sessions | Self-contained (no separate auth vendor); real auth flow, not mocked |
| Realtime | Supabase Realtime — Broadcast + Presence channels, used as a generic pub/sub layer independent of Supabase Auth/RLS | Free, no separate vendor beyond the DB we already have; Presence channels are a natural fit for the "on-duty now" live dashboard |
| Hosting | Vercel (free/hobby tier) | Free; user has Vercel access already connected for this session |
| Testing | Vitest + Testing Library (unit/component), Playwright (E2E) | Matches `CLAUDE.md`'s TDD requirement; constraint engine gets exhaustive unit coverage since it's the highest-weighted grading area |

**Tooling caveat**: `CLAUDE.md` calls for installing several Claude Code
plugins (JanSzewczyk Next.js/testing marketplace, apple-design-skill,
tdd-guard) via interactive `/plugin` commands. Those can't be invoked from
an agent session — the user needs to run them. Implementation will follow
the *intent* of those tools manually (strict red-green-refactor discipline,
HIG-inspired visual restraint) even without mechanical enforcement.

## 3. Data model

All timestamps are stored as UTC `timestamptz`. Display conversion happens
at render time using each `Location`'s IANA timezone (Luxon).

```
User
  id, name, email, passwordHash, role (ADMIN | MANAGER | STAFF)
  homeTimezone (IANA string) — see §5, Ambiguity Decisions

Location
  id, name, timezone (IANA string), address

ManagerLocation (join: User[MANAGER] <-> Location)

Skill
  id, name  (e.g. "bartender", "line cook", "server", "host")

StaffSkill (join: User[STAFF] <-> Skill)

StaffLocationCertification (join: User[STAFF] <-> Location)

Availability
  id, staffId, kind (RECURRING | EXCEPTION)
  dayOfWeek (0-6, for RECURRING) | date (for EXCEPTION)
  startTime, endTime (interpreted in staff's homeTimezone)
  isAvailable (bool — EXCEPTION rows can mark unavailability too)

Shift
  id, locationId, startAt, endAt (UTC), requiredSkillId, headcount
  status (DRAFT | PUBLISHED)
  isPremium (computed: Fri/Sat evening in location tz)
  createdBy, notes

ShiftAssignment
  id, shiftId, staffId, status (ASSIGNED | PENDING_SWAP)
  assignedAt, assignedBy

SwapRequest
  id, shiftAssignmentId, requestingStaffId, type (SWAP | DROP)
  targetStaffId (nullable — null for open drop/pickup)
  status (PENDING_TARGET | PENDING_MANAGER | APPROVED | REJECTED | CANCELLED | EXPIRED)
  createdAt, respondedAt, expiresAt

Notification
  id, userId, type, message, relatedEntityType, relatedEntityId
  isRead, createdAt

AuditLog
  id, actorId, entityType, entityId, action
  beforeJson, afterJson, createdAt

ClockEvent
  id, shiftAssignmentId, clockInAt, clockOutAt (nullable while on duty)
```

There is no separate `Schedule` entity. A "week" is just the set of `Shift`
rows for a location within a date range; "publish a week" is a bulk status
update (`DRAFT` → `PUBLISHED`) across matching shifts, and the 48-hour
cutoff is enforced at edit/unpublish time by comparing `now()` to
`shift.startAt`.

## 4. Constraint engine & concurrency

A single pure function, `validateAssignment(staffId, shiftId, tx)`, is the
one place all scheduling rules live:

- No double-booking (overlapping times, any location)
- Minimum 10-hour rest gap between shifts for the same person
- Required-skill match
- Location certification match
- Availability window match (converted through the staff's `homeTimezone`)
- Daily hours: warn at 8h, hard-block at 12h
- Weekly hours: warn at 35h (approaching 40h)
- 6th consecutive day: warn; 7th consecutive day: requires a manager
  override with a documented reason (stored on the assignment)

It returns `{ allowed, violations: [{ rule, message }], suggestions:
[{ staffId, reason }] }`. Suggestions are computed by re-running the skill/
location/availability/no-conflict checks against other staff, ranked by
fewest hours scheduled this week (keeps suggestions fairness-aware for
free, tying into §"Fairness Analytics").

**Concurrency** (the "two managers assign the same bartender
simultaneously" scenario, and the 15%-weighted data-integrity criterion):
the assignment write and `validateAssignment` run inside one Postgres
transaction at `SERIALIZABLE` isolation. If two transactions race, Postgres
aborts the loser with a serialization failure; the app catches this,
re-validates (the picture has changed), and returns a structured conflict
error. That error is pushed live to the losing manager's screen over the
per-location Realtime channel so they see the conflict immediately rather
than on next refresh — this satisfies the "Simultaneous Assignment"
evaluation scenario without hand-rolled row locking.

## 5. Timezone & documented ambiguity decisions

The brief intentionally leaves five things unspecified and asks for
documented decisions. Decisions (to be restated in the README, per the
brief's deliverable requirement):

1. **Historical data on de-certification**: de-certifying a staff member
   from a location is a soft state change (certification row gets an
   `endedAt`, not deleted) — past shifts/assignments at that location stay
   intact and visible in history/audit; only future assignment eligibility
   is affected.
2. **"Desired hours" vs. availability**: availability defines the *feasible
   region* (when a staff member CAN work); desired hours is a target within
   that region used only for the fairness dashboard's
   under/over-scheduled signal. Availability is never overridden by a
   desired-hours target.
3. **Consecutive-day counting**: a day counts as "worked" if the staff
   member has any assignment with `startAt` falling on that calendar date
   in their `homeTimezone`, regardless of shift length — a 1-hour shift and
   an 11-hour shift count identically. (Duration is handled separately by
   the daily/weekly hour rules.)
4. **Editing after swap approval**: once a `SwapRequest` reaches `APPROVED`,
   the resulting `ShiftAssignment` is a normal assignment — a manager
   editing that shift afterward follows the same rules as editing any
   other assigned shift (notify affected staff, no special swap-specific
   handling). This only differs from the *pending*-swap case in §"Shift
   Swapping & Coverage," where an edit auto-cancels the pending swap.
5. **Timezone-spanning locations**: out of scope — every `Location` has
   exactly one IANA timezone. A location literally spanning a timezone
   boundary is treated as a data-entry decision for whoever creates that
   location record (pick the timezone that governs its posted hours), not
   a system feature.

**Timezone Tangle scenario**: each `User[STAFF]` has a `homeTimezone`,
defaulting to their first certification's location timezone but editable.
`Availability` times are always interpreted in `homeTimezone`. When
checking a shift at a location in a different timezone, the shift's
UTC `startAt`/`endAt` are converted into the staff's `homeTimezone` before
comparing against their availability windows — so "9am–5pm" means the same
thing to that staff member no matter which location's shift is being
checked.

**Overnight shifts**: an 11pm–3am shift is just one `Shift` row with
`endAt` on the next calendar date. No special-casing is needed anywhere
else in the system because all comparisons operate on absolute UTC
instants, not on a "shift belongs to day X" concept.

**DST**: recurring `Availability` rows store wall-clock local time
(`startTime`/`endTime` + `dayOfWeek`) rather than a fixed UTC offset, so
they're interpreted correctly across DST transitions by re-resolving
against the current offset for `homeTimezone` at query time (via Luxon),
rather than drifting by an hour twice a year.

## 6. Real-time design

Supabase Realtime channels (Broadcast + Presence), keyed per-entity:

- `location:{id}:schedule` — shift created/edited/published/unpublished;
  clients subscribed here re-fetch or patch their local view without a
  manual refresh
- `location:{id}:presence` — Presence channel; staff "join" on clock-in and
  "leave" on clock-out, powering the live "on-duty now" dashboard
- `user:{id}:notifications` — personal channel for the notification center
  (new assignment, shift change, swap update, schedule published) and for
  conflict errors from the concurrency case above

## 7. Testing strategy

- **Vitest**: `validateAssignment` and the suggestion-ranking logic get
  exhaustive unit tests, explicitly covering all 6 evaluator scenarios and
  all 5 documented ambiguity decisions as named test cases — this is the
  single highest-leverage place to invest test effort given the grading
  weights.
- **Testing Library**: constraint-violation UI (clear rule + explanation +
  suggestions), swap request UI, notification center.
- **Playwright**: three critical end-to-end flows — (a) publish a schedule
  and hit a conflict on manual assignment, (b) full swap lifecycle
  (request → accept → manager approval → notifications), (c) an assignment
  that would trigger the 12-hour hard block.
- TDD (red → green → refactor) applies to all application logic per
  `CLAUDE.md`; no feature is committed without its tests.

## 8. Phased delivery plan

Given the scope, implementation is broken into phases, each shippable and
independently testable, mapping to `feature/*` branches merged into
`develop`:

0. **Scaffold** — `create-next-app` (TS + App Router + ESLint + Tailwind),
   Prisma + Supabase connection, NextAuth wiring, base layout, husky +
   lint-staged. Git already initialized (`main`, this spec committed);
   `develop` branch created next.
1. **Foundation** — auth, roles, Location/Skill/Certification admin CRUD
2. **Core scheduling** — Shift CRUD, constraint engine, manual assignment,
   publish/unpublish with cutoff (highest grading weight — 25%)
3. **Swap/coverage workflow** — swap/drop/pickup, expiry, audit trail
4. **Real-time layer** — live schedule updates, notification center,
   on-duty presence, conflict handling
5. **Compliance & analytics** — overtime dashboard, fairness analytics,
   audit log viewer/export
6. **Seed data, docs, deploy** — realistic seed data covering edge cases,
   README with role-login instructions and documented assumptions, deploy
   to Vercel, manual pass through all 6 evaluation scenarios

## 9. Deliverables mapping

| Brief requirement | How it's satisfied |
|---|---|
| Working application, public URL | Phase 6, Vercel deploy |
| Public GitHub repo, commit history | `git init` done; remote creation/push happens once the user confirms repo visibility/name |
| Seed data with edge cases | Phase 6 seed script |
| Brief documentation | README: role login instructions, known limitations, §5 ambiguity decisions restated |
