# ShiftSync

Multi-location staff scheduling for a fictional restaurant group, "Coastal
Eats" — Admins, Managers, and Staff collaborate on scheduling, swapping, and
covering shifts across locations and time zones.

## Status

**Phase 0 — foundation complete.** Next.js App Router + TypeScript strict,
Prisma against Postgres (Supabase), NextAuth v5 (Credentials provider, JWT
sessions), a seeded demo admin, a login page, and a protected dashboard
page, deployed. Scheduling features (locations, shifts, swaps, constraint
enforcement) land in later phases.

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
the app from that role's perspective.

| Role    | Name            | Email                     | Password       | Notes                                                                   |
| ------- | --------------- | ------------------------- | -------------- | ----------------------------------------------------------------------- |
| ADMIN   | Alex Admin      | admin@coastaleats.test    | `admin123!`    | Sees and manages everything.                                            |
| MANAGER | Morgan Manager  | manager1@coastaleats.test | `manager1123!` | Assigned to Harbor Point + Bayside (`America/New_York`).                |
| MANAGER | Jamie Manager   | manager2@coastaleats.test | `manager2123!` | Assigned to Pier 39 + Sunset Grill (`America/Los_Angeles`).             |
| STAFF   | Sam Server      | staff1@coastaleats.test   | `staff1123!`   | Certified at Harbor Point.                                              |
| STAFF   | Riley Bartender | staff2@coastaleats.test   | `staff2123!`   | Certified at Bayside.                                                   |
| STAFF   | Casey Cook      | staff3@coastaleats.test   | `staff3123!`   | Certified at Harbor Point + Bayside.                                    |
| STAFF   | Drew Host       | staff4@coastaleats.test   | `staff4123!`   | Certified at Pier 39.                                                   |
| STAFF   | Taylor Tender   | staff5@coastaleats.test   | `staff5123!`   | Certified at Sunset Grill.                                              |
| STAFF   | Morgan Cook     | staff6@coastaleats.test   | `staff6123!`   | Certified at Pier 39 + Sunset Grill.                                    |
| STAFF   | Jordan Tangle   | staff7@coastaleats.test   | `staff7123!`   | **Timezone Tangle**: certified at Harbor Point (ET) _and_ Pier 39 (PT). |

These credentials are intentionally public for evaluation purposes.

## Known limitations

- Login has no rate limiting yet. The demo account's password being public
  is an acceptable risk for this take-home; rate limiting is planned but
  not yet implemented.
