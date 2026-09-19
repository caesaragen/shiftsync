import { test, expect } from "@playwright/test";

test("admin can create a location and see it appear in the list", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("admin@coastaleats.test");
  await page.getByPlaceholder("Password").fill("admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/admin/locations");
  await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();

  // Unique per run: this test writes to the shared database, so a fixed
  // name would collide across runs. Additive only — never deletes.
  const locationName = `E2E Test Location ${Date.now()}`;

  await page.getByLabel("Name").fill(locationName);
  await page.getByLabel("Timezone").selectOption("America/New_York");
  await page.getByRole("button", { name: "Add location" }).click();

  await expect(page).toHaveURL(/\/admin\/locations/);
  await expect(page.getByRole("cell", { name: locationName })).toBeVisible();
});
