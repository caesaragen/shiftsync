# ShiftSync Phase 1: Org Model, Authorization & Admin CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the organizational data model (locations, skills, manager assignments, staff certifications) with role-scoped authorization and admin CRUD, so Phase 2's scheduling engine has real entities and a trustworthy authorization boundary to build on.

**Architecture:** Prisma models for `Location`, `Skill` and three join tables, all timestamps `timestamptz`. A single authorization module (`src/lib/authz.ts`) centralizes "who may see/do what" so page-level checks stop being copy-paste. Admin CRUD via Server Actions on Server Components. Managers see only their assigned locations; admins see everything.

**Tech Stack:** Next.js 16 (App Router, Server Components/Actions), TypeScript strict, Prisma 6.19.3 + Supabase Postgres, NextAuth v5 (JWT, `session.user.role`), Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-19-shiftsync-design.md](../specs/2026-09-19-shiftsync-design.md)

## Global Constraints

- TypeScript only, `strict: true`, no `any` without an explicit inline justification comment.
- Server Components by default; `'use client'` only where interactivity genuinely requires it.
- **Every Prisma `DateTime` field MUST carry `@db.Timestamptz(3)`.** Prisma's default maps to zone-less `timestamp`, which violates spec §3. Phase 0 already needed one corrective migration for this — do not repeat it.
- TDD (red → green → refactor) for all application logic; tests committed in the same task.
- Conventional Commits; small atomic commits. Never commit to `main`.
- Files stay small and single-responsibility (~150–200 lines is the split signal).
- Authorization is enforced server-side in Server Actions and Server Components. Never trust a client-supplied role or location id.
- Type-checking (`tsc --noEmit`) must run AFTER `next build` — Next generates route types (`LayoutProps`, `PageProps`) that type-checking depends on. A bare `tsc` on a fresh checkout fails spuriously.

## Carried-forward context from Phase 0

- `src/auth.ts` exports `handlers`, `signIn`, `signOut`, `auth`; `session.user.role` is typed `"ADMIN" | "MANAGER" | "STAFF"` via module augmentation in `types/next-auth.d.ts`.
- `src/lib/prisma.ts` exports the `prisma` singleton. `src/lib/password.ts` exports `hashPassword`/`verifyPassword`. `src/lib/auth-credentials.ts` exports `verifyCredentials`.
- Existing pages: `src/app/login/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/page.tsx` (redirects to `/dashboard`).
- `User` model: `id, name, email @unique, passwordHash, role, homeTimezone, createdAt, updatedAt`.
- Seed (`prisma/seed.ts`) upserts one ADMIN: `admin@coastaleats.test` / `admin123!` / "Alex Admin".
- Vitest config is `vitest.config.mts` (`environment: "node"`, `include: ["src/**/*.test.ts"]`). Playwright specs live in `e2e/`.
- Demo credentials are intentionally public; login has no rate limiting (documented in README).

---

## File Structure

```
.github/workflows/ci.yml           # lint + typecheck + unit tests on push/PR
prisma/
  schema.prisma                    # + Location, Skill, 3 join tables
  seed.ts                          # + 4 Coastal Eats locations, skills, staff
src/
  lib/
    authz.ts                       # requireUser/requireRole/location scoping
    authz.test.ts
    locations.ts                   # location queries + mutations (data layer)
    locations.test.ts
    skills.ts                      # skill queries + mutations
    skills.test.ts
  app/
    (app)/layout.tsx               # authenticated shell: nav + sign out
    admin/
      locations/page.tsx           # admin: list/create/edit locations
      locations/actions.ts         # Server Actions
      skills/page.tsx              # admin: list/create skills
      skills/actions.ts
      staff/page.tsx               # admin: assign skills + certifications
      staff/actions.ts
    dashboard/page.tsx             # updated: role-aware summary
  components/
    SignOutButton.tsx              # 'use client' — the one genuine client component
e2e/
  admin-crud.spec.ts               # admin manages a location end-to-end
  authorization.spec.ts            # manager cannot reach admin routes
vitest.config.mts                  # + jsdom environment for *.test.tsx
vitest.setup.ts                    # Testing Library matchers
```

---

### Task 1: Component test harness (jsdom + Testing Library)

Phase 0's plan claimed a Testing Library harness existed; it does not. `vitest.config.mts` uses `environment: "node"` and `include` only matches `src/**/*.test.ts`, so no `.test.tsx` file would even be collected. Every component test in this phase depends on fixing that first.

