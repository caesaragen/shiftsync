# ShiftSync Phase 0: Scaffold & Foundation Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working, deployed, end-to-end vertical slice — Next.js app, Postgres via Prisma/Supabase, NextAuth login, one protected page — so every later phase builds on a proven pipeline instead of discovering integration problems late.

**Architecture:** Next.js 15 App Router with TypeScript strict, styled with Tailwind v4. Prisma ORM talks to a Supabase-hosted Postgres instance (pooled connection for serverless). NextAuth (Auth.js v5) Credentials provider backed by the same DB via a Prisma adapter, JWT sessions. Deployed to Vercel via GitHub integration (push to `main` auto-deploys).

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4, Prisma, PostgreSQL (Supabase), NextAuth v5 (`next-auth@beta`), `@auth/prisma-adapter`, bcryptjs, Vitest, Testing Library, Playwright, Husky + lint-staged.

**Spec:** [docs/superpowers/specs/2026-09-19-shiftsync-design.md](../specs/2026-09-19-shiftsync-design.md)

## Global Constraints

- TypeScript only, `strict: true`, no `any` without an explicit inline justification comment (CLAUDE.md).
- Server Components by default; `'use client'` only where interactivity genuinely requires it (CLAUDE.md).
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`) — small, atomic, one logical change each (CLAUDE.md).
- Never commit directly to `main`. This plan's work happens on `feature/*` branches off `develop`, merged via PR; only Task 12 touches `main`, and only via the `develop`→`main` release step (CLAUDE.md).
- TDD (red → green → refactor) for all application logic; no feature is "done" without its tests committed in the same task (CLAUDE.md).
- Files stay small and single-responsibility; split when a file exceeds ~150–200 lines (CLAUDE.md).
- All money/time-sensitive values in this app are UTC `timestamptz` at the DB layer — established here even though this phase has no time-based models yet (spec §3).

---

## File Structure

```
shiftsync/
├── prisma/
│   ├── schema.prisma        # User model, Role enum (this phase)
│   └── seed.ts               # Seeds one ADMIN user
├── src/
│   ├── auth.ts                # NextAuth config (Credentials provider, JWT callbacks)
│   ├── app/
│   │   ├── login/page.tsx     # Login form (Server Action -> signIn)
│   │   ├── dashboard/page.tsx # Protected page, reads session
│   │   └── api/auth/[...nextauth]/route.ts  # NextAuth route handlers
│   └── lib/
│       ├── prisma.ts          # Singleton PrismaClient
│       └── password.ts        # hashPassword/verifyPassword (bcryptjs wrapper)
├── e2e/
│   └── login.spec.ts          # Playwright smoke test
├── playwright.config.ts
├── vitest.config.ts
├── .husky/pre-commit
├── .env.example
└── .env.local                 # gitignored, real secrets
```

Each task below creates or touches a subset of this tree and ends with something you can run and verify.

---

### Task 1: Create the GitHub repository and push existing history

**Files:** none (repo-level operation only)

**Interfaces:** N/A

- [ ] **Step 1: Create the public repo under the authenticated account**

```bash
cd /Users/caesar/Developer/projects/ShiftSync
gh repo create shiftsync --public --source=. --remote=origin --description "ShiftSync — multi-location staff scheduling platform (Priority Soft full-stack assessment)"
```

Expected: prints the new repo URL (`https://github.com/caesaragen/shiftsync`) and adds `origin` remote.

- [ ] **Step 2: Push `main` and `develop`, set `develop` as the repo's default branch**

```bash
git push -u origin main
git push -u origin develop
gh repo edit caesaragen/shiftsync --default-branch develop
```

Expected: both branches visible on GitHub; repo's default branch is `develop` (matches CLAUDE.md's branch model — `develop` is where PRs land and CI runs).

- [ ] **Step 3: Verify**

```bash
gh repo view caesaragen/shiftsync --json defaultBranchRef,visibility
```

Expected: `defaultBranchRef.name` is `develop`, `visibility` is `PUBLIC`.

- [ ] **Step 4: Commit**

Nothing to commit locally — this task is pure repo/remote setup. Proceed to Task 2.

---

### Task 2: Scaffold the Next.js app in place

**Files:**
- Create: everything `create-next-app` generates (`package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.eslintrc`/`eslint.config.mjs`, `.gitignore`, `public/`)
- Temporarily move aside: `CLAUDE.md`, `README.md`, `docs/`

**Interfaces:** N/A (pure scaffold)

`create-next-app` refuses to run in a directory containing files it doesn't recognize. `CLAUDE.md`, `README.md`, and `docs/` aren't on its allow-list, so move them out, scaffold, then move them back.

- [ ] **Step 1: Move existing files aside**

```bash
cd /Users/caesar/Developer/projects/ShiftSync
mkdir -p /tmp/shiftsync-preserve
mv CLAUDE.md README.md docs /tmp/shiftsync-preserve/
```

- [ ] **Step 2: Run create-next-app non-interactively**

```bash
npx --yes create-next-app@latest . \
  --typescript --app --eslint --tailwind --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack
```

Expected: exits 0, creates `package.json`, `src/app/`, `tsconfig.json`, etc.

- [ ] **Step 3: Restore the preserved files**

```bash
mv /tmp/shiftsync-preserve/CLAUDE.md /tmp/shiftsync-preserve/docs .
# Keep the generated README's Next.js quickstart, but prepend our empty
# project README wasn't holding content, so just drop the generated one in:
mv /tmp/shiftsync-preserve/README.md ./README.md
rmdir /tmp/shiftsync-preserve
```

- [ ] **Step 4: Verify the dev server boots**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
kill %1
```

Expected: prints `200`.

- [ ] **Step 5: Verify TypeScript strict mode is on**

```bash
grep '"strict": true' tsconfig.json
```

Expected: one match. (If `create-next-app` didn't set it, add `"strict": true` under `compilerOptions` in `tsconfig.json` now.)

- [ ] **Step 6: Commit**

```bash
git checkout -b feature/scaffold develop
git add -A
git commit -m "chore: scaffold Next.js app with TypeScript, App Router, Tailwind"
```

---

### Task 3: ESLint + Prettier + Husky + lint-staged pre-commit hook

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`, `.husky/pre-commit`
- Modify: `package.json` (add `lint-staged` config, `prepare` script, devDependencies)

**Interfaces:** N/A

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev prettier eslint-config-prettier husky lint-staged
```

- [ ] **Step 2: Add Prettier config**

`.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

`.prettierignore`:
```
.next
node_modules
docs
```

- [ ] **Step 3: Make ESLint defer to Prettier for formatting**

In `eslint.config.mjs`, add `"prettier"` to the `extends` array (or the flat-config equivalent import from `eslint-config-prettier`) so ESLint doesn't fight Prettier on formatting rules.

- [ ] **Step 4: Add lint-staged config to `package.json`**

```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css}": ["prettier --write"]
}
```

- [ ] **Step 5: Initialize Husky and wire the pre-commit hook**

```bash
npx husky init
```

Replace the generated `.husky/pre-commit` contents with:
```bash
npx lint-staged
```

- [ ] **Step 6: Verify the hook runs**

```bash
echo "const x=1" >> src/app/page.tsx
git add src/app/page.tsx
git commit -m "test: verify pre-commit hook"
git log -1 --stat
git diff HEAD~1 HEAD -- src/app/page.tsx
```

Expected: the commit succeeds and the diff shows Prettier's formatting applied to the line you added (semicolon/spacing normalized), proving the hook ran. Then revert this throwaway change:

```bash
git reset --hard HEAD~1
```

- [ ] **Step 7: Commit the real change**

```bash
git add -A
git commit -m "chore: add Prettier, Husky pre-commit hook, and lint-staged"
```

---

### Task 4: Prisma + Supabase connection

**Files:**
- Create: `prisma/schema.prisma`, `.env.example`
- Modify: `.gitignore` (ensure `.env.local` is ignored — `create-next-app` already does this, verify)

**Interfaces:**
- Produces: `DATABASE_URL`, `DIRECT_URL` env vars, consumed by every later task that touches the DB.

- [ ] **Step 1: Install Prisma**

```bash
npm install prisma --save-dev
npm install @prisma/client
npx prisma init --datasource-provider postgresql
```

Expected: creates `prisma/schema.prisma` and `.env`.

- [ ] **Step 2: Get Supabase credentials (manual — requires your input)**

This step needs a real account and can't be automated:

1. Go to https://supabase.com, create a free project (any name/region).
2. In the project's Settings → Database, copy:
   - **Connection pooling** string (Transaction mode, port `6543`) → this is `DATABASE_URL`
   - **Direct connection** string (port `5432`) → this is `DIRECT_URL`
3. Paste both into `.env.local` (see Step 3) and tell me you've done this so I can continue.

- [ ] **Step 3: Configure env files**

`.env.example` (committed):
```
DATABASE_URL="postgresql://postgres:[password]@[host]:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@[host]:5432/postgres"
AUTH_SECRET="generate-with-npx-auth-secret"
```

`.env.local` (gitignored — real values from Step 2, plus a real `AUTH_SECRET`):
```bash
npx auth secret
```
This command prints a secret and can write it directly into `.env.local` — confirm it landed under `AUTH_SECRET=`.

- [ ] **Step 4: Point Prisma's datasource at both URLs**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

- [ ] **Step 5: Verify the connection**

```bash
npx prisma db pull
```

Expected: connects successfully and reports an empty schema (no tables yet) — confirms both URLs are valid before we add any models.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma .env.example .gitignore
git commit -m "chore: add Prisma with Supabase Postgres connection"
```

(`.env.local` is never committed — verify with `git status` that it doesn't appear.)

---

### Task 5: User model, first migration, Prisma client singleton

**Files:**
- Modify: `prisma/schema.prisma` (add `Role` enum, `User` model)
- Create: `src/lib/prisma.ts`
- Test: `src/lib/prisma.test.ts`

**Interfaces:**
- Produces: `PrismaClient` singleton exported as `prisma` from `@/lib/prisma`; `User` model with fields `id, name, email, passwordHash, role, homeTimezone, createdAt, updatedAt`; `Role` enum `ADMIN | MANAGER | STAFF`.
- Consumed by: Task 6 (NextAuth), Task 7 (login/dashboard pages), Task 8 (seed script).

- [ ] **Step 1: Write the failing test for the Prisma singleton**

`src/lib/prisma.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("prisma client singleton", () => {
  it("exports a single shared PrismaClient instance across imports", async () => {
    const mod2 = await import("./prisma");
    expect(mod2.prisma).toBe(prisma);
  });
});
```

(This test needs Vitest installed — that happens in Task 10. For now, write the file; you'll run it once Vitest exists. If you're doing Task 10 out of order to unblock this, that's fine — just don't skip writing the test first.)

- [ ] **Step 2: Add the `Role` enum and `User` model**

`prisma/schema.prisma` (append):
```prisma
enum Role {
  ADMIN
  MANAGER
  STAFF
}

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role
  homeTimezone String   @default("America/New_York")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 3: Run the first migration**

```bash
npx prisma migrate dev --name init_user
```

Expected: creates `prisma/migrations/<timestamp>_init_user/migration.sql`, applies it to Supabase, regenerates the Prisma client.

- [ ] **Step 4: Implement the Prisma client singleton**

`src/lib/prisma.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

(The global caching avoids exhausting Postgres connections from Next.js dev-mode hot reload creating a new client on every file change.)

- [ ] **Step 5: Run the test to verify it passes**

Deferred until Task 10 installs Vitest — see that task's Step 4, which runs the full suite including this file.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/prisma.ts src/lib/prisma.test.ts
git commit -m "feat: add User model, first migration, and Prisma client singleton"
```

---

### Task 6: Password hashing utility

**Files:**
- Create: `src/lib/password.ts`
- Test: `src/lib/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.
- Consumed by: Task 7 (NextAuth `authorize`), Task 8 (seed script).

- [ ] **Step 1: Install bcryptjs**

```bash
npm install bcryptjs
npm install --save-dev @types/bcryptjs
```

- [ ] **Step 2: Write the failing tests**

`src/lib/password.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/password.test.ts`
Expected: FAIL — `Cannot find module './password'` (Vitest itself gets installed in Task 10; if running this before Task 10, install Vitest now per Task 10 Steps 1–2 first, then return here).

- [ ] **Step 4: Implement**

`src/lib/password.ts`:
```ts
import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/password.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/password.ts src/lib/password.test.ts package.json package-lock.json
git commit -m "feat: add password hashing utility with tests"
```

---

### Task 7: NextAuth (Auth.js v5) Credentials provider

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`
- Modify: `next.config.ts` if middleware matcher is needed (not required for this phase — skip unless verification in Step 4 fails)

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma` (Task 5), `verifyPassword` from `@/lib/password` (Task 6).
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` exported from `@/auth`. Session's `user` object carries a `role: "ADMIN" | "MANAGER" | "STAFF"` field (added via callbacks) — later phases' authorization checks depend on reading `session.user.role`.

- [ ] **Step 1: Install NextAuth v5 and the Prisma adapter**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

- [ ] **Step 2: Write `src/auth.ts`**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
```

- [ ] **Step 3: Write the route handler**

`src/app/api/auth/[...nextauth]/route.ts`:
```ts
export { GET, POST } from "@/auth";
```

- [ ] **Step 4: Verify the provider is wired**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/api/auth/providers
kill %1
```

Expected: JSON response containing `"credentials"` as a provider id.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/app/api/auth package.json package-lock.json
git commit -m "feat: add NextAuth Credentials provider with Prisma adapter"
```

---

### Task 8: Seed script for one admin user

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (add `prisma.seed` config, `tsx` devDependency)

**Interfaces:**
- Consumes: `hashPassword` from `@/lib/password` (Task 6).
- Produces: one `User` row — `admin@coastaleats.test` / `admin123!` / role `ADMIN` — that Task 11's E2E test and every later phase's manual testing depend on as the known-good login.

- [ ] **Step 1: Install tsx (to run TypeScript seed scripts directly)**

```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Add the seed config to `package.json`**

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 3: Write the seed script**

`prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("admin123!");
  await prisma.user.upsert({
    where: { email: "admin@coastaleats.test" },
    update: {},
    create: {
      name: "Alex Admin",
      email: "admin@coastaleats.test",
      passwordHash,
      role: "ADMIN",
      homeTimezone: "America/New_York",
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 4: Run it and verify**

```bash
npx prisma db seed
npx prisma studio --browser none &
sleep 2
curl -s http://localhost:5555 -o /dev/null -w "%{http_code}\n"
kill %1
```

Or more directly, verify via a one-off query:
```bash
npx tsx -e "import { prisma } from './src/lib/prisma'; prisma.user.findUnique({ where: { email: 'admin@coastaleats.test' } }).then(u => { console.log(u); process.exit(0); })"
```
Expected: prints the seeded user with `role: 'ADMIN'`.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts package.json package-lock.json
git commit -m "feat: add seed script for admin demo user"
```

---

### Task 9: Login page and protected dashboard page

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `signIn`, `auth` from `@/auth` (Task 7).
- Produces: `/login` route (public), `/dashboard` route (redirects to `/login` if unauthenticated) — every later phase's authenticated pages follow this same `auth()` + `redirect()` pattern.

- [ ] **Step 1: Write the login page**

`src/app/login/page.tsx`:
```tsx
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=invalid");
    }
    throw error;
  }
}

export default function LoginPage() {
  return (
    <form action={login} className="mx-auto mt-24 flex max-w-sm flex-col gap-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        className="rounded border px-3 py-2"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        className="rounded border px-3 py-2"
      />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Sign in
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write the protected dashboard page**

`src/app/dashboard/page.tsx`:
```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as typeof session.user & { role?: string }).role;

  return (
    <main className="mx-auto mt-24 max-w-sm text-center">
      <p>Signed in as {session.user.name}</p>
      <p className="text-sm text-gray-500">{role}</p>
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
Visit `http://localhost:3000/login`, sign in with `admin@coastaleats.test` / `admin123!`. Expected: redirected to `/dashboard`, page shows "Signed in as Alex Admin" and "ADMIN". Visiting `/dashboard` in a private/incognito window (no session) should redirect to `/login`.

- [ ] **Step 4: Commit**

```bash
git add src/app/login src/app/dashboard
git commit -m "feat: add login page and protected dashboard page"
```

---

### Task 10: Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `npm test` running all `*.test.ts` files under `src/`.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest @vitejs/plugin-react
```

- [ ] **Step 2: Write the config**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the `test` script**

`package.json`:
```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 4: Run the full suite (this also verifies Tasks 5 and 6's deferred tests)**

```bash
npm test
```

Expected: PASS — `src/lib/prisma.test.ts` (1 test) and `src/lib/password.test.ts` (2 tests) all green.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add Vitest and run the deferred unit test suite"
```

---

### Task 11: Playwright E2E smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/login.spec.ts`
- Modify: `package.json` (add `test:e2e` script)

**Interfaces:**
- Consumes: the seeded admin user from Task 8, the login/dashboard pages from Task 9.
- Produces: `npm run test:e2e`, the pattern every later phase's E2E tests (Phases 2–4's critical-flow tests, per spec §7) follow.

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Write the config**

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] **Step 3: Write the failing test**

`e2e/login.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("admin can log in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("admin@coastaleats.test");
  await page.getByPlaceholder("Password").fill("admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Signed in as Alex Admin")).toBeVisible();
  await expect(page.getByText("ADMIN")).toBeVisible();
});
```

- [ ] **Step 4: Add the script and run it**

`package.json`:
```json
"scripts": {
  "test:e2e": "playwright test"
}
```

```bash
npm run test:e2e
```

Expected: PASS, 1/1 test. (It should already pass since Tasks 8–9 built the pieces it exercises — this test's role is to lock the flow in place for regressions, not to drive new implementation.)

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json .gitignore
git commit -m "test: add Playwright E2E smoke test for login flow"
```

(Verify `.gitignore` excludes `/test-results` and `/playwright-report`, which `npx playwright install` may not add automatically — add them if missing.)

---

### Task 12: Merge to `develop`, release to `main`, deploy to Vercel

**Files:** none (git + deployment operations)

**Interfaces:** N/A — terminal task for this phase.

- [ ] **Step 1: Open and merge the PR into `develop`**

```bash
git push -u origin feature/scaffold
gh pr create --base develop --head feature/scaffold \
  --title "Phase 0: scaffold, auth, and deployed foundation slice" \
  --body "Implements docs/superpowers/plans/2026-09-19-phase0-scaffold.md. Next.js + Prisma/Supabase + NextAuth, seeded admin login, Vitest + Playwright smoke tests all green."
gh pr merge --squash --delete-branch
```

- [ ] **Step 2: Release `develop` → `main`**

```bash
git checkout main
git pull origin main
git merge origin/develop --ff-only
git push origin main
```

- [ ] **Step 3: Create the Vercel project linked to the GitHub repo**

Use the Vercel MCP tools available in this session:
1. Call `list_teams` (or `get_auth_user`) to identify the target team/scope.
2. Call `create_project` with `name: "shiftsync"`, linking it to the `caesaragen/shiftsync` GitHub repo, framework `nextjs`, and set the **Production Branch** to `main`.
3. Call `create_project_env` (or `filter_project_envs` + `edit_project_env`) to set, for the Production environment: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` (same values as your `.env.local`), and `AUTH_URL` set to the project's eventual production URL (Vercel assigns this — you can add/update it once the first deployment gives you the URL).

- [ ] **Step 4: Trigger and verify the first deployment**

The GitHub integration auto-deploys on the push to `main` from Step 2. Poll it:
1. Call `list_deployments` for the project, find the deployment tied to the latest `main` commit.
2. Call `get_deployment` until `readyState` is `READY` (or `ERROR` — if it errors, read `get_runtime_logs`/build logs and fix before continuing).

- [ ] **Step 5: Verify the live deployment**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<production-url>/login
```

Expected: `200`. Then manually sign in at that URL with the seeded admin credentials and confirm you reach `/dashboard`.

- [ ] **Step 6: Update the design spec's status**

In `docs/superpowers/specs/2026-09-19-shiftsync-design.md`, no changes needed — Phase 0 completion is tracked by this plan file's checkboxes, not the spec. Commit nothing here; this step is a no-op confirmation.

---

## Self-Review Notes

- **Spec coverage**: this phase implements spec §2 (stack decisions — all six rows: Next.js, Tailwind, Supabase Postgres, Prisma, NextAuth, Vercel) and the testing tools from §7 (Vitest, Testing Library harness present though no component test yet — first one arrives in Phase 1 with real UI beyond a login form —, Playwright). §3–§6 (data model beyond `User`, constraint engine, timezone handling, realtime) are explicitly out of scope for Phase 0 and belong to Phases 1–4.
- **Placeholder scan**: no TBDs; the one genuinely external, non-automatable step (Task 4 Step 2, Supabase credentials) is called out explicitly as manual rather than glossed over.
- **Type consistency**: `role` is threaded consistently as `"ADMIN" | "MANAGER" | "STAFF"` (the Prisma `Role` enum) from the DB (Task 5) through NextAuth's `authorize`/callbacks (Task 7) to the dashboard page (Task 9). `hashPassword`/`verifyPassword` signatures (Task 6) match their call sites in Task 7's `authorize` and Task 8's seed script exactly.
