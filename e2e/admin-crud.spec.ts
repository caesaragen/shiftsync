import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// This spec runs against the live, shared Supabase database — there is no
// separate test database yet (see README "Known limitations"). That
// database IS the demo dataset an evaluator clicks through, so every row
// this test creates must be removed again, or repeated runs bury the real
// seeded Coastal Eats locations under timestamped test rows. Do NOT delete
// this cleanup as redundant ceremony: without it, a single run leaves a
// permanent orphan row.
//
// The `next dev` server started by playwright.config.ts's `webServer`
// loads its own env vars, but this test process talks to Postgres
// directly for cleanup, so it needs its own copy.
try {
  process.loadEnvFile();
} catch {
  // No local .env file (e.g. CI) — assume DATABASE_URL etc. are already
  // present in the environment.
}

const prisma = new PrismaClient();

// Set right after the test generates its unique name, so afterEach can
// clean up even if a later assertion throws.
let createdLocationName: string | undefined;

test.afterEach(async () => {
  if (!createdLocationName) return;
  const name = createdLocationName;
  createdLocationName = undefined;
  try {
    // Exact-name match only — never a prefix/pattern match — so this can
    // never touch seeded data (Harbor Point, Bayside, Pier 39, Sunset
    // Grill) or a row left by a different run.
    await prisma.location.deleteMany({ where: { name } });
  } catch (error) {
    // Best-effort: a cleanup failure must never mask the test's own
    // assertion failure, so it's logged rather than thrown.
    console.error(`admin-crud cleanup: failed to delete location "${name}":`, error);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("admin can create a location and see it appear in the list", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("admin@coastaleats.test");
  await page.getByPlaceholder("Password").fill("admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/admin/locations");
  await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();

  // Unique per run: this test writes to the shared database, so a fixed
  // name would collide across runs. Cleaned up in afterEach above.
  const locationName = `E2E Test Location ${Date.now()}`;
  createdLocationName = locationName;

  await page.getByLabel("Name").fill(locationName);
  await page.getByLabel("Timezone").selectOption("America/New_York");
  await page.getByRole("button", { name: "Add location" }).click();

  await expect(page).toHaveURL(/\/admin\/locations/);
  await expect(page.getByRole("cell", { name: locationName })).toBeVisible();
});
