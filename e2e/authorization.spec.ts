import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

// Credentials read from prisma/seed.ts — not invented here.
const MANAGER = { email: "manager1@coastaleats.test", password: "manager1123!" };
const STAFF = { email: "staff1@coastaleats.test", password: "staff1123!" };

for (const [role, credentials] of [
  ["MANAGER", MANAGER],
  ["STAFF", STAFF],
] as const) {
  test(`${role} visiting /admin/locations is redirected to /dashboard and never sees the admin UI`, async ({
    page,
  }) => {
    await login(page, credentials.email, credentials.password);

    await page.goto("/admin/locations");

    // Redirected away from the admin page.
    await expect(page).toHaveURL(/\/dashboard$/);

    // Discriminating assertion: the create-location form's submit button
    // only exists on the admin page's markup. If `requireRole("ADMIN")`
    // were deleted from the page, the redirect would stop happening and
    // this button would render — so this fails for the right reason,
    // not merely because the URL looks different.
    await expect(page.getByRole("button", { name: "Add location" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Locations" })).toHaveCount(0);

    // Confirm we actually landed on the dashboard as the expected role,
    // rather than some other unrelated page that also lacks the button.
    await expect(page.getByText(role, { exact: true })).toBeVisible();
  });
}
