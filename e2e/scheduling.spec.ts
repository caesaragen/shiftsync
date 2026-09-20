import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Same rationale as e2e/admin-crud.spec.ts: this suite runs against the
// live, shared Supabase database (no separate test database yet -- see
// README "Known limitations"). Every row this spec creates must be removed
// again, or repeated runs bury the real seeded Coastal Eats data under
// timestamped test rows. Do NOT delete the cleanup hook below as redundant
// ceremony: without it, a single run leaves a permanent orphan row.
//
// The `next dev` server started by playwright.config.ts's `webServer` loads
// its own env vars, but this test process talks to Postgres directly for
// cleanup, so it needs its own copy.
try {
  process.loadEnvFile();
} catch {
  // No local .env file (e.g. CI) -- assume DATABASE_URL etc. are already
  // present in the environment.
}

const prisma = new PrismaClient();

// Credentials read from prisma/seed.ts -- not invented here.
// Morgan Manager manages Harbor Point + Bayside (America/New_York).
// Jamie Manager manages Pier 39 + Sunset Grill (America/Los_Angeles).
const MANAGER_MORGAN = { email: "manager1@coastaleats.test", password: "manager1123!" };

// Far enough in the future that it can never collide with the seeded demo
// week (2026-09-21..27 -- see prisma/seed.ts) or a previous run's leftovers.
// 2027-06-07 is a Monday (`new Date(Date.UTC(2027, 5, 7)).getUTCDay() === 1`).
// America/New_York is on EDT (UTC-4) in June, so 09:00-13:00 ET is
// 13:00-17:00 UTC -- inside Sam Server's seeded recurring Mon 08:00-16:00 ET
// availability, and NOT a Friday/Saturday 17:00+ premium shift.
const SHIFT_START_UTC = new Date("2027-06-07T13:00:00.000Z"); // Mon 09:00 EDT
const SHIFT_END_UTC = new Date("2027-06-07T17:00:00.000Z"); // Mon 13:00 EDT
const WEEK_OF = "2027-06-07";
const RUN_MARKER = `e2e-scheduling-${Date.now()}`;

// Set right after the fixture shift is created, so afterEach can clean up
// even if a later assertion throws partway through the test.
let createdShiftId: string | undefined;

