# ShiftSync

Multi-location staff scheduling for a fictional restaurant group, "Coastal
Eats" — Admins, Managers, and Staff collaborate on scheduling, swapping, and
covering shifts across locations and time zones.

## Status

**Phase 1 — org model, authorization, and admin CRUD complete**, on top of
Phase 0's foundation (Next.js App Router + TypeScript strict, Prisma against
Postgres (Supabase), NextAuth v5 with Credentials + JWT sessions). This
phase adds the org model (locations, skills, staff certifications),
centralized role-based authorization (`ADMIN`/`MANAGER`/`STAFF`, scoped by
managed/certified location), admin CRUD for locations/skills/staff, and a
role-aware dashboard for all three roles. Scheduling itself — shifts,
availability, swaps, and constraint enforcement — lands in later phases.

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
   `homeTimezone`, regardless of shift length. (Phase 2.)
4. **Editing after swap approval** — once a swap is approved, the resulting
   assignment is edited like any other assigned shift (notify affected
   staff, no swap-specific handling); this differs only from editing a
   shift with a _pending_ swap, which auto-cancels that swap. (Phase 2/3.)
5. **Timezone-spanning locations** — out of scope: every `Location` has
   exactly one IANA timezone, chosen by whoever creates the location record.

## Known limitations

- Login has no rate limiting yet. The demo accounts' passwords being public
  is an acceptable risk for this take-home; rate limiting is planned but
  not yet implemented.
- Role is read once into the JWT at sign-in and is not revalidated on every
  request; a role change (e.g. an admin demoting a manager) only takes
  effect the next time that user signs in, not immediately. Revalidating on
  every request would mean a DB read per request under the current
  session strategy — deferred to Phase 2 as a deliberate trade-off, not an
  oversight.
- There is no separate test database: `npm run test:e2e` runs Playwright
  against the same live demo database described above, using the seeded
  accounts. Unit tests (`npm test`) mock Prisma and never touch the
  database.
- `User.homeTimezone` is set from a column default (`America/New_York`) at
  creation rather than derived from the user's first certification's
  location timezone, as the design spec describes. The seed data sets it
  explicitly per user, so the demo data is correct; a real signup/admin
  "create staff" flow would need to derive it.
- CI's build step (`npm run build`, which needs `DATABASE_URL`,
  `DIRECT_URL`, and `AUTH_SECRET` to run `prisma generate` against a real
  schema and complete a Next.js production build) is red until those three
  secrets are added to the repo's GitHub Actions configuration.
