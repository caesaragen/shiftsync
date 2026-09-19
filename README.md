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

## Demo login

```text
Email:    admin@coastaleats.test
Password: admin123!
Role:     ADMIN
```

These credentials are intentionally public for evaluation purposes.

## Known limitations

- Login has no rate limiting yet. The demo account's password being public
  is an acceptable risk for this take-home; rate limiting is planned but
  not yet implemented.