test.afterEach(async () => {
  if (!createdShiftId) return;
  const shiftId = createdShiftId;
  createdShiftId = undefined;
  try {
    // Exact-id delete only -- never a name/date-range match -- so this can
    // never touch a seeded shift or a row left by a different run.
    // `ShiftAssignment.shift` has `onDelete: Cascade` (prisma/schema.prisma),
    // so deleting the Shift row also removes any assignment this test made
    // against it -- no separate ShiftAssignment cleanup needed.
    await prisma.shift.deleteMany({ where: { id: shiftId } });
  } catch (error) {
    // Best-effort: a cleanup failure must never mask the test's own
    // assertion failure, so it's logged rather than thrown.
    console.error(`scheduling cleanup: failed to delete shift "${shiftId}":`, error);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("manager creates a shift, sees a blocked assignment, makes a valid one, and publishes the week", async ({
  page,
}) => {
  // Real database round trips (candidate-verdict computation, the
  // constraint-engine transaction) measured at ~4-6.5s each in production
  // (see src/lib/assign.ts's transaction-timeout comment) -- this single
  // test does several of them in sequence, so the default 30s test timeout
  // isn't enough.
  test.setTimeout(240_000);

  // --- Fixture setup: sign in and navigate to schedule ------------------
  const harborPoint = await prisma.location.findFirstOrThrow({ where: { name: "Harbor Point" } });

  // --- 1. Sign in as the seeded manager who owns Harbor Point ------------
  await login(page, MANAGER_MORGAN.email, MANAGER_MORGAN.password);

  // --- 2. Open the week schedule for a location they manage, via the
  //        real location + week picker controls -------------------------
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await page.getByLabel("Location").selectOption({ label: "Harbor Point" });
  await page.getByLabel("Week of").fill(WEEK_OF);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`locationId=${harborPoint.id}.*weekOf=${WEEK_OF}`));
  await expect(page.getByText("Manage shifts for Harbor Point")).toBeVisible();

  // --- 3. Create a shift via the real form --------------------------------
  // The "Create a shift" form is now fully present in the UI, bound to
  // createShiftAction (src/app/(app)/schedule/actions.ts), which successfully
  // creates the shift and revalidates the page. The form requires startAt,
  // endAt, and a non-blank requiredSkillId selection (the <select> has a
  // blank placeholder option, so the test must explicitly choose a real skill).
  //
  // The datetime-local input sends times in the browser's local timezone.
  // The browser will interpret "2027-06-07T HH:MM" as HH:MM in its local
  // timezone, then send it to the server (createShiftAction), which does
  // `new Date(string)` to parse it, also interpreting it as local time if
  // no timezone is specified. The database then stores it as UTC.
  //
  // We want the database to have SHIFT_START_UTC (13:00 UTC) and SHIFT_END_UTC
  // (17:00 UTC). If the browser is in offset O from UTC, we need to fill with
  // (13:00 UTC + O hours) and (17:00 UTC + O hours) in local time.
  //
  // For example, in EDT (UTC-4): 13:00 UTC + 4 hours = 17:00 EDT → wait, that's backwards.
  // Let me recalculate: 13:00 UTC is 09:00 EDT (UTC-4), so we fill "09:00".
  // In EAT (UTC+3): 13:00 UTC is 16:00 EAT, so we fill "16:00".
  //
  // Since the browser's timezone offset varies, we calculate it on the fly.
  // JavaScript's new Date("2027-06-07T HH:MM") interprets the string as local
  // time and returns a Date object. We can then see what UTC time it represents.
  // If filling "2027-06-07T13:00" results in 10:00 UTC, we know the offset is +3.
  // So to get a date that will be 13:00 UTC when parsed locally, we fill with:
  // (13:00 UTC + browser's UTC offset in hours) = local time to fill.
  const testDate = new Date("2027-06-07T12:00"); // arbitrary test value
  const testUTC = testDate.getUTCHours();
  const testLocal = testDate.getHours();
  const offsetHours = testLocal - testUTC; // e.g., EAT: 15 - 12 = +3

  const startLocalHours = 13 + offsetHours; // 13:00 UTC + offset = local time
  const endLocalHours = 17 + offsetHours; // 17:00 UTC + offset = local time

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const startLocal = `2027-06-07T${pad2(startLocalHours % 24)}:00`;
  const endLocal = `2027-06-07T${pad2(endLocalHours % 24)}:00`;

  await page.getByLabel("Start date & time").fill(startLocal);
  await page.getByLabel("End date & time").fill(endLocal);
  await page.getByLabel("Skill required").selectOption({ label: "server" });
  await page.getByLabel("Notes").fill(RUN_MARKER);
  await page.getByRole("button", { name: "Create shift", exact: true }).click();

  // The form submission triggers a redirect via the Server Action. Wait for
  // the page to navigate back to the schedule view.
  await page.waitForURL(new RegExp(`locationId=${harborPoint.id}.*weekOf=${WEEK_OF}`));

  // Occasionally, the revalidatePath call may not immediately reflect in the
  // UI if Next.js caching hasn't settled. Refetch the page to ensure we have
  // the latest shifts. This is still testing the form submission worked
  // (if it failed, the redirect wouldn't have happened).
  await page.reload();

  // Now confirm the shift was created and appears in the week grid
  await expect(page.getByText("9:00 AM EDT")).toBeVisible();

  // Extract the shift ID from the database query after confirming it's there
  // so cleanup can remove it (this test will clean up via afterEach).
  const shift = await prisma.shift.findFirstOrThrow({
    where: {
      locationId: harborPoint.id,
      startAt: SHIFT_START_UTC,
      endAt: SHIFT_END_UTC,
      notes: { contains: RUN_MARKER },
    },
  });
  createdShiftId = shift.id;

  // Open the shift's detail page for the assignment tests below
  await page.goto(`/schedule/${shift.id}`);
  await expect(page.getByText("Harbor Point")).toBeVisible();

  // --- 4. Attempt an assignment that is predictably BLOCKED --------------
  // Casey Cook (staff3@coastaleats.test) is certified at Harbor Point (so
  // she appears as a candidate at all -- candidates are drawn from active
  // certifications, src/app/(app)/schedule/[shiftId]/page.tsx's
  // `loadCandidateVerdicts`), but her only skill is "line cook" (see
  // prisma/seed.ts) while this shift requires "server". checkEligibility's
  // SKILL_MISMATCH rule (src/lib/constraints/eligibility.ts) blocks her
  // deterministically, independent of availability or scheduling conflicts.
  const caseyRow = page.locator("label").filter({ hasText: "Casey Cook" });
  await expect(caseyRow).toBeVisible();
  await caseyRow.locator('input[type="radio"]').check();

  const skillMismatchMessage = page.getByText(
    /This shift requires server\. Casey Cook has line cook\./,
  );
  await expect(skillMismatchMessage).toBeVisible();
  await expect(page.getByText("Suggested alternatives")).toBeVisible();
  // Wait for the async suggestAlternativesAction fetch to settle one way or
  // the other, rather than sleeping an arbitrary amount of time.
  await expect(page.getByText("Looking for alternatives…")).toHaveCount(0);

  await page.getByRole("button", { name: "Assign", exact: true }).click();
  // The client-side preview is deliberately not the enforcement (see
  // AssignmentPanel.tsx's comment on the submit button) -- this confirms
  // the real server-side re-validation inside assignStaffToShift blocks it
  // too, and renders the same violation. `assignStaffToShift`'s own
  // transaction timeout is 15s (src/lib/assign.ts), so this genuinely can
  // take close to that long over real network latency -- give it more room
  // than the config's default 15s `expect` timeout.
  await expect(page.getByText("The assignment could not be completed:")).toBeVisible({
    timeout: 30_000,
  });
  await expect(skillMismatchMessage).toBeVisible();

  // --- 5. Make a valid assignment -----------------------------------------
  // Sam Server (staff1@coastaleats.test) is certified at Harbor Point, has
  // the "server" skill, and his seeded recurring Mon 08:00-16:00 ET
  // availability fully covers this Monday 09:00-13:00 ET shift. No other
  // assignment exists anywhere near this far-future date, so he is cleanly
  // eligible with no violations at all.
  const samRow = page.locator("label").filter({ hasText: "Sam Server" });
  await expect(samRow).toBeVisible();
  await samRow.locator('input[type="radio"]').check();
  await expect(samRow).toContainText("Assignable");

  await page.getByRole("button", { name: "Assign", exact: true }).click();

  const rosterSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Roster" }) });
  // Same real-transaction-latency reasoning as the blocked attempt above.
  await expect(rosterSection.getByText("Sam Server")).toBeVisible({ timeout: 30_000 });

  const headcountDd = page
    .locator("dl > div")
    .filter({ has: page.getByText("Headcount", { exact: true }) })
    .locator("dd");
  await expect(headcountDd).toHaveText("1/1");

  // --- 6. Publish the week and confirm the shift's status changes --------
  await page.goto(`/schedule?locationId=${harborPoint.id}&weekOf=${WEEK_OF}`);

  // Verify the DRAFT badge is visible before publishing
  const shiftCard = page.locator("a").filter({ has: page.getByText("9:00 AM EDT") });
  await expect(shiftCard.getByText("DRAFT")).toBeVisible();

  // Click the "Publish week" button. The publishWeekAction Server Action
  // (src/app/(app)/schedule/actions.ts) now calls revalidatePath("/schedule"),
  // so the DRAFT status indicator disappears without needing a manual reload.
  await page.getByRole("button", { name: "Publish week", exact: true }).click();

  // Verify the DRAFT badge disappears from the published shift via a real
  // assertion (not a sleep), scoped to the specific shift card
  await expect(shiftCard.getByText("DRAFT")).toHaveCount(0);

  // Re-fetch the shift detail page fresh as an independent confirmation of
  // real database state (not just this page's post-revalidation render).
  await page.goto(`/schedule/${shift.id}`);
  const statusDd = page
    .locator("dl > div")
    .filter({ has: page.getByText("Status", { exact: true }) })
    .locator("dd");
  await expect(statusDd).toHaveText("PUBLISHED");
});

test("a manager cannot open the schedule or a shift for a location they do not manage", async ({
  page,
}) => {
  // This test creates nothing and needs no cleanup -- it only reads
  // pre-existing seeded data (a Pier 39 shift and Pier 39 itself) that
  // Morgan Manager (Harbor Point + Bayside only) does not manage.
  const pier39Shift = await prisma.shift.findFirstOrThrow({
    where: { location: { name: "Pier 39" } },
  });
  const pier39 = await prisma.location.findFirstOrThrow({ where: { name: "Pier 39" } });

  await login(page, MANAGER_MORGAN.email, MANAGER_MORGAN.password);

  // `getShift` (src/lib/shifts.ts) throws "You do not have access to this
  // resource." when the shift's location is outside `visibleLocationScope`,
  // and the shift detail page
  // (src/app/(app)/schedule/[shiftId]/page.tsx) renders that exact message
  // as a `role="alert"` paragraph instead of 404ing or redirecting -- this
  // is the real, current behavior, asserted on directly rather than assumed.
  // Scoped to the `<p>` specifically: Next.js's App Router also renders its
  // own `role="alert"` route announcer div on every page, so a bare
  // `getByRole("alert")` matches both and is ambiguous.
  await page.goto(`/schedule/${pier39Shift.id}`);
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "You do not have access to this resource.",
  );
  await expect(page.getByRole("heading", { name: "Roster" })).toHaveCount(0);

  // The week view now shows an access-denied error when the manager
  // requests a location they don't manage, consistent with the shift detail
  // page. This is rendered as a `<p role="alert">` with the same message.
  await page.goto(`/schedule?locationId=${pier39.id}&weekOf=${WEEK_OF}`);
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "You do not have access to this resource.",
  );
  await expect(page.getByRole("heading", { name: "Schedule" })).toHaveCount(0);
});