**Files:**
- Modify: `vitest.config.mts`
- Create: `vitest.setup.ts`
- Create: `src/components/SignOutButton.tsx`, `src/components/SignOutButton.test.tsx`
- Modify: `package.json` (devDependencies)

**Interfaces:**
- Produces: a working `.test.tsx` path — later tasks may write component tests. `SignOutButton` is a `'use client'` component calling the `signOut` Server Action.

- [ ] **Step 1: Install the harness**

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Add the setup file**

`vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 3: Update `vitest.config.mts`**

Use `environmentMatchGlobs` so node-environment logic tests stay fast while component tests get jsdom, and widen `include` to pick up `.tsx`:

```ts
test: {
  environment: "node",
  environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
  setupFiles: ["./vitest.setup.ts"],
  include: ["src/**/*.test.{ts,tsx}"],
},
```

Keep the existing `plugins`, `resolve.alias` and ESM `__dirname` derivation exactly as they are.

- [ ] **Step 4: Write the failing component test**

`src/components/SignOutButton.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "./SignOutButton";

describe("SignOutButton", () => {
  it("renders an accessible sign-out control", () => {
    render(<SignOutButton onSignOut={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("invokes the sign-out action when clicked", async () => {
    const onSignOut = vi.fn();
    render(<SignOutButton onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Run it and watch it FAIL**

Run: `npx vitest run src/components/SignOutButton.test.tsx`
Expected: FAIL — cannot resolve `./SignOutButton`. If instead it reports "no test files found", the `include` glob in Step 3 is wrong — fix that before continuing.

- [ ] **Step 6: Implement**

`src/components/SignOutButton.tsx`:
```tsx
"use client";

export function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className="text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
    >
      Sign out
    </button>
  );
}
```

Taking the handler as a prop keeps this component free of server imports, so it is unit-testable; the caller wires it to the `signOut` Server Action.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run` — expect the 2 new tests plus Phase 0's 10 to pass, output pristine.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.mts vitest.setup.ts src/components package.json package-lock.json
git commit -m "test: add jsdom + Testing Library component test harness"
```

---

### Task 2: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** none (infrastructure).

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm test
      - run: npm run build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
          AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
      - run: npx tsc --noEmit
```

Order matters: `prisma generate` before lint/test (the client must exist), and `tsc --noEmit` AFTER `npm run build`, because Next generates the route types that type-checking needs.

- [ ] **Step 2: Note the secrets requirement**

The `build` step needs `DATABASE_URL`, `DIRECT_URL` and `AUTH_SECRET` as GitHub Actions repository secrets. **This requires the repository owner to add them** — the workflow will fail on `build` until they exist. Do NOT hardcode credentials as a workaround. Report this as a required manual follow-up rather than attempting it.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint, test, build and typecheck workflow"
```

---

### Task 3: Organizational schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_org_model/migration.sql` (generated)

**Interfaces:**
- Produces: `Location`, `Skill`, `ManagerLocation`, `StaffSkill`, `StaffLocationCertification` models, plus back-relations on `User`. Every later task in this phase and all of Phase 2 depends on these exact names.

- [ ] **Step 1: Add the models**

Append to `prisma/schema.prisma` (note every `DateTime` carries `@db.Timestamptz(3)`):

```prisma
model Location {
  id        String   @id @default(cuid())
  name      String
  timezone  String
  address   String?
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  managers       ManagerLocation[]
  certifications StaffLocationCertification[]
}

model Skill {
  id        String   @id @default(cuid())
  name      String   @unique
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  staffSkills StaffSkill[]
}

model ManagerLocation {
  id         String   @id @default(cuid())
  managerId  String
  locationId String
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  manager  User     @relation(fields: [managerId], references: [id], onDelete: Cascade)
  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@unique([managerId, locationId])
}

model StaffSkill {
  id        String   @id @default(cuid())
  staffId   String
  skillId   String
  createdAt DateTime @default(now()) @db.Timestamptz(3)

  staff User  @relation(fields: [staffId], references: [id], onDelete: Cascade)
  skill Skill @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([staffId, skillId])
}

model StaffLocationCertification {
  id          String    @id @default(cuid())
  staffId     String
  locationId  String
  certifiedAt DateTime  @default(now()) @db.Timestamptz(3)
  endedAt     DateTime? @db.Timestamptz(3)

  staff    User     @relation(fields: [staffId], references: [id], onDelete: Cascade)
  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@unique([staffId, locationId])
}
```

`endedAt` implements spec §5 decision 1: de-certification is a soft state change so historical shift data stays intact. Re-certifying clears `endedAt` rather than inserting a second row — the `@@unique` pair enforces one row per staff/location, and the Phase 3 audit trail records the cert/de-cert history.

- [ ] **Step 2: Add back-relations to `User`**

Inside the existing `User` model, add:
```prisma
  managerLocations ManagerLocation[]
  staffSkills      StaffSkill[]
  certifications   StaffLocationCertification[]
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npx prisma migrate dev --name org_model
```

- [ ] **Step 4: Verify the generated SQL uses TIMESTAMPTZ**

```bash
grep -i "TIMESTAMP" prisma/migrations/*_org_model/migration.sql
```
Expected: every timestamp column reads `TIMESTAMPTZ(3)`. If any says plain `TIMESTAMP(3)`, a `@db.Timestamptz(3)` is missing — fix the schema and regenerate before committing.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add location, skill and staff assignment models"
```

---

### Task 4: Authorization module

The final Phase 0 review flagged that per-page `auth()` + `redirect()` will get copy-pasted across many protected routes and one copy will eventually be wrong. This centralizes it while there is still exactly one call site to migrate.

**Files:**
- Create: `src/lib/authz.ts`, `src/lib/authz.test.ts`
- Modify: `src/app/dashboard/page.tsx` (migrate to the helper)

**Interfaces:**
- Consumes: `auth` from `@/auth`, `prisma` from `@/lib/prisma`.
- Produces:
  - `type SessionUser = { id: string; name: string; email: string; role: Role }`
  - `requireUser(): Promise<SessionUser>` — redirects to `/login` when unauthenticated
  - `requireRole(...roles: Role[]): Promise<SessionUser>` — redirects to `/dashboard` when the role doesn't match
  - `visibleLocationIds(user: SessionUser): Promise<string[] | "ALL">` — `"ALL"` for ADMIN, assigned ids for MANAGER, certified ids for STAFF
  - `assertCanManageLocation(user: SessionUser, locationId: string): Promise<void>` — throws `ForbiddenError` when not permitted
  - `class ForbiddenError extends Error`
- Consumed by: every admin page and Server Action in Tasks 5–7, and all of Phase 2.

- [ ] **Step 1: Write the failing tests**

`src/lib/authz.test.ts` — test the pure authorization logic by stubbing only the Prisma lookups, exactly as Phase 0's `auth-credentials.test.ts` does:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { visibleLocationIds, assertCanManageLocation, ForbiddenError } from "./authz";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    managerLocation: { findMany: vi.fn() },
    staffLocationCertification: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/prisma");

const admin = { id: "u1", name: "A", email: "a@x.test", role: "ADMIN" as const };
const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };
const staff = { id: "u3", name: "S", email: "s@x.test", role: "STAFF" as const };

beforeEach(() => {
  vi.mocked(prisma.managerLocation.findMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findMany).mockReset();
});

describe("visibleLocationIds", () => {
  it("gives admins everything without querying assignments", async () => {
    await expect(visibleLocationIds(admin)).resolves.toBe("ALL");
    expect(prisma.managerLocation.findMany).not.toHaveBeenCalled();
  });

  it("gives managers only their assigned locations", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([
      { locationId: "loc1" },
      { locationId: "loc2" },
    ] as never);
    await expect(visibleLocationIds(manager)).resolves.toEqual(["loc1", "loc2"]);
  });

  it("gives staff only locations they are actively certified for", async () => {
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      { locationId: "loc3" },
    ] as never);
    await expect(visibleLocationIds(staff)).resolves.toEqual(["loc3"]);
    // Ended certifications must be excluded at the query level
    expect(vi.mocked(prisma.staffLocationCertification.findMany).mock.calls[0][0]).toMatchObject({
      where: { staffId: "u3", endedAt: null },
    });
  });
});

describe("assertCanManageLocation", () => {
  it("allows an admin anywhere", async () => {
    await expect(assertCanManageLocation(admin, "anything")).resolves.toBeUndefined();
  });

  it("allows a manager at an assigned location", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([{ locationId: "loc1" }] as never);
    await expect(assertCanManageLocation(manager, "loc1")).resolves.toBeUndefined();
  });

  it("rejects a manager at an unassigned location", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([{ locationId: "loc1" }] as never);
    await expect(assertCanManageLocation(manager, "loc9")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects staff outright", async () => {
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([] as never);
    await expect(assertCanManageLocation(staff, "loc1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `npx vitest run src/lib/authz.test.ts`
Expected: FAIL — cannot resolve `./authz`.

- [ ] **Step 3: Implement `src/lib/authz.ts`**

```ts
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type SessionUser = { id: string; name: string; email: string; role: Role };

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id, name, email, role } = session.user;
  return { id, name: name ?? "", email: email ?? "", role };
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

export async function visibleLocationIds(user: SessionUser): Promise<string[] | "ALL"> {
  if (user.role === "ADMIN") return "ALL";
  if (user.role === "MANAGER") {
    const rows = await prisma.managerLocation.findMany({
      where: { managerId: user.id },
      select: { locationId: true },
    });
    return rows.map((r) => r.locationId);
  }
  const rows = await prisma.staffLocationCertification.findMany({
    where: { staffId: user.id, endedAt: null },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

export async function assertCanManageLocation(
  user: SessionUser,
  locationId: string,
): Promise<void> {
  if (user.role === "STAFF") throw new ForbiddenError();
  const visible = await visibleLocationIds(user);
  if (visible === "ALL") return;
  if (!visible.includes(locationId)) throw new ForbiddenError();
}
```

Note `requireUser` reads `session.user.id` — if Phase 0's JWT callback does not currently put `id` on the session, add it there (`token.sub` → `session.user.id`) and say so in your report, since the whole module depends on it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/authz.test.ts` — expect all 7 passing.

- [ ] **Step 5: Migrate the dashboard to the helper**

In `src/app/dashboard/page.tsx`, replace the inline `auth()` + `redirect("/login")` with `const user = await requireUser();` and render from `user`. Keep the existing rendered strings "Signed in as {name}" and the bare role text — Phase 0's Playwright tests assert on them.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm test` and `npm run test:e2e` — all Phase 0 tests must still pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/authz.ts src/lib/authz.test.ts src/app/dashboard/page.tsx src/auth.ts
git commit -m "feat: add centralized authorization module"
```

---

### Task 5: Locations data layer + admin CRUD

**Files:**
- Create: `src/lib/locations.ts`, `src/lib/locations.test.ts`
- Create: `src/app/admin/locations/page.tsx`, `src/app/admin/locations/actions.ts`

**Interfaces:**
- Consumes: `prisma`, `requireRole`, `assertCanManageLocation`, `ForbiddenError`.
- Produces:
  - `listLocations(user: SessionUser): Promise<Location[]>` — scoped by `visibleLocationIds`
  - `createLocation(input: { name: string; timezone: string; address?: string }): Promise<Location>`
  - `updateLocation(id: string, input: { name?: string; timezone?: string; address?: string }): Promise<Location>`
  - `isValidTimezone(tz: string): boolean`
- Consumed by: Task 7 (certifications reference locations), Phase 2 (shifts belong to locations).

- [ ] **Step 1: Write the failing tests**

`src/lib/locations.test.ts`. Cover: (a) `isValidTimezone` accepts "America/New_York" and "America/Los_Angeles" and rejects "Not/AZone" and ""; (b) `createLocation` rejects an invalid timezone before touching the database; (c) `listLocations` returns everything for an admin and filters by id for a manager. Mock only `@/lib/prisma`, following the pattern in `authz.test.ts`.

Write real assertions — for (b), assert that `prisma.location.create` was NOT called when the timezone is invalid.

```ts
it("rejects an invalid timezone before writing", async () => {
  await expect(
    createLocation({ name: "Bad", timezone: "Not/AZone" }),
  ).rejects.toThrow(/timezone/i);
  expect(prisma.location.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `npx vitest run src/lib/locations.test.ts`

- [ ] **Step 3: Implement `src/lib/locations.ts`**

Validate timezones with the platform, not a hardcoded list:

```ts
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

`createLocation`/`updateLocation` throw a clear `Error` when `isValidTimezone` fails, before any database call. `listLocations` calls `visibleLocationIds` and, when the result is not `"ALL"`, filters with `where: { id: { in: ids } }`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Build the admin page and actions**

`src/app/admin/locations/actions.ts` — `"use server"` module. Each action calls `await requireRole("ADMIN")` FIRST, then validates, then writes, then `revalidatePath("/admin/locations")`. Never accept a role or permission flag from the form payload.

`src/app/admin/locations/page.tsx` — Server Component: `const user = await requireRole("ADMIN")`, list existing locations in a table (name, timezone, address), and a create form bound to the Server Action. Keep the styling restrained per CLAUDE.md — type and spacing, real `<label>`s, visible focus states, no decoration.

Timezone input: a `<select>` listing at least the two timezones the brief requires (`America/New_York`, `America/Los_Angeles`) plus `America/Chicago` and `America/Denver`. A free-text field that can silently hold an invalid IANA name is worse here.

- [ ] **Step 6: Manual verification**

Start the dev server, sign in as the seeded admin, create a location, confirm it appears in the list and persists across a reload.

- [ ] **Step 7: Commit**

```bash
git add src/lib/locations.ts src/lib/locations.test.ts src/app/admin/locations
git commit -m "feat: add location management for admins"
```

---

### Task 6: Skills data layer + admin CRUD

**Files:**
- Create: `src/lib/skills.ts`, `src/lib/skills.test.ts`
- Create: `src/app/admin/skills/page.tsx`, `src/app/admin/skills/actions.ts`

**Interfaces:**
- Produces: `listSkills(): Promise<Skill[]>`, `createSkill(name: string): Promise<Skill>`.
- Consumed by: Task 7 (assigning skills to staff), Phase 2 (shifts require a skill).

- [ ] **Step 1: Write the failing tests**

Cover: `createSkill` trims whitespace and rejects an empty/whitespace-only name without calling the database; duplicate names surface a clear error (the `@unique` constraint throws `P2002` — catch it and rethrow with a readable message rather than leaking the Prisma error).

- [ ] **Step 2: Run and watch it FAIL**

- [ ] **Step 3: Implement `src/lib/skills.ts`**

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Build the admin page and actions**

Same shape as Task 5: `requireRole("ADMIN")` first in every action, `revalidatePath` after writes, restrained UI.

- [ ] **Step 6: Commit**

```bash
git add src/lib/skills.ts src/lib/skills.test.ts src/app/admin/skills
git commit -m "feat: add skill management for admins"
```

---

### Task 7: Staff assignment — skills and location certifications

**Files:**
- Create: `src/app/admin/staff/page.tsx`, `src/app/admin/staff/actions.ts`
- Modify: `src/lib/locations.ts` or create `src/lib/staff-assignments.ts` (your call; keep files focused)
- Test: alongside whichever module holds the logic

**Interfaces:**
- Produces:
  - `assignSkill(staffId: string, skillId: string): Promise<void>` / `removeSkill(...)`
  - `certifyStaff(staffId: string, locationId: string): Promise<void>` — creates the row, or clears `endedAt` if one exists
  - `decertifyStaff(staffId: string, locationId: string): Promise<void>` — sets `endedAt = now()`, never deletes
- Consumed by: Phase 2's constraint engine (skill match, location certification).

- [ ] **Step 1: Write the failing tests**

The important behavioral cases, all with real assertions:
- `decertifyStaff` performs an UPDATE setting `endedAt`, and never a DELETE — assert `prisma.staffLocationCertification.delete` was not called. This is spec §5 decision 1 and it must not regress.
- `certifyStaff` on a previously ended certification clears `endedAt` (re-certification) rather than failing on the unique constraint.
- `assignSkill` is idempotent — assigning an already-held skill does not throw.

- [ ] **Step 2: Run and watch it FAIL**

- [ ] **Step 3: Implement**

Use `upsert` for `certifyStaff` (`create` with `endedAt: null`, `update` with `endedAt: null`) so re-certification works against the `@@unique([staffId, locationId])` constraint.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Build the admin page and actions**

`requireRole("ADMIN")` in every action. The page lists staff users with their current skills and active certifications, and offers controls to add/remove. Show ended certifications distinctly (e.g. a muted "ended <date>" row) rather than hiding them — the soft-delete is the point.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add staff skill and certification assignment"
```

---

### Task 8: Authenticated app shell with navigation and sign-out

Phase 0 shipped no way to sign out, which blocks demoing the three roles.

**Files:**
- Create: `src/app/(app)/layout.tsx` OR modify `src/app/layout.tsx` (your call — do not break the existing `/login` page, which must stay reachable when signed out)
- Modify: `src/app/dashboard/page.tsx`
- Uses: `src/components/SignOutButton.tsx` from Task 1

**Interfaces:**
- Produces: a nav visible on authenticated pages, linking to the admin sections for ADMIN only, plus a working sign-out.

- [ ] **Step 1: Wire sign-out**

A Server Action calling `signOut({ redirectTo: "/login" })` from `@/auth`, passed into `SignOutButton`.

- [ ] **Step 2: Build the nav**

Show the signed-in user's name and role, a link to `/dashboard`, and — only when `user.role === "ADMIN"` — links to `/admin/locations`, `/admin/skills`, `/admin/staff`. Hiding links is presentation only; the real enforcement is `requireRole` in each page and action.

- [ ] **Step 3: Verify the Phase 0 E2E tests still pass**

`npm run test:e2e` — the dashboard must still render "Signed in as Alex Admin" and "ADMIN", and `/login` must still be reachable unauthenticated.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add authenticated app shell with nav and sign out"
```

---

### Task 9: Seed the Coastal Eats organization

**Files:**
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: the demo dataset every later phase and the evaluator's walkthrough depend on.

- [ ] **Step 1: Extend the seed**

Keep it idempotent (`upsert` throughout, refreshing `passwordHash` as Phase 0 established). Seed:

- **4 locations across 2 timezones** (the brief's premise): e.g. "Harbor Point" and "Bayside" in `America/New_York`; "Pier 39" and "Sunset Grill" in `America/Los_Angeles`.
- **4 skills**: `bartender`, `line cook`, `server`, `host`.
- **1 admin** (existing "Alex Admin").
- **2 managers**, each assigned to 2 locations — one per timezone, so cross-timezone behavior is demonstrable.
- **6–8 staff** with varied skills and certifications, including at least one certified at locations in BOTH timezones (this is the brief's "Timezone Tangle" scenario and Phase 2 will need it).

Give every seeded user a password following the existing public-demo convention and a `homeTimezone` matching their primary location.

- [ ] **Step 2: Run and verify**

```bash
npx prisma db seed
npx prisma db seed   # twice — must stay idempotent, no duplicates
```

Then query counts to confirm: 4 locations, 4 skills, expected user count, and at least one staff member with certifications in two distinct timezones.

- [ ] **Step 3: Update the README**

Add the new demo logins (roles, emails, password) so an evaluator can sign in as each role. This is a stated deliverable of the brief.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts README.md
git commit -m "feat: seed Coastal Eats locations, skills, managers and staff"
```

---

### Task 10: End-to-end authorization tests

**Files:**
- Create: `e2e/admin-crud.spec.ts`, `e2e/authorization.spec.ts`

**Interfaces:** none — terminal verification for this phase.

- [ ] **Step 1: Write the admin CRUD flow test**

Sign in as the admin, go to `/admin/locations`, create a location with a unique generated name, assert it appears in the list. Use a unique name per run (e.g. suffix with `Date.now()`) so the test is safe to re-run against the shared database.

- [ ] **Step 2: Write the authorization test**

This is the important one. Sign in as a seeded MANAGER, navigate to `/admin/locations`, and assert the manager is redirected to `/dashboard` and does NOT see the location-management UI. Then do the same for a STAFF user.

Make sure it would genuinely fail if `requireRole` were removed — assert on the absence of a control that only the admin page renders, not merely on the URL.

- [ ] **Step 3: Run the full E2E suite**

`npm run test:e2e` — Phase 0's 3 tests plus these must all pass.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test: cover admin CRUD and role-based route authorization"
```

---

## Self-Review Notes

- **Spec coverage:** implements spec §3's `Location`, `Skill`, `ManagerLocation`, `StaffSkill`, `StaffLocationCertification`; spec §5 decision 1 (soft de-certification via `endedAt`); and the brief's "managers can only see/manage locations they're assigned to / admins see everything" via `src/lib/authz.ts`. Availability windows, shifts, and the constraint engine are deliberately Phase 2.
- **Known deferrals:** `homeTimezone` still uses a column default rather than deriving from first certification (spec §5) — revisit when the staff self-service profile lands. Login rate limiting remains open. E2E still runs against the production database; that must be resolved before Phase 3 writes mutating E2E tests.
- **Type consistency:** `SessionUser` and Prisma's `Role` are threaded from `authz.ts` through every page and action; `visibleLocationIds` returns `string[] | "ALL"` everywhere, never `null`.
